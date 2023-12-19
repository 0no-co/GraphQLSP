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
  findAllImports,
  findAllTaggedTemplateNodes,
  findNode,
  getSource,
  isFileDirty,
} from './ast';
import { resolveTemplate } from './ast/resolve';
import { generateTypedDocumentNodes } from './graphql/generateTypes';
import { Logger } from '.';

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
export const MISSING_FRAGMENT_CODE = 52003;
export const USING_DEPRECATED_FIELD_CODE = 52004;
export const UNUSED_FIELD_CODE = 52005;

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

  const importDiagnostics = isCallExpression
    ? checkFieldUsageInFile(
        source,
        nodes as ts.NoSubstitutionTemplateLiteral[],
        info
      )
    : checkImportsForFragments(source, info);

  return [...tsDiagnostics, ...importDiagnostics];
};

const getVariableDeclaration = (start: ts.NoSubstitutionTemplateLiteral) => {
  let node: any = start;
  let counter = 0;
  while (!ts.isVariableDeclaration(node) && node.parent && counter < 5) {
    node = node.parent;
    counter++;
  }
  return node;
};

const traverseDestructuring = (
  node: ts.ObjectBindingPattern,
  originalWip: Array<string>,
  allFields: Array<string>,
  source: ts.SourceFile,
  info: ts.server.PluginCreateInfo
): Array<string> => {
  const results = [];
  for (const binding of node.elements) {
    if (ts.isObjectBindingPattern(binding.name)) {
      const wip = [...originalWip];
      if (
        binding.propertyName &&
        allFields.includes(binding.propertyName.getText()) &&
        !originalWip.includes(binding.propertyName.getText())
      ) {
        wip.push(binding.propertyName.getText());
      }
      const traverseResult = traverseDestructuring(
        binding.name,
        wip,
        allFields,
        source,
        info
      );

      results.push(...traverseResult);
    } else if (ts.isIdentifier(binding.name)) {
      const wip = [...originalWip];
      if (
        binding.propertyName &&
        allFields.includes(binding.propertyName.getText()) &&
        !originalWip.includes(binding.propertyName.getText())
      ) {
        wip.push(binding.propertyName.getText());
      } else {
        wip.push(binding.name.getText());
      }

      const crawlResult = crawlScope(
        binding.name,
        wip,
        allFields,
        source,
        info
      );

      results.push(...crawlResult);
    }
  }

  return results;
};

// TODO: this can be consolidated with the main crawler I presume...
const crawlScope = (
  node: ts.Identifier,
  originalWip: Array<string>,
  allFields: Array<string>,
  source: ts.SourceFile,
  info: ts.server.PluginCreateInfo
): Array<string> => {
  let results: string[] = [];

  const references = info.languageService.getReferencesAtPosition(
    source.fileName,
    node.pos + 1
  );
  if (!references) return results;

  results = references.flatMap(ref => {
    if (ref.fileName !== source.fileName) return [];

    if (
      node.getStart() <= ref.textSpan.start &&
      node.getEnd() >= ref.textSpan.start + ref.textSpan.length
    )
      return [];

    let foundRef = findNode(source, ref.textSpan.start);
    if (!foundRef) return [];

    const pathParts = [...originalWip];
    while (
      ts.isIdentifier(foundRef) ||
      ts.isPropertyAccessExpression(foundRef) ||
      ts.isElementAccessExpression(foundRef) ||
      ts.isVariableDeclaration(foundRef) ||
      ts.isBinaryExpression(foundRef)
    ) {
      if (ts.isVariableDeclaration(foundRef)) {
        if (ts.isIdentifier(foundRef.name)) {
          return crawlScope(foundRef.name, pathParts, allFields, source, info);
        } else if (ts.isObjectBindingPattern(foundRef.name)) {
          return traverseDestructuring(
            foundRef.name,
            pathParts,
            allFields,
            source,
            info
          );
        }
      } else if (
        ts.isIdentifier(foundRef) &&
        allFields.includes(foundRef.text) &&
        !pathParts.includes(foundRef.text)
      ) {
        pathParts.push(foundRef.text);
      } else if (
        ts.isPropertyAccessExpression(foundRef) &&
        allFields.includes(foundRef.name.text) &&
        !pathParts.includes(foundRef.name.text)
      ) {
        pathParts.push(foundRef.name.text);
      } else if (
        ts.isElementAccessExpression(foundRef) &&
        ts.isStringLiteral(foundRef.argumentExpression) &&
        allFields.includes(foundRef.argumentExpression.text) &&
        !pathParts.includes(foundRef.argumentExpression.text)
      ) {
        pathParts.push(foundRef.argumentExpression.text);
      }

      foundRef = foundRef.parent;
    }

    return pathParts.join('.');
  });

  return results;
};

