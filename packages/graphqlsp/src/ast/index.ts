import ts from 'typescript/lib/tsserverlibrary';
import { FragmentDefinitionNode, parse } from 'graphql';

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
      ts.isTaggedTemplateExpression(node) ||
      ts.isNoSubstitutionTemplateLiteral(node)
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

export function findAllCallExpressions(
  sourceFile: ts.SourceFile,
  template: string,
  info: ts.server.PluginCreateInfo
): {
  nodes: Array<ts.NoSubstitutionTemplateLiteral>;
  fragments: Array<FragmentDefinitionNode>;
} {
  const result: Array<ts.NoSubstitutionTemplateLiteral> = [];
  let fragments: Array<FragmentDefinitionNode> = [];
  let hasTriedToFindFragments = false;
  function find(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText() === template) {
      if (!hasTriedToFindFragments) {
        hasTriedToFindFragments = true;
        fragments = getAllFragments(sourceFile.fileName, node, info);
      }
      const [arg] = node.arguments;
      if (arg && ts.isNoSubstitutionTemplateLiteral(arg)) {
        result.push(arg);
      }
      return;
    } else {
      ts.forEachChild(node, find);
    }
  }
  find(sourceFile);
  return { nodes: result, fragments };
}

export function getAllFragments(
  fileName: string,
  node: ts.CallExpression,
  info: ts.server.PluginCreateInfo
) {
  let fragments: Array<FragmentDefinitionNode> = [];

  const definitions = info.languageService.getDefinitionAtPosition(
    fileName,
    node.expression.getStart()
  );
  if (!definitions) return fragments;

  const def = definitions[0];
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
