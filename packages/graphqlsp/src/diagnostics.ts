import { ts } from './ts';
import { Diagnostic, getDiagnostics } from 'graphql-language-service';
import {
  FragmentDefinitionNode,
  GraphQLSchema,
  Kind,
  OperationDefinitionNode,
  parse,
  visit,
} from 'graphql';
import { LRUCache } from 'lru-cache';
import fnv1a from '@sindresorhus/fnv1a';
import { print } from '@0no-co/graphql.web';

import {
  findAllCallExpressions,
  findAllTaggedTemplateNodes,
  getSource,
} from './ast';
import { resolveTemplate } from './ast/resolve';
import { checkFieldUsageInFile } from './fieldUsage';
import {
  MISSING_FRAGMENT_CODE,
  getColocatedFragmentNames,
} from './checkImports';
import { NoSubstitutionTemplateLiteral } from 'typescript';

const clientDirectives = new Set([
  'populate',
  'client',
  '_unmask',
  '_optional',
  '_required',
  'optional',
  'required',
  'arguments',
  'argumentDefinitions',
  'connection',
  'refetchable',
  'relay',
  'required',
  'inline',
]);

const directiveRegex = /Unknown directive "@([^)]+)"/g;

export const SEMANTIC_DIAGNOSTIC_CODE = 52001;
export const MISSING_OPERATION_NAME_CODE = 52002;
export const USING_DEPRECATED_FIELD_CODE = 52004;

const cache = new LRUCache<number, ts.Diagnostic[]>({
  // how long to live in ms
  ttl: 1000 * 60 * 15,
  max: 5000,
});

export function getGraphQLDiagnostics(
  filename: string,
  schema: { current: GraphQLSchema | null; version: number },
  info: ts.server.PluginCreateInfo
): ts.Diagnostic[] | undefined {
  const isCallExpression = info.config.templateIsCallExpression ?? true;

  let source = getSource(info, filename);
  if (!source) return undefined;

  let fragments: Array<FragmentDefinitionNode> = [],
    nodes: (ts.TaggedTemplateExpression | ts.NoSubstitutionTemplateLiteral)[];
  if (isCallExpression) {
    const result = findAllCallExpressions(source, info);
    fragments = result.fragments;
    nodes = result.nodes;
  } else {
    nodes = findAllTaggedTemplateNodes(source);
  }

  const texts = nodes.map(node => {
    if (
      (ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateExpression(node)) &&
      !isCallExpression
    ) {
      if (ts.isTaggedTemplateExpression(node.parent)) {
        node = node.parent;
      } else {
        return undefined;
      }
    }

    return resolveTemplate(node, filename, info).combinedText;
  });

  const cacheKey = fnv1a(
    isCallExpression
      ? source.getText() +
          fragments.map(x => print(x)).join('-') +
          schema.version
      : texts.join('-') + schema.version
  );

  let tsDiagnostics;
  if (cache.has(cacheKey)) {
    tsDiagnostics = cache.get(cacheKey)!;
  } else {
    tsDiagnostics = runDiagnostics(source, { nodes, fragments }, schema, info);
    cache.set(cacheKey, tsDiagnostics);
  }

  const shouldCheckForColocatedFragments =
    info.config.shouldCheckForColocatedFragments ?? true;
  let fragmentDiagnostics: ts.Diagnostic[] = [];
  if (isCallExpression && shouldCheckForColocatedFragments) {
    const moduleSpecifierToFragments = getColocatedFragmentNames(source, info);

    const usedFragments = new Set();
    nodes.forEach(node => {
      try {
        const parsed = parse(node.getText().slice(1, -1), {
          noLocation: true,
        });
        visit(parsed, {
          FragmentSpread: node => {
            usedFragments.add(node.name.value);
          },
        });
      } catch (e) {}
    });

    Object.keys(moduleSpecifierToFragments).forEach(moduleSpecifier => {
      const {
        fragments: fragmentNames,
        start,
        length,
      } = moduleSpecifierToFragments[moduleSpecifier];
      const missingFragments = Array.from(
        new Set(fragmentNames.filter(x => !usedFragments.has(x)))
      );
      if (missingFragments.length) {
        fragmentDiagnostics.push({
          file: source,
          length,
          start,
          category: ts.DiagnosticCategory.Warning,
          code: MISSING_FRAGMENT_CODE,
          messageText: `Unused co-located fragment definition(s) "${missingFragments.join(
            ', '
          )}" in ${moduleSpecifier}`,
        });
      }
    });

    return [...tsDiagnostics, ...fragmentDiagnostics];
  } else {
    return tsDiagnostics;
  }
}

