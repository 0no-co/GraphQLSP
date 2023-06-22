import ts from 'typescript/lib/tsserverlibrary';
import {
  isImportDeclaration,
  isNoSubstitutionTemplateLiteral,
  isTaggedTemplateExpression,
  isTemplateExpression,
  isTemplateSpan,
  isToken,
} from 'typescript';
import fs from 'fs';

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
