import ts from 'typescript/lib/tsserverlibrary';
import {
  ImportTypeNode,
  isAsExpression,
  isExpressionStatement,
  isImportTypeNode,
  isNamedImportBindings,
  isNamespaceImport,
  isNoSubstitutionTemplateLiteral,
  isTaggedTemplateExpression,
  isTemplateExpression,
} from 'typescript';
import { Diagnostic, getDiagnostics } from 'graphql-language-service';
import {
  FragmentDefinitionNode,
  GraphQLSchema,
  Kind,
  OperationDefinitionNode,
  parse,
} from 'graphql';
import { LRUCache } from 'lru-cache';
import fnv1a from '@sindresorhus/fnv1a';

import {
  findAllCallExpressions,
  findAllImports,
  findAllTaggedTemplateNodes,
  getSource,
  isFileDirty,
} from './ast';
import { resolveTemplate } from './ast/resolve';
import { generateTypedDocumentNodes } from './graphql/generateTypes';

export const SEMANTIC_DIAGNOSTIC_CODE = 52001;
export const MISSING_OPERATION_NAME_CODE = 52002;
export const MISSING_FRAGMENT_CODE = 52003;
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
  hasTSErrors: Boolean,
  filename: string,
  baseTypesPath: string,
  schema: { current: GraphQLSchema | null; version: number },
  info: ts.server.PluginCreateInfo
): ts.Diagnostic[] | undefined {
  const logger = (msg: string) =>
    info.project.projectService.logger.info(`[GraphQLSP] ${msg}`);
  const disableTypegen = info.config.disableTypegen;
  const tagTemplate = info.config.template || 'gql';
  const scalars = info.config.scalars || {};
  const shouldCheckForColocatedFragments =
    info.config.shouldCheckForColocatedFragments ?? false;
  const isCallExpression = info.config.templateIsCallExpression ?? false;

  let source = getSource(info, filename);
  if (!source) return undefined;

  let fragments: Array<FragmentDefinitionNode>,
    nodes: (ts.TaggedTemplateExpression | ts.NoSubstitutionTemplateLiteral)[];
  if (isCallExpression) {
    const result = findAllCallExpressions(source, tagTemplate, info);
    fragments = result.fragments;
    nodes = result.nodes;
  } else {
    nodes = findAllTaggedTemplateNodes(source);
    fragments = [];
  }

  logger(
    'Found ' +
      nodes.length +
      ' gql template(s) in ' +
      filename +
      ' and ' +
      fragments.length +
      ' fragments'
  );

  const texts = nodes.map(node => {
    if (
      (isNoSubstitutionTemplateLiteral(node) || isTemplateExpression(node)) &&
      !isCallExpression
    ) {
      if (isTaggedTemplateExpression(node.parent)) {
        node = node.parent;
      } else {
        return undefined;
      }
    }

    return resolveTemplate(node, filename, info).combinedText;
  });

  logger(`${JSON.stringify(texts)}`);

  let tsDiagnostics: ts.Diagnostic[] = [];
  const cacheKey = fnv1a(texts.join('-') + schema.version);
  if (cache.has(cacheKey)) {
    tsDiagnostics = cache.get(cacheKey)!;
  } else {
    const diagnostics = nodes
      .map(originalNode => {
        let node = originalNode;
        if (
          !isCallExpression &&
          (isNoSubstitutionTemplateLiteral(node) || isTemplateExpression(node))
        ) {
          if (isTaggedTemplateExpression(node.parent)) {
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
        logger(`Checking ${text} and found newlines ${JSON.stringify(lines)}`);

        let isExpression = false;
        if (isAsExpression(node.parent)) {
          if (isExpressionStatement(node.parent.parent)) {
            isExpression = true;
          }
        } else {
          if (isExpressionStatement(node.parent)) {
            isExpression = true;
          }
        }
        // When we are dealing with a plain gql statement we have to add two these can be recognised
        // by the fact that the parent is an expressionStatement
        let startingPosition =
          node.pos + isCallExpression
            ? 0
            : tagTemplate.length + (isExpression ? 2 : 1);
        const endPosition = startingPosition + node.getText().length;

        // TODO: chicken and egg problem... we have to parse the current document and see if one of the global
        // fragments match so we can filter it out... but when there are nested fragments it won't parse
        const graphQLDiagnostics = getDiagnostics(
          text,
          schema.current,
          undefined,
          undefined,
          fragments
        )
          .map(x => {
            const { start, end } = x.range;
            logger(
              `Checking ${x.message} and found start ${JSON.stringify(
                start
              )} and end ${JSON.stringify(end)}`
            );

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
                    (acc, span) =>
                      acc + (span.new.length - span.original.length),
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

    tsDiagnostics = diagnostics.map(diag => ({
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

    const imports = findAllImports(source);
    if (imports.length && shouldCheckForColocatedFragments) {
      const typeChecker = info.languageService.getProgram()?.getTypeChecker();
      imports.forEach(imp => {
        if (!imp.importClause) return;

        const importedNames: string[] = [];
        if (imp.importClause.name) {
          importedNames.push(imp.importClause?.name.text);
        }

        if (
          imp.importClause.namedBindings &&
          isNamespaceImport(imp.importClause.namedBindings)
        ) {
          // TODO: we might need to warn here when the fragment is unused as a namespace import
          return;
        } else if (
          imp.importClause.namedBindings &&
          isNamedImportBindings(imp.importClause.namedBindings)
        ) {
          imp.importClause.namedBindings.elements.forEach(el => {
            importedNames.push(el.name.text);
          });
        }

        const symbol = typeChecker?.getSymbolAtLocation(imp.moduleSpecifier);
        if (!symbol) return;

        const moduleExports = typeChecker?.getExportsOfModule(symbol);
        if (!moduleExports) return;

        const missingImports = moduleExports
          .map(exp => {
            if (importedNames.includes(exp.name)) {
              return;
            }

            const declarations = exp.getDeclarations();
            const declaration = declarations?.find(x => {
              // TODO: check whether the sourceFile.fileName resembles the module
              // specifier
              return true;
            });

            if (!declaration) return;

            const [template] = findAllTaggedTemplateNodes(declaration);
            if (template) {
              let node = template;
              if (
                isNoSubstitutionTemplateLiteral(node) ||
                isTemplateExpression(node)
              ) {
                if (isTaggedTemplateExpression(node.parent)) {
                  node = node.parent;
                } else {
                  return;
                }
              }

              const text = resolveTemplate(
                node,
                node.getSourceFile().fileName,
                info
              ).combinedText;
              try {
                const parsed = parse(text, { noLocation: true });
                if (
                  parsed.definitions.every(
                    x => x.kind === Kind.FRAGMENT_DEFINITION
                  )
                ) {
                  return `'${exp.name}'`;
                }
              } catch (e) {
                return;
              }
            }
          })
          .filter(Boolean);

        if (missingImports.length) {
          tsDiagnostics.push({
            file: source,
            length: imp.getText().length,
            start: imp.getStart(),
            category: ts.DiagnosticCategory.Message,
            code: MISSING_FRAGMENT_CODE,
            messageText: `Missing Fragment import(s) ${missingImports.join(
              ', '
            )} from ${imp.moduleSpecifier.getText()}.`,
          });
        }
      });
    }

    cache.set(cacheKey, tsDiagnostics);
  }

  if (
    !tsDiagnostics.filter(
      x =>
        x.category === ts.DiagnosticCategory.Error ||
        x.category === ts.DiagnosticCategory.Warning
    ).length &&
    !disableTypegen
  ) {
    try {
      if (isFileDirty(filename, source) && !isGeneratingTypes) {
        return tsDiagnostics;
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
            isImportTypeNode(x)
          ) as ImportTypeNode;

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

  return tsDiagnostics;
}
