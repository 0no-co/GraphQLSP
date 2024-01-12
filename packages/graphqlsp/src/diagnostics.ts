import ts from 'typescript/lib/tsserverlibrary';
import { Diagnostic, getDiagnostics } from 'graphql-language-service';
import {
  FragmentDefinitionNode,
  GraphQLSchema,
  Kind,
  OperationDefinitionNode,
  parse,
  print,
  visit,
} from 'graphql';
import { LRUCache } from 'lru-cache';
import fnv1a from '@sindresorhus/fnv1a';

import {
  findAllCallExpressions,
  findAllTaggedTemplateNodes,
  getSource,
  isFileDirty,
} from './ast';
import { resolveTemplate } from './ast/resolve';
import { generateTypedDocumentNodes } from './graphql/generateTypes';
import { checkFieldUsageInFile } from './fieldUsage';
import {
  MISSING_FRAGMENT_CODE,
  checkImportsForFragments,
  getColocatedFragmentNames,
} from './checkImports';

const clientDirectives = new Set([
  'populate',
  'client',
  '_optional',
  '_required',
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

let isGeneratingTypes = false;

const cache = new LRUCache<number, ts.Diagnostic[]>({
  // how long to live in ms
  ttl: 1000 * 60 * 15,
  max: 5000,
});

export function getGraphQLDiagnostics(
  // This is so that we don't change offsets when there are
  // TypeScript errors
  hasTSErrors: boolean,
  filename: string,
  baseTypesPath: string,
  schema: { current: GraphQLSchema | null; version: number },
  info: ts.server.PluginCreateInfo
): ts.Diagnostic[] | undefined {
  const tagTemplate = info.config.template || 'gql';
  const isCallExpression = info.config.templateIsCallExpression ?? false;

  let source = getSource(info, filename);
  if (!source) return undefined;

  let fragments: Array<FragmentDefinitionNode> = [],
    nodes: (ts.TaggedTemplateExpression | ts.NoSubstitutionTemplateLiteral)[];
  if (isCallExpression) {
    const result = findAllCallExpressions(source, tagTemplate, info);
    fragments = result.fragments;
    nodes = result.nodes;
  } else {
    nodes = findAllTaggedTemplateNodes(source, tagTemplate);
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

  let tsDiagnostics: ts.Diagnostic[] = [];
  const cacheKey = fnv1a(
    isCallExpression
      ? source.getText() +
          fragments.map(x => print(x)).join('-') +
          schema.version
      : texts.join('-') + schema.version
  );
  if (cache.has(cacheKey)) {
    tsDiagnostics = cache.get(cacheKey)!;
  } else {
    tsDiagnostics = runDiagnostics(source, { nodes, fragments }, schema, info);
    cache.set(cacheKey, tsDiagnostics);
  }

  runTypedDocumentNodes(
    nodes,
    texts,
    schema,
    tsDiagnostics,
    hasTSErrors,
    baseTypesPath,
    source,
    info
  );

  return tsDiagnostics;
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
  const tagTemplate = info.config.template || 'gql';
  const filename = source.fileName;
  const isCallExpression = info.config.templateIsCallExpression ?? false;

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
        node.pos +
        (isCallExpression ? 0 : tagTemplate.length + (isExpression ? 2 : 1));
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
            else startChar += lines[i].length;
          }

          let endChar = startingPosition + end.line;
          for (let i = 0; i <= end.line; i++) {
            if (i === end.line) endChar += end.character;
            else endChar += lines[i].length;
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
              start: node.pos,
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

    const shouldCheckForColocatedFragments =
      info.config.shouldCheckForColocatedFragments ?? false;
    let fragmentDiagnostics: ts.Diagnostic[] = [];
    console.log(
      '[GraphhQLSP] Checking for colocated fragments ',
      !!shouldCheckForColocatedFragments
    );
    if (shouldCheckForColocatedFragments) {
      const moduleSpecifierToFragments = getColocatedFragmentNames(
        source,
        info
      );

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
        const missingFragments = Array.from(new Set(fragmentNames.filter(
          x => !usedFragments.has(x)
        )));
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
    }

    return [...tsDiagnostics, ...usageDiagnostics, ...fragmentDiagnostics];
  } else {
    const importDiagnostics = checkImportsForFragments(source, info);
    return [...tsDiagnostics, ...importDiagnostics];
  }
};

const runTypedDocumentNodes = (
  nodes: (ts.TaggedTemplateExpression | ts.NoSubstitutionTemplateLiteral)[],
  texts: (string | undefined)[],
  schema: { current: GraphQLSchema | null },
  diagnostics: ts.Diagnostic[],
  hasTSErrors: boolean,
  baseTypesPath: string,
  sourceFile: ts.SourceFile,
  info: ts.server.PluginCreateInfo
) => {
  const filename = sourceFile.fileName;
  const scalars = info.config.scalars || {};
  const disableTypegen = info.config.disableTypegen ?? false;
  let source: ts.SourceFile | undefined = sourceFile;

  if (
    !diagnostics.filter(
      x =>
        x.category === ts.DiagnosticCategory.Error ||
        x.category === ts.DiagnosticCategory.Warning
    ).length &&
    !disableTypegen
  ) {
    try {
      if (isFileDirty(filename, source) && !isGeneratingTypes) {
        return;
      }

      isGeneratingTypes = true;

      const parts = source.fileName.split('/');
      const name = parts[parts.length - 1];
      const nameParts = name.split('.');
      nameParts[nameParts.length - 1] = 'generated.ts';
      parts[parts.length - 1] = nameParts.join('.');

      generateTypedDocumentNodes(
        schema.current,
        parts.join('/'),
        texts.join('\n'),
        scalars,
        baseTypesPath
      ).then(({ success }) => {
        if (!success || hasTSErrors) return;

        source = getSource(info, filename);
        if (!source || isFileDirty(filename, source)) {
          return;
        }

        let addedLength = 0;
        const finalSourceText = nodes.reduce((sourceText, node, i) => {
          source = getSource(info, filename);
          if (!source) return sourceText;

          const queryText = texts[i] || '';
          const parsed = parse(queryText, { noLocation: true });
          const isFragment = parsed.definitions.every(
            x => x.kind === Kind.FRAGMENT_DEFINITION
          );
          let name = '';

          if (isFragment) {
            const fragmentNode = parsed
              .definitions[0] as FragmentDefinitionNode;
            name = fragmentNode.name.value;
          } else {
            const operationNode = parsed
              .definitions[0] as OperationDefinitionNode;
            name = operationNode.name?.value || '';
          }

          if (!name) return sourceText;

          name = name.charAt(0).toUpperCase() + name.slice(1);
          const parentChildren = node.parent.getChildren();

          const exportName = isFragment
            ? `${name}FragmentDoc`
            : `${name}Document`;
          let imp = ` as typeof import('./${nameParts
            .join('.')
            .replace('.ts', '')}').${exportName}\n`;

          // This checks whether one of the children is an import-type
          // which is a short-circuit if there is no as
          const typeImport = parentChildren.find(x =>
            ts.isImportTypeNode(x)
          ) as ts.ImportTypeNode;

          if (typeImport && typeImport.getText().includes(exportName))
            return sourceText;

          const span = { length: 1, start: node.end };

          let text = '';
          if (typeImport) {
            // We only want the oldExportName here to be present
            // that way we can diff its length vs the new one
            const oldExportName = typeImport.getText().split('.').pop();

            // Remove ` as ` from the beginning,
            // this because getText() gives us everything
            // but ` as ` meaning we need to keep that part
            // around.
            imp = imp.slice(4);
            // We remove the \n
            imp = imp.substring(0, imp.length - 1);
            const from = node.getStart();
            text =
              sourceText.slice(0, from) +
              sourceText.slice(from).replace(typeImport.getText(), imp);
            span.length =
              imp.length + ((oldExportName || '').length - exportName.length);
          } else {
            text =
              sourceText.substring(0, span.start) +
              imp +
              sourceText.substring(span.start + span.length, sourceText.length);
          }

          sourceText = text;
          addedLength = addedLength + imp.length;
          // @ts-ignore
          source.hasBeenIncrementallyParsed = false;
          source.update(text, { span, newLength: imp.length });
          source.text = text;

          return sourceText;
        }, source.text);

        const scriptInfo = info.project.projectService.getScriptInfo(filename);
        const snapshot = scriptInfo!.getSnapshot();
        scriptInfo!.editContent(0, snapshot.getLength(), finalSourceText);
        info.languageServiceHost.writeFile!(source.fileName, finalSourceText);
        scriptInfo!.reloadFromFile();
        scriptInfo!.registerFileUpdate();
        isGeneratingTypes = false;
      });
    } catch (e) {
      const scriptInfo = info.project.projectService.getScriptInfo(filename);
      scriptInfo!.reloadFromFile();
      isGeneratingTypes = false;
    }
  }
};
