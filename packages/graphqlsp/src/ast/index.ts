import { ts } from '../ts';
import { FragmentDefinitionNode, parse } from 'graphql';
import * as checks from './checks';

export { getSchemaName } from './checks';

export function getSource(info: ts.server.PluginCreateInfo, filename: string) {
  const program = info.languageService.getProgram();
  if (!program) return undefined;

  const source = program.getSourceFile(filename);
  if (!source) return undefined;

  return source;
}

export function findNode(
  sourceFile: ts.SourceFile,
  position: number
): ts.Node | undefined {
  function find(node: ts.Node): ts.Node | undefined {
    if (position >= node.getStart() && position < node.getEnd()) {
      return ts.forEachChild(node, find) || node;
    }
  }
  return find(sourceFile);
}

export function findAllTaggedTemplateNodes(
  sourceFile: ts.SourceFile | ts.Node
): Array<ts.TaggedTemplateExpression | ts.NoSubstitutionTemplateLiteral> {
  const result: Array<
    ts.TaggedTemplateExpression | ts.NoSubstitutionTemplateLiteral
  > = [];
  function find(node: ts.Node) {
    if (
      checks.isGraphQLTag(node) ||
      (ts.isNoSubstitutionTemplateLiteral(node) &&
        checks.isGraphQLTag(node.parent))
    ) {
      result.push(node);
      return;
    } else {
      ts.forEachChild(node, find);
    }
  }
  find(sourceFile);
  return result;
}

function unrollFragment(
  element: ts.Identifier,
  info: ts.server.PluginCreateInfo,
  typeChecker: ts.TypeChecker | undefined
): Array<FragmentDefinitionNode> {
  const fragments: Array<FragmentDefinitionNode> = [];
  const definitions = info.languageService.getDefinitionAtPosition(
    element.getSourceFile().fileName,
    element.getStart()
  );

  if (!definitions || !definitions.length) return fragments;

  const [fragment] = definitions;

  const externalSource = getSource(info, fragment.fileName);
  if (!externalSource) return fragments;

  let found = findNode(externalSource, fragment.textSpan.start);
  if (!found) return fragments;

  if (
    ts.isVariableDeclaration(found.parent) &&
    found.parent.initializer &&
    ts.isCallExpression(found.parent.initializer)
  ) {
    found = found.parent.initializer;
  } else if (ts.isPropertyAssignment(found.parent)) {
    found = found.parent.initializer;
  }

  // Check whether we've got a `graphql()` or `gql()` call, by the
  // call expression's identifier
  if (!checks.isGraphQLCall(found, typeChecker)) {
    return fragments;
  }

  try {
    const [arg, arg2] = found.arguments;
    if (arg2 && ts.isArrayLiteralExpression(arg2)) {
      arg2.elements.forEach(element => {
        if (ts.isIdentifier(element)) {
          fragments.push(...unrollFragment(element, info, typeChecker));
        }
      });
    }
    const parsed = parse(arg.getText().slice(1, -1), { noLocation: true });
    parsed.definitions.forEach(definition => {
      if (definition.kind === 'FragmentDefinition') {
        fragments.push(definition);
      }
    });
  } catch (e) {}

  return fragments;
}

export function unrollTadaFragments(
  fragmentsArray: ts.ArrayLiteralExpression,
  wip: FragmentDefinitionNode[],
  info: ts.server.PluginCreateInfo
): FragmentDefinitionNode[] {
  const typeChecker = info.languageService.getProgram()?.getTypeChecker();
  fragmentsArray.elements.forEach(element => {
    if (ts.isIdentifier(element)) {
      wip.push(...unrollFragment(element, info, typeChecker));
    } else if (ts.isPropertyAccessExpression(element)) {
      let el = element;
      while (ts.isPropertyAccessExpression(el.expression)) {
        el = el.expression;
      }

      if (ts.isIdentifier(el.name)) {
        wip.push(...unrollFragment(el.name, info, typeChecker));
      }
    }
  });

  return wip;
}

export function findAllCallExpressions(
  sourceFile: ts.SourceFile,
  info: ts.server.PluginCreateInfo,
  shouldSearchFragments: boolean = true
): {
  nodes: Array<{
    node: ts.NoSubstitutionTemplateLiteral;
    schema: string | null;
  }>;
  fragments: Array<FragmentDefinitionNode>;
} {
  const typeChecker = info.languageService.getProgram()?.getTypeChecker();
  const result: Array<{
    node: ts.NoSubstitutionTemplateLiteral;
    schema: string | null;
  }> = [];
  let fragments: Array<FragmentDefinitionNode> = [];
  let hasTriedToFindFragments = shouldSearchFragments ? false : true;

  function find(node: ts.Node): void {
    if (!ts.isCallExpression(node) || checks.isIIFE(node)) {
      return ts.forEachChild(node, find);
    }

    // Check whether we've got a `graphql()` or `gql()` call, by the
    // call expression's identifier
    if (!checks.isGraphQLCall(node, typeChecker)) {
      return;
    }

    const name = checks.getSchemaName(node, typeChecker);
    const [arg, arg2] = node.arguments;

    if (!hasTriedToFindFragments && !arg2) {
      hasTriedToFindFragments = true;
      fragments.push(...getAllFragments(sourceFile.fileName, node, info));
    } else if (arg2 && ts.isArrayLiteralExpression(arg2)) {
      arg2.elements.forEach(element => {
        if (ts.isIdentifier(element)) {
          fragments.push(...unrollFragment(element, info, typeChecker));
        } else if (ts.isPropertyAccessExpression(element)) {
          let el = element;
          while (ts.isPropertyAccessExpression(el.expression)) {
            el = el.expression;
          }

          if (ts.isIdentifier(el.name)) {
            fragments.push(...unrollFragment(el.name, info, typeChecker));
          }
        }
      });
    }

    if (arg && ts.isNoSubstitutionTemplateLiteral(arg)) {
      result.push({ node: arg, schema: name });
    }
  }
  find(sourceFile);
  return { nodes: result, fragments };
}

