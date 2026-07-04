import type { NameNode } from 'graphql';
import { parse, visit } from 'graphql';

import { ts } from './ts';
import {
  bubbleUpCallExpression,
  bubbleUpTemplate,
  findAllCallExpressions,
  findAllTaggedTemplateNodes,
  findNode,
  getSource,
} from './ast';
import * as checks from './ast/checks';

interface FragmentReferenceLocation {
  fileName: string;
  start: number;
  length: number;
  isDefinition: boolean;
}

interface FragmentNameToken {
  name: string;
  /** Span of the name token, in TS file offsets of the originating file */
  start: number;
  length: number;
  schemaName: string | null;
}

/** Strips the quotes/backticks off a document literal without unescaping,
 * so GraphQL AST offsets map 1:1 onto TS file offsets. */
const getDocumentText = (node: ts.StringLiteralLike): string =>
  node.getText().slice(1, -1);

const findFragmentNameAtOffset = (
  documentText: string,
  offset: number
): { name: string; start: number; length: number } | undefined => {
  let document;
  try {
    document = parse(documentText);
  } catch (_error) {
    return undefined;
  }

  let found: { name: string; start: number; length: number } | undefined;
  const checkName = (name: NameNode) => {
    const loc = name.loc;
    if (loc && offset >= loc.start && offset < loc.end) {
      found = {
        name: name.value,
        start: loc.start,
        length: loc.end - loc.start,
      };
    }
  };

  visit(document, {
    FragmentDefinition(node) {
      checkName(node.name);
    },
    FragmentSpread(node) {
      checkName(node.name);
    },
  });

  return found;
};

/** Resolves the cursor position to a fragment name token (at a fragment
 * definition or a fragment spread) inside a GraphQL document. */
const getFragmentTokenAtPosition = (
  filename: string,
  cursorPosition: number,
  info: ts.server.PluginCreateInfo
): FragmentNameToken | undefined => {
  const isCallExpression = info.config.templateIsCallExpression ?? true;
  const typeChecker = info.languageService.getProgram()?.getTypeChecker();
  const source = getSource(info, filename);
  if (!source) return undefined;

  let node = findNode(source, cursorPosition);
  if (!node) return undefined;
  node = isCallExpression
    ? bubbleUpCallExpression(node)
    : bubbleUpTemplate(node);

  let documentNode: ts.StringLiteralLike;
  let schemaName: string | null = null;

  if (isCallExpression && checks.isGraphQLCall(node, typeChecker)) {
    const text = node.arguments[0];
    if (!ts.isStringLiteralLike(text)) return undefined;
    documentNode = text;
    schemaName = checks.getSchemaName(node, typeChecker);
  } else if (!isCallExpression && checks.isGraphQLTag(node)) {
    // Templates with interpolations shift GraphQL offsets away from TS
    // offsets, so only plain templates are supported here
    if (!ts.isNoSubstitutionTemplateLiteral(node.template)) return undefined;
    documentNode = node.template;
  } else {
    return undefined;
  }

  const documentStart = documentNode.getStart() + 1;
  const documentOffset = cursorPosition - documentStart;
  const documentText = getDocumentText(documentNode);
  if (documentOffset < 0 || documentOffset >= documentText.length) {
    return undefined;
  }

  const token = findFragmentNameAtOffset(documentText, documentOffset);
  if (!token) return undefined;

  return {
    name: token.name,
    start: documentStart + token.start,
    length: token.length,
    schemaName,
  };
};

