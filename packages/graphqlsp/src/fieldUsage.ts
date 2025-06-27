import { ts } from './ts';
import { parse, visit } from 'graphql';

import { findNode } from './ast';
import {
  getDeclarationOfIdentifier,
  getValueOfValueDeclaration,
} from './ast/declaration';
import { findVariableDeclaration, unwrapToObjectType } from './ast/helpers';

export const UNUSED_FIELD_CODE = 52005;

// Moved to helpers.ts as unwrapToObjectType

// Moved to helpers.ts as findVariableDeclaration

const traverseArrayDestructuring = (
  node: ts.ArrayBindingPattern,
  originalWip: Array<string>,
  allFields: Array<string>,
  source: ts.SourceFile,
  info: ts.server.PluginCreateInfo
): Array<string> => {
  return node.elements.flatMap(element => {
    if (ts.isOmittedExpression(element)) return [];

    const wip = [...originalWip];
    return ts.isIdentifier(element.name)
      ? crawlScope(element.name, wip, allFields, source, info, false)
      : ts.isObjectBindingPattern(element.name)
      ? traverseDestructuring(element.name, wip, allFields, source, info)
      : traverseArrayDestructuring(element.name, wip, allFields, source, info);
  });
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
        !originalWip.includes(binding.propertyName.getText())
      ) {
        const joined = [...wip, binding.propertyName.getText()].join('.');
        if (allFields.find(x => x.startsWith(joined))) {
          wip.push(binding.propertyName.getText());
        }
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
        !originalWip.includes(binding.propertyName.getText())
      ) {
        const joined = [...wip, binding.propertyName.getText()].join('.');
        if (allFields.find(x => x.startsWith(joined))) {
          wip.push(binding.propertyName.getText());
        }
      } else {
        const joined = [...wip, binding.name.getText()].join('.');
        if (allFields.find(x => x.startsWith(joined))) {
          wip.push(binding.name.getText());
        }
      }

      const crawlResult = crawlScope(
        binding.name,
        wip,
        allFields,
        source,
        info,
        false
      );

      results.push(...crawlResult);
    }
  }

  return results;
};

const arrayMethods = new Set([
  'map',
  'filter',
  'forEach',
  'reduce',
  'every',
  'some',
  'find',
  'flatMap',
  'sort',
]);