const runDiagnostics = (
  source: ts.SourceFile,
  {
    nodes,
    fragments,
  }: {
    nodes: (ts.TaggedTemplateExpression | ts.NoSubstitutionTemplateLiteral)[];
    fragments: FragmentDefinitionNode[];
  },
  schema: { current: GraphQLSchema | null; version: number },
  info: ts.server.PluginCreateInfo
) => {
  const filename = source.fileName;
  const isCallExpression = info.config.templateIsCallExpression ?? true;

  const diagnostics = nodes
    .map(originalNode => {
      let node = originalNode;
      if (
        !isCallExpression &&
        (ts.isNoSubstitutionTemplateLiteral(node) ||
          ts.isTemplateExpression(node))
      ) {
        if (ts.isTaggedTemplateExpression(node.parent)) {
          node = node.parent;
        } else {
          return undefined;
        }
      }

      const { combinedText: text, resolvedSpans } = resolveTemplate(
        node,
        filename,
        info
      );
      const lines = text.split('\n');

      let isExpression = false;
      if (ts.isAsExpression(node.parent)) {
        if (ts.isExpressionStatement(node.parent.parent)) {
          isExpression = true;
        }
      } else if (ts.isExpressionStatement(node.parent)) {
        isExpression = true;
      }
      // When we are dealing with a plain gql statement we have to add two these can be recognised
      // by the fact that the parent is an expressionStatement

      let startingPosition =
        node.getStart() +
        (isCallExpression
          ? 0
          : (node as ts.TaggedTemplateExpression).tag.getText().length +
            (isExpression ? 2 : 1));
      const endPosition = startingPosition + node.getText().length;
      let docFragments = [...fragments];
      if (isCallExpression) {
        try {
          const documentFragments = parse(text, {
            noLocation: true,
          }).definitions.filter(x => x.kind === Kind.FRAGMENT_DEFINITION);
          docFragments = docFragments.filter(
            x =>
              !documentFragments.some(
                y =>
                  y.kind === Kind.FRAGMENT_DEFINITION &&
                  y.name.value === x.name.value
              )
          );
        } catch (e) {}
      }

      const graphQLDiagnostics = getDiagnostics(
        text,
        schema.current,
        undefined,
        undefined,
        docFragments
      )
        .filter(diag => {
          if (!diag.message.includes('Unknown directive')) return true;

          const [message] = diag.message.split('(');
          const matches = directiveRegex.exec(message);
          if (!matches) return true;
          const directiveNmae = matches[1];
          return !clientDirectives.has(directiveNmae);
        })
        .map(x => {
          const { start, end } = x.range;

          // We add the start.line to account for newline characters which are
          // split out
          let startChar = startingPosition + start.line;
          for (let i = 0; i <= start.line; i++) {
            if (i === start.line) startChar += start.character;
            else if (lines[i]) startChar += lines[i].length;
          }

          let endChar = startingPosition + end.line;
          for (let i = 0; i <= end.line; i++) {
            if (i === end.line) endChar += end.character;
            else if (lines[i]) endChar += lines[i].length;
          }

          const locatedInFragment = resolvedSpans.find(x => {
            const newEnd = x.new.start + x.new.length;
            return startChar >= x.new.start && endChar <= newEnd;
          });

          if (!!locatedInFragment) {
            return {
              ...x,
              start: locatedInFragment.original.start,
              length: locatedInFragment.original.length,
            };
          } else {
            if (startChar > endPosition) {
              // we have to calculate the added length and fix this
              const addedCharacters = resolvedSpans
                .filter(x => x.new.start + x.new.length < startChar)
                .reduce(
                  (acc, span) => acc + (span.new.length - span.original.length),
                  0
                );
              startChar = startChar - addedCharacters;
              endChar = endChar - addedCharacters;
              return {
                ...x,
                start: startChar + 1,
                length: endChar - startChar,
              };
            } else {
              return {
                ...x,
                start: startChar + 1,
                length: endChar - startChar,
              };
            }
          }
        })
        .filter(x => x.start + x.length <= endPosition);

      try {
        const parsed = parse(text, { noLocation: true });

        if (
          parsed.definitions.some(x => x.kind === Kind.OPERATION_DEFINITION)
        ) {
          const op = parsed.definitions.find(
            x => x.kind === Kind.OPERATION_DEFINITION
          ) as OperationDefinitionNode;
          if (!op.name) {
            graphQLDiagnostics.push({
              message: 'Operation needs a name for types to be generated.',
              start: node.getStart(),
              code: MISSING_OPERATION_NAME_CODE,
              length: originalNode.getText().length,
              range: {} as any,
              severity: 2,
            } as any);
          }
        }
      } catch (e) {}

      return graphQLDiagnostics;
    })
    .flat()
    .filter(Boolean) as Array<Diagnostic & { length: number; start: number }>;

  const tsDiagnostics = diagnostics.map(diag => ({
    file: source,
    length: diag.length,
    start: diag.start,
    category:
      diag.severity === 2
        ? ts.DiagnosticCategory.Warning
        : ts.DiagnosticCategory.Error,
    code:
      typeof diag.code === 'number'
        ? diag.code
        : diag.severity === 2
        ? USING_DEPRECATED_FIELD_CODE
        : SEMANTIC_DIAGNOSTIC_CODE,
    messageText: diag.message.split('\n')[0],
  }));

  if (isCallExpression) {
    const usageDiagnostics = checkFieldUsageInFile(
      source,
      nodes as ts.NoSubstitutionTemplateLiteral[],
      info
    );

    return [...tsDiagnostics, ...usageDiagnostics];
  } else {
    return tsDiagnostics;
  }
};