const checkFieldUsageInFile = (
  source: ts.SourceFile,
  nodes: ts.NoSubstitutionTemplateLiteral[],
  info: ts.server.PluginCreateInfo
) => {
  const diagnostics: ts.Diagnostic[] = [];
  const shouldTrackFieldUsage = info.config.trackFieldUsage ?? false;
  if (!shouldTrackFieldUsage) return diagnostics;

  nodes.forEach(node => {
    const nodeText = node.getText();
    // Bailing for mutations/subscriptions as these could have small details
    // for normalised cache interactions
    if (nodeText.includes('mutation') || nodeText.includes('subscription'))
      return;

    const variableDeclaration = getVariableDeclaration(node);
    if (!ts.isVariableDeclaration(variableDeclaration)) return;

    const references = info.languageService.getReferencesAtPosition(
      source.fileName,
      variableDeclaration.name.pos
    );
    if (!references) return;

    references.forEach(ref => {
      if (ref.fileName !== source.fileName) return;

      let found = findNode(source, ref.textSpan.start);
      while (found && !ts.isVariableStatement(found)) {
        found = found.parent;
      }

      if (!found || !ts.isVariableStatement(found)) return;

      const [output] = found.declarationList.declarations;

      if (output.name.getText() === variableDeclaration.name.getText()) return;

      let temp = output.name;
      // TODO: this currently does not solve deep destructuring
      // in the initial iteration this is probably not worth it and
      // it might be better to support the three case that we do
      //
      // Supported cases:
      // - const result = await client.query() || useFragment()
      // - const [result] = useQuery() --> urql
      // - const { data } = useQuery() --> Apollo
      //
      // Missing cases:
      // - const { field } = useFragment()
      // - const [{ data }] = useQuery()
      // - const { data: { pokemon } } = useQuery()
      if (
        ts.isArrayBindingPattern(temp) &&
        ts.isBindingElement(temp.elements[0])
      ) {
        temp = temp.elements[0].name;
      } else if (ts.isObjectBindingPattern(temp)) {
        const foundDataElement = temp.elements.find(el => {
          if (
            ts.isBindingElement(el) &&
            ts.isIdentifier(el.name) &&
            el.name.text === 'data'
          )
            return el;
          if (
            ts.isBindingElement(el) &&
            el.propertyName &&
            ts.isIdentifier(el.propertyName) &&
            el.propertyName.text === 'data'
          )
            return el;
        });

        if (!foundDataElement) return;
        temp = foundDataElement.name;
      }

      const outputReferences = info.languageService.getReferencesAtPosition(
        source.fileName,
        temp.pos
      );
      if (!outputReferences) return;

      const inProgress: string[] = [];
      const allPaths: string[] = [];
      const allFields: string[] = [];
      const reserved = ['id', '__typename'];
      const fieldToLoc = new Map<string, { start: number; length: number }>();
      // This visitor gets all the leaf-paths in the document
      // as well as all fields that are part of the document
      // We need the leaf-paths to check usage and we need the
      // fields to validate whether an access on a given reference
      // is valid given the current document...
      visit(parse(node.getText().slice(1, -1)), {
        Field: {
          enter: node => {
            if (!reserved.includes(node.name.value)) {
              allFields.push(node.name.value);
            }

            if (!node.selectionSet && !reserved.includes(node.name.value)) {
              let p;
              if (inProgress.length) {
                p = inProgress.join('.') + '.' + node.name.value;
              } else {
                p = node.name.value;
              }
              allPaths.push(p);

              fieldToLoc.set(p, {
                start: node.name.loc!.start,
                length: node.name.loc!.end - node.name.loc!.start,
              });
            } else if (node.selectionSet) {
              inProgress.push(node.name.value);
            }
          },
          leave: node => {
            if (node.selectionSet) {
              inProgress.pop();
            }
          },
        },
      });

      // Go over all the references tied to the result of
      // accessing our equery and collect them as fully
      // qualified paths (ideally ending in a leaf-node)
      const allAccess = outputReferences.flatMap(ref => {
        // If we get a reference to a different file we can bail
        if (ref.fileName !== source.fileName) return [];

        // We don't want to end back at our query so we narrow
        // the scope.
        if (
          found!.getStart() <= ref.textSpan.start &&
          found!.getEnd() >= ref.textSpan.start + ref.textSpan.length
        )
          return [];

        let foundRef = findNode(source, ref.textSpan.start);
        if (!foundRef) return [];

        const pathParts: Array<string> = [];
        // In here we'll start crawling all the accessors of result
        // and try to determine the total path
        // - result.data.pokemon.name --> pokemon.name this is the easy route and never accesses
        //   any of the recursive functions
        // - const pokemon = result.data.pokemon --> this initiates a new crawl with a renewed scope
        // - const { pokemon } = result.data --> this initiates a destructuring traversal which will
        //   either end up in more destructuring traversals or a scope crawl
        while (
          ts.isIdentifier(foundRef) ||
          ts.isPropertyAccessExpression(foundRef) ||
          ts.isElementAccessExpression(foundRef) ||
          ts.isVariableDeclaration(foundRef) ||
          ts.isBinaryExpression(foundRef)
        ) {
          if (ts.isVariableDeclaration(foundRef)) {
            if (ts.isIdentifier(foundRef.name)) {
              // We have already added the paths because of the right-hand expression,
              // const pokemon = result.data.pokemon --> we have pokemon as our path,
              // now re-crawling pokemon for all of its accessors should deliver us the usage
              // patterns... This might get expensive though if we need to perform this deeply.
              return crawlScope(
                foundRef.name,
                pathParts,
                allFields,
                source,
                info
              );
            } else if (ts.isObjectBindingPattern(foundRef.name)) {
              // First we need to traverse the left-hand side of the variable assignment,
              // this could be tree-like as we could be dealing with
              // - const { x: { y: z }, a: { b: { c, d }, e: { f } } } = result.data
              // Which we will need several paths for...
              // after doing that we need to re-crawl all of the resulting variables
              // Crawl down until we have either a leaf node or an object/array that can
              // be recrawled
              return traverseDestructuring(
                foundRef.name,
                pathParts,
                allFields,
                source,
                info
              );
            }
          } else if (
            ts.isIdentifier(foundRef) &&
            allFields.includes(foundRef.text) &&
            !pathParts.includes(foundRef.text)
          ) {
            pathParts.push(foundRef.text);
          } else if (
            ts.isPropertyAccessExpression(foundRef) &&
            allFields.includes(foundRef.name.text) &&
            !pathParts.includes(foundRef.name.text)
          ) {
            pathParts.push(foundRef.name.text);
          } else if (
            ts.isElementAccessExpression(foundRef) &&
            ts.isStringLiteral(foundRef.argumentExpression) &&
            allFields.includes(foundRef.argumentExpression.text) &&
            !pathParts.includes(foundRef.argumentExpression.text)
          ) {
            pathParts.push(foundRef.argumentExpression.text);
          }

          foundRef = foundRef.parent;
        }

        return pathParts.join('.');
      });

      const unused = allPaths.filter(x => !allAccess.includes(x));
      unused.forEach(unusedField => {
        const loc = fieldToLoc.get(unusedField);
        if (!loc) return;

        diagnostics.push({
          file: source,
          length: loc.length,
          start: node.getStart() + loc.start + 1,
          category: ts.DiagnosticCategory.Warning,
          code: UNUSED_FIELD_CODE,
          messageText: `Field '${unusedField}' is not used.`,
        });
      });
    });
  });

  return diagnostics;
};

const checkImportsForFragments = (
  source: ts.SourceFile,
  info: ts.server.PluginCreateInfo
) => {
  const imports = findAllImports(source);

  const shouldCheckForColocatedFragments =
    info.config.shouldCheckForColocatedFragments ?? false;
  const tsDiagnostics: ts.Diagnostic[] = [];
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
        ts.isNamespaceImport(imp.importClause.namedBindings)
      ) {
        // TODO: we might need to warn here when the fragment is unused as a namespace import
        return;
      } else if (
        imp.importClause.namedBindings &&
        ts.isNamedImportBindings(imp.importClause.namedBindings)
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
              ts.isNoSubstitutionTemplateLiteral(node) ||
              ts.isTemplateExpression(node)
            ) {
              if (ts.isTaggedTemplateExpression(node.parent)) {
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

  return tsDiagnostics;
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
