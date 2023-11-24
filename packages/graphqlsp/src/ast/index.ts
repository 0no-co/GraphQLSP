import ts from 'typescript/lib/tsserverlibrary';
import {
  isCallExpression,
  isImportDeclaration,
  isNoSubstitutionTemplateLiteral,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isStringLiteral,
  isTaggedTemplateExpression,
  isTemplateExpression,
  isTemplateSpan,
  isToken,
  isVariableStatement,
} from 'typescript';
import fs from 'fs';
import { FragmentDefinitionNode, parse } from 'graphql';

export function isFileDirty(fileName: string, source: ts.SourceFile) {
  const contents = fs.readFileSync(fileName, 'utf-8');
  const currentText = source.getFullText();

  return currentText !== contents;
}

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
      isTaggedTemplateExpression(node) ||
      isNoSubstitutionTemplateLiteral(node)
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
  const logger = (msg: string) =>
    info.project.projectService.logger.info(`[GraphQLSP] ${msg}`);
  const result: Array<ts.NoSubstitutionTemplateLiteral> = [];
  const fragments: Array<FragmentDefinitionNode> = [];
  let hasTriedToFindFragments = false;
  function find(node: ts.Node) {
    if (isCallExpression(node) && node.expression.getText() === template) {
      if (!hasTriedToFindFragments) {
        hasTriedToFindFragments = true;
        const definitions = info.languageService.getDefinitionAtPosition(
          sourceFile.fileName,
          node.expression.getStart()
        );
        if (!definitions) return;

        const def = definitions[0];
        const src = getSource(info, def.fileName);
        if (!src) return;

        // TODO: nested fragments
        ts.forEachChild(src, node => {
          if (
            isVariableStatement(node) &&
            node.declarationList &&
            node.declarationList.declarations[0].name.getText() === 'documents'
          ) {
            const [declaration] = node.declarationList.declarations;
            if (
              declaration.initializer &&
              isObjectLiteralExpression(declaration.initializer)
            ) {
              declaration.initializer.properties.forEach(property => {
                if (
                  isPropertyAssignment(property) &&
                  isStringLiteral(property.name)
                ) {
                  try {
                    const possibleFragment = JSON.parse(
                      property.name.getFullText()
                    );
                    if (
                      possibleFragment.includes('fragment ') &&
                      possibleFragment.includes(' on ')
                    ) {
                      const parsed = parse(possibleFragment.slice(1, -1), {
                        noLocation: true,
                      });
                      parsed.definitions.forEach(definition => {
                        if (definition.kind === 'FragmentDefinition') {
                          fragments.push(definition);
                        }
                      });
                    }
                  } catch (e: any) {
                    logger('error parsing fragment: ' + e.message);
                  }
                }
              });
            }
          }
        });
      }
      const [arg] = node.arguments;
      if (arg && isNoSubstitutionTemplateLiteral(arg)) {
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

export function findAllImports(
  sourceFile: ts.SourceFile
): Array<ts.ImportDeclaration> {
  return sourceFile.statements.filter(isImportDeclaration);
}

export function bubbleUpTemplate(node: ts.Node): ts.Node {
  while (
    isNoSubstitutionTemplateLiteral(node) ||
    isToken(node) ||
    isTemplateExpression(node) ||
    isTemplateSpan(node)
  ) {
    node = node.parent;
  }

  return node;
}
