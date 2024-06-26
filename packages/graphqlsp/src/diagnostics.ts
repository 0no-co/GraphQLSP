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
  findAllPersistedCallExpressions,
  findAllTaggedTemplateNodes,
  getSource,
} from './ast';
import { resolveTemplate } from './ast/resolve';
import { UNUSED_FIELD_CODE, checkFieldUsageInFile } from './fieldUsage';
import {
  MISSING_FRAGMENT_CODE,
  getColocatedFragmentNames,
} from './checkImports';
import {
  generateHashForDocument,
  getDocumentReferenceFromDocumentNode,
  getDocumentReferenceFromTypeQuery,
} from './persisted';
import { SchemaRef } from './graphql/getSchema';

const clientDirectives = new Set([
  'populate',
  'client',
  '_unmask',
  '_optional',
  '_relayPagination',
  '_simplePagination',
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

export const SEMANTIC_DIAGNOSTIC_CODE = 52001;
export const MISSING_OPERATION_NAME_CODE = 52002;
export const USING_DEPRECATED_FIELD_CODE = 52004;
export const MISSING_PERSISTED_TYPE_ARG = 520100;
export const MISSING_PERSISTED_CODE_ARG = 520101;
export const MISSING_PERSISTED_DOCUMENT = 520102;
export const MISSMATCH_HASH_TO_DOCUMENT = 520103;
export const ALL_DIAGNOSTICS = [
  SEMANTIC_DIAGNOSTIC_CODE,
  MISSING_OPERATION_NAME_CODE,
  USING_DEPRECATED_FIELD_CODE,
  MISSING_FRAGMENT_CODE,
  UNUSED_FIELD_CODE,
  MISSING_PERSISTED_TYPE_ARG,
  MISSING_PERSISTED_CODE_ARG,
  MISSING_PERSISTED_DOCUMENT,
  MISSMATCH_HASH_TO_DOCUMENT,
];

const cache = new LRUCache<number, ts.Diagnostic[]>({
  // how long to live in ms
  ttl: 1000 * 60 * 15,
  max: 5000,
});

export function getGraphQLDiagnostics(
  filename: string,
  schema: SchemaRef,
  info: ts.server.PluginCreateInfo
): ts.Diagnostic[] | undefined {
  const isCallExpression = info.config.templateIsCallExpression ?? true;

  let source = getSource(info, filename);
  if (!source) return undefined;

  let fragments: Array<FragmentDefinitionNode> = [],
    nodes: {
      node: ts.StringLiteralLike | ts.TaggedTemplateExpression;
      schema: string | null;
    }[];
  if (isCallExpression) {
    const result = findAllCallExpressions(source, info);
    fragments = result.fragments;
    nodes = result.nodes;
  } else {
    nodes = findAllTaggedTemplateNodes(source).map(x => ({
      node: x,
      schema: null,
    }));
  }

  const texts = nodes.map(({ node }) => {
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

  let tsDiagnostics: ts.Diagnostic[];
  if (cache.has(cacheKey)) {
    tsDiagnostics = cache.get(cacheKey)!;
  } else {
    tsDiagnostics = runDiagnostics(source, { nodes, fragments }, schema, info);
    cache.set(cacheKey, tsDiagnostics);
  }

  const shouldCheckForColocatedFragments =
    info.config.shouldCheckForColocatedFragments ?? true;
  let fragmentDiagnostics: ts.Diagnostic[] = [];

  if (isCallExpression) {
    const persistedCalls = findAllPersistedCallExpressions(source, info);
    // We need to check whether the user has correctly inserted a hash,
    // by means of providing an argument to the function and that they
    // are establishing a reference to the document by means of the generic.
    const persistedDiagnostics = persistedCalls
      .map<ts.Diagnostic | null>(found => {
        const { node: callExpression } = found;
        if (!callExpression.typeArguments && !callExpression.arguments[1]) {
          return {
            category: ts.DiagnosticCategory.Warning,
            code: MISSING_PERSISTED_TYPE_ARG,
            file: source,
            messageText: 'Missing generic pointing at the GraphQL document.',
            start: callExpression.getStart(),
            length: callExpression.getEnd() - callExpression.getStart(),
          };
        }

        let foundNode,
          foundFilename = filename,
          ref,
          start,
          length;
        const typeQuery =
          callExpression.typeArguments && callExpression.typeArguments[0];
        if (typeQuery) {
          start = typeQuery.getStart();
          length = typeQuery.getEnd() - typeQuery.getStart();

          if (!ts.isTypeQueryNode(typeQuery)) {
            return {
              category: ts.DiagnosticCategory.Warning,
              code: MISSING_PERSISTED_TYPE_ARG,
              file: source,
              messageText:
                'Provided generic should be a typeQueryNode in the shape of graphql.persisted<typeof document>.',
              start,
              length,
            };
          }
          const { node: found, filename: fileName } =
            getDocumentReferenceFromTypeQuery(typeQuery, filename, info);
          foundNode = found;
          foundFilename = fileName;
          ref = typeQuery.getText();
        } else if (callExpression.arguments[1]) {
          start = callExpression.arguments[1].getStart();
          length =
            callExpression.arguments[1].getEnd() -
            callExpression.arguments[1].getStart();
          if (
            !ts.isIdentifier(callExpression.arguments[1]) &&
            !ts.isCallExpression(callExpression.arguments[1])
          ) {
            return {
              category: ts.DiagnosticCategory.Warning,
              code: MISSING_PERSISTED_TYPE_ARG,
              file: source,
              messageText:
                'Provided argument should be an identifier or invocation of "graphql" in the shape of graphql.persisted(hash, document).',
              start,
              length,
            };
          }

          const { node: found, filename: fileName } =
            getDocumentReferenceFromDocumentNode(
              callExpression.arguments[1],
              filename,
              info
            );
          foundNode = found;
          foundFilename = fileName;
          ref = callExpression.arguments[1].getText();
        }

        if (!foundNode) {
          return {
            category: ts.DiagnosticCategory.Warning,
            code: MISSING_PERSISTED_DOCUMENT,
            file: source,
            messageText: `Can't find reference to "${ref}".`,
            start,
            length,
          };
        }

        const initializer = foundNode;
        if (
          !initializer ||
          !ts.isCallExpression(initializer) ||
          !initializer.arguments[0] ||
          !ts.isStringLiteralLike(initializer.arguments[0])
        ) {
          // TODO: we can make this check more stringent where we also parse and resolve
          // the accompanying template.
          return {
            category: ts.DiagnosticCategory.Warning,
            code: MISSING_PERSISTED_DOCUMENT,
            file: source,
            messageText: `Referenced type "${ref}" is not a GraphQL document.`,
            start,
            length,
          };
        }

        if (!callExpression.arguments[0]) {
          // TODO: this might be covered by the API enforcing the first
          // argument so can possibly be removed.
          return {
            category: ts.DiagnosticCategory.Warning,
            code: MISSING_PERSISTED_CODE_ARG,
            file: source,
            messageText: `The call-expression is missing a hash for the persisted argument.`,
            start: callExpression.arguments.pos,
            length: callExpression.arguments.end - callExpression.arguments.pos,
          };
        }

        const hash = callExpression.arguments[0].getText().slice(1, -1);
        if (hash.startsWith('sha256:')) {
          const generatedHash = generateHashForDocument(
            info,
            initializer.arguments[0],
            foundFilename,
            initializer.arguments[1] &&
              ts.isArrayLiteralExpression(initializer.arguments[1])
              ? initializer.arguments[1]
              : undefined
          );
          if (!generatedHash) return null;

          const upToDateHash = `sha256:${generatedHash}`;
          if (upToDateHash !== hash) {
            return {
              category: ts.DiagnosticCategory.Warning,
              code: MISSMATCH_HASH_TO_DOCUMENT,
              file: source,
              messageText: `The persisted document's hash is outdated`,
              start: callExpression.arguments.pos,
              length:
                callExpression.arguments.end - callExpression.arguments.pos,
            };
          }
        }

        return null;
      })
      .filter(Boolean);

    tsDiagnostics.push(...(persistedDiagnostics as ts.Diagnostic[]));
  }

  if (isCallExpression && shouldCheckForColocatedFragments) {
    const moduleSpecifierToFragments = getColocatedFragmentNames(source, info);

    const usedFragments = new Set();
    nodes.forEach(({ node }) => {
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
      } = moduleSpecifierToFragments[moduleSpecifier]!;
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
    nodes: {
      node: ts.TaggedTemplateExpression | ts.StringLiteralLike;
      schema: string | null;
    }[];
    fragments: FragmentDefinitionNode[];
  },
  schema: SchemaRef,
  info: ts.server.PluginCreateInfo
): ts.Diagnostic[] => {
  const filename = source.fileName;
  const isCallExpression = info.config.templateIsCallExpression ?? true;

  const diagnostics = nodes
    .map(originalNode => {
      let node = originalNode.node;
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
            (isExpression ? 2 : 0));
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

      const schemaToUse =
        originalNode.schema && schema.multi[originalNode.schema]
          ? schema.multi[originalNode.schema]?.schema
          : schema.current?.schema;

      if (!schemaToUse) {
        return undefined;
      }

      const graphQLDiagnostics = getDiagnostics(
        text,
        schemaToUse,
        undefined,
        undefined,
        docFragments
      )
        .filter(diag => {
          if (!diag.message.includes('Unknown directive')) return true;

          const [message] = diag.message.split('(');
          const matches =
            message && /Unknown directive "@([^)]+)"/g.exec(message);
          if (!matches) return true;
          const directiveName = matches[1];
          return directiveName && !clientDirectives.has(directiveName);
        })
        .map(x => {
          const { start, end } = x.range;

          // We add the start.line to account for newline characters which are
          // split out
          let startChar = startingPosition + start.line;
          for (let i = 0; i <= start.line && i < lines.length; i++) {
            if (i === start.line) startChar += start.character;
            else if (lines[i]) startChar += lines[i]!.length;
          }

          let endChar = startingPosition + end.line;
          for (let i = 0; i <= end.line && i < lines.length; i++) {
            if (i === end.line) endChar += end.character;
            else if (lines[i]) endChar += lines[i]!.length;
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
              message: 'Operation should contain a name.',
              start: node.getStart(),
              code: MISSING_OPERATION_NAME_CODE,
              length: originalNode.node.getText().length,
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

  const tsDiagnostics = diagnostics.map(
    diag =>
      ({
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
      } as ts.Diagnostic)
  );

  if (isCallExpression) {
    const usageDiagnostics =
      checkFieldUsageInFile(
        source,
        nodes.map(x => x.node) as ts.NoSubstitutionTemplateLiteral[],
        info
      ) || [];

    if (!usageDiagnostics) return tsDiagnostics;

    return [...tsDiagnostics, ...usageDiagnostics];
  } else {
    return tsDiagnostics;
  }
};
