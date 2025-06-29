import { ts } from '../ts';
import { FragmentDefinitionNode, parse } from 'graphql';
import * as checks from './checks';
import { resolveTadaFragmentArray } from './resolve';
import {
  getDeclarationOfIdentifier,
  getValueOfIdentifier,
  getIdentifierOfChainExpression,
} from './declaration';

export { getSchemaName } from './checks';

/** @deprecated: use program.getSourceFile directly */
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
  checker: ts.TypeChecker
): Array<FragmentDefinitionNode> {
  const fragments: FragmentDefinitionNode[] = [];
  const elements: ts.Identifier[] = [element];
  const seen = new WeakSet<ts.Identifier>();

  const _unrollElement = (element: ts.Identifier): void => {
    if (seen.has(element)) return;
    seen.add(element);

    const value = getValueOfIdentifier(element, checker);
    if (!value || !checks.isGraphQLCall(value, checker)) return;

    const fragmentRefs = resolveTadaFragmentArray(value.arguments[1]);
    if (fragmentRefs) elements.push(...fragmentRefs);

    try {
      const text = value.arguments[0];
      const parsed = parse(text.getText().slice(1, -1), { noLocation: true });
      parsed.definitions.forEach(definition => {
        if (definition.kind === 'FragmentDefinition') {
          fragments.push(definition);
        }
      });
    } catch (_error) {
      // NOTE: Assume graphql.parse errors can be ignored
    }
  };

  let nextElement: ts.Identifier | undefined;
  while ((nextElement = elements.shift()) !== undefined)
    _unrollElement(nextElement);
  return fragments;
}

export function unrollTadaFragments(
  fragmentsArray: ts.ArrayLiteralExpression,
  wip: FragmentDefinitionNode[],
  checker: ts.TypeChecker
): FragmentDefinitionNode[] {
  fragmentsArray.elements.forEach(element => {
    // TODO(@kitten): Use getIdentifierOfChainExpression
    if (ts.isIdentifier(element)) {
      wip.push(...unrollFragment(element, checker));
    } else if (ts.isPropertyAccessExpression(element)) {
      let el = element;
      while (ts.isPropertyAccessExpression(el.expression)) el = el.expression;
      if (ts.isIdentifier(el.name)) {
        wip.push(...unrollFragment(el.name, checker));
      }
    }
  });

  return wip;
}

export function findAllCallExpressions(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
  shouldSearchFragments: boolean = true
): {
  nodes: Array<{
    node: ts.StringLiteralLike;
    schema: string | null;
  }>;
  fragments: Array<FragmentDefinitionNode>;
} {
  //const typeChecker = info.languageService.getProgram()?.getTypeChecker();
  const result: Array<{
    node: ts.StringLiteralLike;
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
    if (!checks.isGraphQLCall(node, checker)) {
      return ts.forEachChild(node, find);
    }

    const name = checks.getSchemaName(node, checker);
    const text = node.arguments[0];
    const fragmentRefs = resolveTadaFragmentArray(node.arguments[1]);

    if (!hasTriedToFindFragments && !fragmentRefs) {
      hasTriedToFindFragments = true;
      fragments.push(...getAllFragments(node, checker));
    } else if (fragmentRefs) {
      for (const identifier of fragmentRefs) {
        fragments.push(...unrollFragment(identifier, checker));
      }
    }

    if (text && ts.isStringLiteralLike(text)) {
      result.push({ node: text, schema: name });
    }
  }
  find(sourceFile);
  return { nodes: result, fragments };
}

export function findAllPersistedCallExpressions(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker
) {
  const result: { node: ts.CallExpression; schema: string | null }[] = [];
  function find(node: ts.Node): void {
    if (!ts.isCallExpression(node) || checks.isIIFE(node)) {
      return ts.forEachChild(node, find);
    } else if (checks.isTadaPersistedCall(node, checker)) {
      const name = checks.getSchemaName(node, checker, true);
      result.push({ node, schema: name });
    }
  }
  find(sourceFile);
  return result;
}

export function getAllFragments(node: ts.Node, checker: ts.TypeChecker) {
  let fragments: Array<FragmentDefinitionNode> = [];
  // TODO(@kitten): is this redundant and could `node` be narrowed first?
  if (!ts.isCallExpression(node)) {
    return fragments;
  }

  const fragmentRefs = resolveTadaFragmentArray(node.arguments[1]);
  if (fragmentRefs) {
    for (const identifier of fragmentRefs) {
      fragments.push(...unrollFragment(identifier, checker));
    }
    return fragments;
  } else if (checks.isTadaGraphQLCall(node, checker)) {
    return fragments;
  }

  const identifier = getIdentifierOfChainExpression(node.expression);
  if (!identifier) return fragments;

  const declaration = getDeclarationOfIdentifier(identifier, checker);
  if (!declaration) return fragments;

  const sourceFile = declaration.getSourceFile();
  if (!sourceFile) return fragments;

  // TODO(@kitten): This was previously doing `getSource(info, sourceFile.fileName)`
  // However, `sourceFile` already exists in here... Presumably this was redundant
  ts.forEachChild(sourceFile, node => {
    if (
      ts.isVariableStatement(node) &&
      node.declarationList &&
      node.declarationList.declarations[0] &&
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
    ts.isStringLiteralLike(node) ||
    ts.isToken(node) ||
    ts.isTemplateExpression(node) ||
    ts.isTemplateSpan(node)
  ) {
    node = node.parent;
  }

  return node;
}