const collectFragmentReferencesInSource = (
  source: ts.SourceFile,
  token: FragmentNameToken,
  isCallExpression: boolean,
  info: ts.server.PluginCreateInfo,
  references: FragmentReferenceLocation[]
): void => {
  if (source.isDeclarationFile) return;
  if (source.fileName.includes('node_modules')) return;
  // Parsing every document in every file is wasteful; a plain-text scan
  // rules out files that can't possibly mention the fragment
  if (!source.getText().includes(token.name)) return;

  const documents: Array<ts.StringLiteralLike> = [];
  if (isCallExpression) {
    const { nodes } = findAllCallExpressions(source, info, {
      searchExternal: false,
      collectFragments: false,
    });
    for (const found of nodes) {
      // Same-named fragments may exist per schema in multi-schema setups;
      // only documents for the originating schema are related
      if (found.schema !== token.schemaName) continue;
      documents.push(found.node);
    }
  } else {
    for (const found of findAllTaggedTemplateNodes(source)) {
      const template = ts.isTaggedTemplateExpression(found)
        ? found.template
        : found;
      if (!ts.isNoSubstitutionTemplateLiteral(template)) continue;
      documents.push(template);
    }
  }

  for (const documentNode of documents) {
    const documentText = getDocumentText(documentNode);
    if (!documentText.includes(token.name)) continue;

    let document;
    try {
      document = parse(documentText);
    } catch (_error) {
      continue;
    }

    const documentStart = documentNode.getStart() + 1;
    const pushName = (name: NameNode, isDefinition: boolean) => {
      const loc = name.loc;
      if (name.value !== token.name || !loc) return;
      references.push({
        fileName: source.fileName,
        start: documentStart + loc.start,
        length: loc.end - loc.start,
        isDefinition,
      });
    };

    visit(document, {
      FragmentDefinition(node) {
        pushName(node.name, true);
      },
      FragmentSpread(node) {
        pushName(node.name, false);
      },
    });
  }
};

const findAllFragmentReferences = (
  token: FragmentNameToken,
  info: ts.server.PluginCreateInfo
): FragmentReferenceLocation[] => {
  const program = info.languageService.getProgram();
  if (!program) return [];

  const isCallExpression = info.config.templateIsCallExpression ?? true;
  const references: FragmentReferenceLocation[] = [];
  for (const source of program.getSourceFiles()) {
    collectFragmentReferencesInSource(
      source,
      token,
      isCallExpression,
      info,
      references
    );
  }

  return references;
};

export function getGraphQLFragmentReferences(
  filename: string,
  cursorPosition: number,
  info: ts.server.PluginCreateInfo
): ts.ReferencedSymbol[] | undefined {
  const token = getFragmentTokenAtPosition(filename, cursorPosition, info);
  if (!token) return undefined;

  const references = findAllFragmentReferences(token, info);
  if (!references.length) return undefined;

  const definition = references.find(ref => ref.isDefinition) || references[0];

  return [
    {
      definition: {
        fileName: definition.fileName,
        textSpan: { start: definition.start, length: definition.length },
        kind: ts.ScriptElementKind.constElement,
        name: token.name,
        containerKind: ts.ScriptElementKind.unknown,
        containerName: '',
        displayParts: [{ text: `fragment ${token.name}`, kind: 'text' }],
      },
      references: references.map(ref => ({
        fileName: ref.fileName,
        textSpan: { start: ref.start, length: ref.length },
        isWriteAccess: ref.isDefinition,
        isDefinition: ref.isDefinition,
      })),
    },
  ];
}

export function getGraphQLFragmentReferenceEntries(
  filename: string,
  cursorPosition: number,
  info: ts.server.PluginCreateInfo
): ts.ReferenceEntry[] | undefined {
  const token = getFragmentTokenAtPosition(filename, cursorPosition, info);
  if (!token) return undefined;

  const references = findAllFragmentReferences(token, info);
  if (!references.length) return undefined;

  return references.map(ref => ({
    fileName: ref.fileName,
    textSpan: { start: ref.start, length: ref.length },
    isWriteAccess: ref.isDefinition,
  }));
}

export function getGraphQLFragmentRenameInfo(
  filename: string,
  cursorPosition: number,
  info: ts.server.PluginCreateInfo
): ts.RenameInfoSuccess | undefined {
  const token = getFragmentTokenAtPosition(filename, cursorPosition, info);
  if (!token) return undefined;

  return {
    canRename: true,
    displayName: token.name,
    fullDisplayName: token.name,
    kind: ts.ScriptElementKind.constElement,
    kindModifiers: ts.ScriptElementKindModifier.none,
    triggerSpan: { start: token.start, length: token.length },
  };
}

export function getGraphQLFragmentRenameLocations(
  filename: string,
  cursorPosition: number,
  info: ts.server.PluginCreateInfo
): readonly ts.RenameLocation[] | undefined {
  const token = getFragmentTokenAtPosition(filename, cursorPosition, info);
  if (!token) return undefined;

  const references = findAllFragmentReferences(token, info);
  if (!references.length) return undefined;

  return references.map(ref => ({
    fileName: ref.fileName,
    textSpan: { start: ref.start, length: ref.length },
  }));
}