const crawlScope = (
  node: ts.BindingName,
  originalWip: Array<string>,
  allFields: Array<string>,
  source: ts.SourceFile,
  info: ts.server.PluginCreateInfo,
  inArrayMethod: boolean
): Array<string> => {
  if (ts.isObjectBindingPattern(node)) {
    return traverseDestructuring(node, originalWip, allFields, source, info);
  } else if (ts.isArrayBindingPattern(node)) {
    return traverseArrayDestructuring(
      node,
      originalWip,
      allFields,
      source,
      info
    );
  }

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
      ts.isBinaryExpression(foundRef) ||
      ts.isReturnStatement(foundRef) ||
      ts.isArrowFunction(foundRef)
    ) {
      if (
        !inArrayMethod &&
        (ts.isReturnStatement(foundRef) || ts.isArrowFunction(foundRef))
      ) {
        // When we are returning the ref or we are dealing with an implicit return
        // we mark all its children as used (bail scenario)
        const joined = pathParts.join('.');
        const bailedFields = allFields.filter(x => x.startsWith(joined + '.'));
        return bailedFields;
      } else if (ts.isVariableDeclaration(foundRef)) {
        return crawlScope(
          foundRef.name,
          pathParts,
          allFields,
          source,
          info,
          false
        );
      } else if (
        ts.isIdentifier(foundRef) &&
        !pathParts.includes(foundRef.text)
      ) {
        const joined = [...pathParts, foundRef.text].join('.');
        if (allFields.find(x => x.startsWith(joined + '.'))) {
          pathParts.push(foundRef.text);
        }
      } else if (
        ts.isPropertyAccessExpression(foundRef) &&
        foundRef.name.text === 'at' &&
        ts.isCallExpression(foundRef.parent)
      ) {
        foundRef = foundRef.parent;
      } else if (
        ts.isPropertyAccessExpression(foundRef) &&
        arrayMethods.has(foundRef.name.text) &&
        ts.isCallExpression(foundRef.parent)
      ) {
        const isReduce = foundRef.name.text === 'reduce';
        const isSomeOrEvery =
          foundRef.name.text === 'every' || foundRef.name.text === 'some';
        const callExpression = foundRef.parent;
        let func: ts.Expression | ts.FunctionDeclaration | undefined =
          callExpression.arguments[0];

        if (func && ts.isIdentifier(func)) {
          const checker = info.languageService.getProgram()!.getTypeChecker();
          const declaration = getDeclarationOfIdentifier(func, checker);

          if (declaration && ts.isFunctionDeclaration(declaration)) {
            func = declaration;
          } else if (declaration) {
            const value = getValueOfValueDeclaration(declaration);
            if (
              value &&
              (ts.isExpression(value) || ts.isFunctionDeclaration(value))
            ) {
              func = value;
            }
          }
        }

        if (
          func &&
          (ts.isFunctionDeclaration(func) ||
            ts.isFunctionExpression(func) ||
            ts.isArrowFunction(func))
        ) {
          const param = func.parameters[isReduce ? 1 : 0];
          if (param) {
            const res = crawlScope(
              param.name,
              pathParts,
              allFields,
              source,
              info,
              true
            );

            if (
              ts.isVariableDeclaration(callExpression.parent) &&
              !isSomeOrEvery
            ) {
              const varRes = crawlScope(
                callExpression.parent.name,
                pathParts,
                allFields,
                source,
                info,
                true
              );
              res.push(...varRes);
            }

            return res;
          }
        }
      } else if (
        ts.isPropertyAccessExpression(foundRef) &&
        !pathParts.includes(foundRef.name.text)
      ) {
        const joined = [...pathParts, foundRef.name.text].join('.');
        if (allFields.find(x => x.startsWith(joined))) {
          pathParts.push(foundRef.name.text);
        }
      } else if (
        ts.isElementAccessExpression(foundRef) &&
        ts.isStringLiteral(foundRef.argumentExpression) &&
        !pathParts.includes(foundRef.argumentExpression.text)
      ) {
        const joined = [...pathParts, foundRef.argumentExpression.text].join(
          '.'
        );
        if (allFields.find(x => x.startsWith(joined))) {
          pathParts.push(foundRef.argumentExpression.text);
        }
      }

      if (ts.isNonNullExpression(foundRef.parent)) {
        foundRef = foundRef.parent.parent;
      } else {
        foundRef = foundRef.parent;
      }
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

  const defaultReservedKeys = ['id', '_id', '__typename'];
  const additionalKeys = info.config.reservedKeys ?? [];
  const reservedKeys = new Set([...defaultReservedKeys, ...additionalKeys]);
  const checker = info.languageService.getProgram()?.getTypeChecker();
  if (!checker) return;

  try {
    nodes.forEach(node => {
      const nodeText = node.getText();
      // Bailing for mutations/subscriptions as these could have small details
      // for normalised cache interactions
      if (nodeText.includes('mutation') || nodeText.includes('subscription'))
        return;

      const variableDeclaration = findVariableDeclaration(node);
      if (!variableDeclaration) return;

      let dataType: ts.Type | undefined;

      const type = checker.getTypeAtLocation(node.parent) as
        | ts.TypeReference
        | ts.Type;
      // Attempt to retrieve type from internally resolve type arguments
      if ('target' in type) {
        const typeArguments = (type as any)
          .resolvedTypeArguments as readonly ts.Type[];
        dataType =
          typeArguments && typeArguments.length > 1
            ? typeArguments[0]
            : undefined;
      }
      // Fallback to resolving the type from scratch
      if (!dataType) {
        const apiTypeSymbol = type.getProperty('__apiType');
        if (apiTypeSymbol) {
          let apiType = checker.getTypeOfSymbol(apiTypeSymbol);
          let callSignature: ts.Signature | undefined =
            type.getCallSignatures()[0];
          if (apiType.isUnionOrIntersection()) {
            for (const type of apiType.types) {
              callSignature = type.getCallSignatures()[0];
              if (callSignature) {
                dataType = callSignature.getReturnType();
                break;
              }
            }
          }
          dataType = callSignature && callSignature.getReturnType();
        }
      }

      const references = info.languageService.getReferencesAtPosition(
        source.fileName,
        variableDeclaration.name.getStart()
      );

      if (!references) return;

      const allAccess: string[] = [];
      const inProgress: string[] = [];
      const allPaths: string[] = [];
      const fieldToLoc = new Map<string, { start: number; length: number }>();
      // This visitor gets all the leaf-paths in the document
      // as well as all fields that are part of the document
      // We need the leaf-paths to check usage and we need the
      // fields to validate whether an access on a given reference
      // is valid given the current document...
      visit(parse(node.getText().slice(1, -1)), {
        Field: {
          enter(node) {
            const alias = node.alias ? node.alias.value : node.name.value;
            const path = inProgress.length
              ? `${inProgress.join('.')}.${alias}`
              : alias;

            if (!node.selectionSet && !reservedKeys.has(node.name.value)) {
              allPaths.push(path);
              fieldToLoc.set(path, {
                start: node.name.loc!.start,
                length: node.name.loc!.end - node.name.loc!.start,
              });
            } else if (node.selectionSet) {
              inProgress.push(alias);
              fieldToLoc.set(path, {
                start: node.name.loc!.start,
                length: node.name.loc!.end - node.name.loc!.start,
              });
            }
          },
          leave(node) {
            if (node.selectionSet) {
              inProgress.pop();
            }
          },
        },
      });

      references.forEach(ref => {
        if (ref.fileName !== source.fileName) return;

        const targetNode = findNode(source, ref.textSpan.start);
        if (!targetNode) return;
        // Skip declaration as reference of itself
        if (targetNode.parent === variableDeclaration) return;

        const scopeSymbols = checker.getSymbolsInScope(
          targetNode,
          ts.SymbolFlags.BlockScopedVariable
        );

        let scopeDataSymbol: ts.Symbol | undefined;
        for (let scopeSymbol of scopeSymbols) {
          if (!scopeSymbol.valueDeclaration) continue;
          let typeOfScopeSymbol = unwrapToObjectType(
            checker.getTypeOfSymbol(scopeSymbol)
          );
          if (dataType === typeOfScopeSymbol) {
            scopeDataSymbol = scopeSymbol;
            break;
          }

          // NOTE: This is an aggressive fallback for hooks where the return value isn't destructured
          // This is a last resort solution for patterns like react-query, where the fallback that
          // would otherwise happen below isn't sufficient
          if (typeOfScopeSymbol.flags & ts.TypeFlags.Object) {
            const tuplePropertySymbol = typeOfScopeSymbol.getProperty('0');
            if (tuplePropertySymbol) {
              typeOfScopeSymbol = checker.getTypeOfSymbol(tuplePropertySymbol);
              if (dataType === typeOfScopeSymbol) {
                scopeDataSymbol = scopeSymbol;
                break;
              }
            }

            const dataPropertySymbol = typeOfScopeSymbol.getProperty('data');
            if (dataPropertySymbol) {
              typeOfScopeSymbol = unwrapToObjectType(
                checker.getTypeOfSymbol(dataPropertySymbol)
              );
              if (dataType === typeOfScopeSymbol) {
                scopeDataSymbol = scopeSymbol;
                break;
              }
            }
          }
        }

        const valueDeclaration = scopeDataSymbol?.valueDeclaration;
        let name: ts.BindingName | undefined;
        if (
          valueDeclaration &&
          'name' in valueDeclaration &&
          !!valueDeclaration.name &&
          (ts.isIdentifier(valueDeclaration.name as any) ||
            ts.isBindingName(valueDeclaration.name as any))
        ) {
          name = valueDeclaration.name as ts.BindingName;
        } else {
          // Fall back to looking at the variable declaration directly,
          // if we are on one.
          const variableDeclaration = findVariableDeclaration(targetNode);
          if (variableDeclaration) name = variableDeclaration.name;
        }

        if (name) {
          const result = crawlScope(name, [], allPaths, source, info, false);
          allAccess.push(...result);
        }
      });

      if (!allAccess.length) {
        return;
      }

      const unused = allPaths.filter(x => !allAccess.includes(x));
      const aggregatedUnusedFields = new Set<string>();
      const unusedChildren: { [key: string]: Set<string> } = {};
      const unusedFragmentLeaf = new Set<string>();
      unused.forEach(unusedField => {
        const split = unusedField.split('.');
        split.pop();
        const parentField = split.join('.');
        const loc = fieldToLoc.get(parentField);

        if (loc) {
          aggregatedUnusedFields.add(parentField);
          if (unusedChildren[parentField]) {
            unusedChildren[parentField]!.add(unusedField);
          } else {
            unusedChildren[parentField] = new Set([unusedField]);
          }
        } else {
          unusedFragmentLeaf.add(unusedField);
        }
      });

      aggregatedUnusedFields.forEach(field => {
        const loc = fieldToLoc.get(field)!;
        const unusedFields = unusedChildren[field]!;
        diagnostics.push({
          file: source,
          length: loc.length,
          start: node.getStart() + loc.start + 1,
          category: ts.DiagnosticCategory.Warning,
          code: UNUSED_FIELD_CODE,
          messageText: `Field(s) ${[...unusedFields]
            .map(x => `'${x}'`)
            .join(', ')} are not used.`,
        });
      });

      unusedFragmentLeaf.forEach(field => {
        const loc = fieldToLoc.get(field)!;
        diagnostics.push({
          file: source,
          length: loc.length,
          start: node.getStart() + loc.start + 1,
          category: ts.DiagnosticCategory.Warning,
          code: UNUSED_FIELD_CODE,
          messageText: `Field ${field} is not used.`,
        });
      });
    });
  } catch (e: any) {
    console.error('[GraphQLSP]: ', e.message, e.stack);
  }

  return diagnostics;
};