export function findAllPersistedCallExpressions(
  sourceFile: ts.SourceFile
): Array<ts.CallExpression>;
export function findAllPersistedCallExpressions(
  sourceFile: ts.SourceFile,
  info: ts.server.PluginCreateInfo
): Array<{ node: ts.CallExpression; schema: string | null }>;

export function findAllPersistedCallExpressions(
  sourceFile: ts.SourceFile,
  info?: ts.server.PluginCreateInfo
) {
  const result: Array<
    ts.CallExpression | { node: ts.CallExpression; schema: string | null }
  > = [];
  const typeChecker = info?.languageService.getProgram()?.getTypeChecker();
  function find(node: ts.Node): void {
    if (!ts.isCallExpression(node) || checks.isIIFE(node)) {
      return ts.forEachChild(node, find);
    }

    if (!checks.isTadaPersistedCall(node, typeChecker)) {
      return;
    } else if (info) {
      const name = checks.getSchemaName(node, typeChecker);
      result.push({ node, schema: name });
    } else {
      result.push(node);
    }
  }
  find(sourceFile);
  return result;
}

export function getAllFragments(
  fileName: string,
  node: ts.Node,
  info: ts.server.PluginCreateInfo
) {
  let fragments: Array<FragmentDefinitionNode> = [];

  const typeChecker = info.languageService.getProgram()?.getTypeChecker();
  if (!ts.isCallExpression(node)) {
    return fragments;
  } else if (
    node.arguments[1] &&
    ts.isArrayLiteralExpression(node.arguments[1])
  ) {
    const typeChecker = info.languageService.getProgram()?.getTypeChecker();
    const arg2 = node.arguments[1] as ts.ArrayLiteralExpression;
    arg2.elements.forEach(element => {
      if (ts.isIdentifier(element)) {
        fragments.push(...unrollFragment(element, info, typeChecker));
      }
    });
    return fragments;
  } else if (checks.isTadaGraphQLCall(node, typeChecker)) {
    return fragments;
  }

  const definitions = info.languageService.getDefinitionAtPosition(
    fileName,
    node.expression.getStart()
  );
  if (!definitions || !definitions.length) return fragments;

  const def = definitions[0];
  if (!def) return fragments;
  const src = getSource(info, def.fileName);
  if (!src) return fragments;

  ts.forEachChild(src, node => {
    if (
      ts.isVariableStatement(node) &&
      node.declarationList &&
      node.declarationList.declarations[0].name.getText() === 'documents'
    ) {
      const [declaration] = node.declarationList.declarations;
      if (
        declaration.initializer &&
        ts.isObjectLiteralExpression(declaration.initializer)
      ) {
        declaration.initializer.properties.forEach(property => {
          if (
            ts.isPropertyAssignment(property) &&
            ts.isStringLiteral(property.name)
          ) {
            try {
              const possibleFragment = JSON.parse(
                `${property.name.getText().replace(/'/g, '"')}`
              );

              if (
                possibleFragment.includes('fragment ') &&
                possibleFragment.includes(' on ')
              ) {
                const parsed = parse(possibleFragment, {
                  noLocation: true,
                });
                parsed.definitions.forEach(definition => {
                  if (definition.kind === 'FragmentDefinition') {
                    fragments.push(definition);
                  }
                });
              }
            } catch (e: any) {}
          }
        });
      }
    }
  });

  return fragments;
}

export function findAllImports(
  sourceFile: ts.SourceFile
): Array<ts.ImportDeclaration> {
  return sourceFile.statements.filter(ts.isImportDeclaration);
}

export function bubbleUpTemplate(node: ts.Node): ts.Node {
  while (
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isToken(node) ||
    ts.isTemplateExpression(node) ||
    ts.isTemplateSpan(node)
  ) {
    node = node.parent;
  }

  return node;
}

export function bubbleUpCallExpression(node: ts.Node): ts.Node {
  while (
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isToken(node) ||
    ts.isTemplateExpression(node) ||
    ts.isTemplateSpan(node)
  ) {
    node = node.parent;
  }

  return node;
}
