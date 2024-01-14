import { ts } from './ts';
import { parse, visit } from 'graphql';

import { findNode } from './ast';

export const UNUSED_FIELD_CODE = 52005;

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

const crawlScope = (
  node: ts.Identifier | ts.BindingName,
  originalWip: Array<string>,
  allFields: Array<string>,
  source: ts.SourceFile,
  info: ts.server.PluginCreateInfo
): Array<string> => {
  let results: string[] = [];

  const references = info.languageService.getReferencesAtPosition(
    source.fileName,
    node.getStart()
  );

  if (!references) return results;

  // Go over all the references tied to the result of
  // accessing our equery and collect them as fully
  // qualified paths (ideally ending in a leaf-node)
  results = references.flatMap(ref => {
    // If we get a reference to a different file we can bail
    if (ref.fileName !== source.fileName) return [];
    // We don't want to end back at our document so we narrow
    // the scope.
    if (
      node.getStart() <= ref.textSpan.start &&
      node.getEnd() >= ref.textSpan.start + ref.textSpan.length
    )
      return [];

    let foundRef = findNode(source, ref.textSpan.start);
    if (!foundRef) return [];

    const pathParts = [...originalWip];
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
          return crawlScope(foundRef.name, pathParts, allFields, source, info);
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

  return results;
};

export const checkFieldUsageInFile = (
  source: ts.SourceFile,
  nodes: ts.NoSubstitutionTemplateLiteral[],
  info: ts.server.PluginCreateInfo
) => {
  const diagnostics: ts.Diagnostic[] = [];
  const shouldTrackFieldUsage = info.config.trackFieldUsage ?? true;
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
      variableDeclaration.name.getStart()
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

      let temp = output.name;
      // Supported cases:
      // - const result = await client.query() || useFragment()
      // - const [result] = useQuery() --> urql
      // - const { data } = useQuery() --> Apollo
      // - const { field } = useFragment()
      // - const [{ data }] = useQuery()
      // - const { data: { pokemon } } = useQuery()
      if (
        ts.isArrayBindingPattern(temp) &&
        ts.isBindingElement(temp.elements[0])
      ) {
        temp = temp.elements[0].name;
      }

      let allAccess: string[] = [];
      if (ts.isObjectBindingPattern(temp)) {
        allAccess = traverseDestructuring(temp, [], allFields, source, info);
      } else {
        allAccess = crawlScope(temp, [], allFields, source, info);
      }

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
