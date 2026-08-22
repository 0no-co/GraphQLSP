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
  resolveIdentifierToGraphQLCall,
} from './ast';
import * as checks from './ast/checks';
import { resolveTadaFragmentArray } from './ast/resolve';

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
  isDefinition: boolean;
  callNode?: checks.GraphQLCallNode;
}

/** Strips the quotes/backticks off a document literal without unescaping,
 * so GraphQL AST offsets map 1:1 onto TS file offsets. */
const getDocumentText = (node: ts.StringLiteralLike): string =>
  node.getText().slice(1, -1);

const findFragmentNameAtOffset = (
  documentText: string,
  offset: number
):
  | { name: string; start: number; length: number; isDefinition: boolean }
  | undefined => {
  let document;
  try {
    document = parse(documentText);
  } catch (_error) {
    return undefined;
  }

  let found:
    | { name: string; start: number; length: number; isDefinition: boolean }
    | undefined;
  const checkName = (name: NameNode, isDefinition: boolean) => {
    const loc = name.loc;
    if (loc && offset >= loc.start && offset < loc.end) {
      found = {
        name: name.value,
        start: loc.start,
        length: loc.end - loc.start,
        isDefinition,
      };
    }
  };

  visit(document, {
    FragmentDefinition(node) {
      checkName(node.name, true);
    },
    FragmentSpread(node) {
      checkName(node.name, false);
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
  let callNode: checks.GraphQLCallNode | undefined;

  if (isCallExpression && checks.isGraphQLCall(node, typeChecker)) {
    const text = node.arguments[0];
    if (!ts.isStringLiteralLike(text)) return undefined;
    documentNode = text;
    callNode = node;
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
    isDefinition: token.isDefinition,
    callNode,
  };
};

interface FragmentDocument {
  callNode?: checks.GraphQLCallNode;
  dependencies: Set<checks.GraphQLCallNode>;
  definitions: FragmentReferenceLocation[];
  spreads: FragmentReferenceLocation[];
}

const collectCallDependencies = (
  callNode: checks.GraphQLCallNode,
  info: ts.server.PluginCreateInfo,
  typeChecker: ts.TypeChecker | undefined,
  dependencies = new Set<checks.GraphQLCallNode>()
): Set<checks.GraphQLCallNode> => {
  const fragmentRefs = resolveTadaFragmentArray(callNode.arguments[1]);
  if (!fragmentRefs) return dependencies;

  for (const identifier of fragmentRefs) {
    const dependency = resolveIdentifierToGraphQLCall(
      identifier,
      info,
      typeChecker
    );
    if (!dependency || dependencies.has(dependency)) continue;
    dependencies.add(dependency);
    collectCallDependencies(dependency, info, typeChecker, dependencies);
  }

  return dependencies;
};

const parseFragmentDocument = (
  source: ts.SourceFile,
  documentNode: ts.StringLiteralLike,
  token: FragmentNameToken,
  callNode: checks.GraphQLCallNode | undefined,
  dependencies: Set<checks.GraphQLCallNode>
): FragmentDocument | undefined => {
  const documentText = getDocumentText(documentNode);
  if (!documentText.includes(token.name)) return undefined;

  let document;
  try {
    document = parse(documentText);
  } catch (_error) {
    return undefined;
  }

  const definitions: FragmentReferenceLocation[] = [];
  const spreads: FragmentReferenceLocation[] = [];
  const documentStart = documentNode.getStart() + 1;
  const pushName = (name: NameNode, isDefinition: boolean) => {
    const loc = name.loc;
    if (name.value !== token.name || !loc) return;
    (isDefinition ? definitions : spreads).push({
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

  if (!definitions.length && !spreads.length) return undefined;
  return { callNode, dependencies, definitions, spreads };
};

const collectFragmentDocuments = (
  token: FragmentNameToken,
  info: ts.server.PluginCreateInfo
): FragmentDocument[] => {
  const program = info.languageService.getProgram();
  if (!program) return [];

  const isCallExpression = info.config.templateIsCallExpression ?? true;
  const typeChecker = program.getTypeChecker();
  const documents: FragmentDocument[] = [];
  for (const source of program.getSourceFiles()) {
    if (source.isDeclarationFile || source.fileName.includes('node_modules')) {
      continue;
    }
    // Parsing every document in every file is wasteful; a plain-text scan
    // rules out files that can't possibly mention the fragment.
    if (!source.getText().includes(token.name)) continue;

    if (isCallExpression) {
      const { nodes } = findAllCallExpressions(source, info, {
        searchExternal: false,
        collectFragments: false,
      });
      for (const found of nodes) {
        if (found.schema !== token.schemaName) continue;
        if (!ts.isStringLiteralLike(found.node)) continue;
        const parent = found.node.parent;
        const callNode = ts.isCallExpression(parent) ? parent : undefined;
        const document = parseFragmentDocument(
          source,
          found.node,
          token,
          callNode,
          callNode
            ? collectCallDependencies(callNode, info, typeChecker)
            : new Set()
        );
        if (document) documents.push(document);
      }
    } else {
      for (const found of findAllTaggedTemplateNodes(source)) {
        const template = ts.isTaggedTemplateExpression(found)
          ? found.template
          : found;
        if (!ts.isNoSubstitutionTemplateLiteral(template)) continue;
        const document = parseFragmentDocument(
          source,
          template,
          token,
          undefined,
          new Set()
        );
        if (document) documents.push(document);
      }
    }
  }

  return documents;
};

const findAllFragmentReferences = (
  token: FragmentNameToken,
  info: ts.server.PluginCreateInfo
): FragmentReferenceLocation[] => {
  const documents = collectFragmentDocuments(token, info);
  if (!documents.length) return [];

  // Tagged-template/global-fragment mode has no explicit dependency identity,
  // so preserve the existing project-wide name matching there.
  if (!token.callNode) {
    return documents.flatMap(document => [
      ...document.definitions,
      ...document.spreads,
    ]);
  }

  const targetCalls = new Set<checks.GraphQLCallNode>();
  if (token.isDefinition) {
    targetCalls.add(token.callNode);
  } else {
    const origin = documents.find(
      document => document.callNode === token.callNode
    );
    if (origin?.definitions.length) targetCalls.add(token.callNode);
    if (origin) {
      for (const document of documents) {
        if (
          document.callNode &&
          origin.dependencies.has(document.callNode) &&
          document.definitions.length
        ) {
          targetCalls.add(document.callNode);
        }
      }
    }
  }

  // Calls without an explicit fragment dependency cannot be disambiguated;
  // retain the old name-based behavior instead of dropping references.
  if (!targetCalls.size) {
    return documents.flatMap(document => [
      ...document.definitions,
      ...document.spreads,
    ]);
  }

  const references: FragmentReferenceLocation[] = [];
  for (const document of documents) {
    if (document.callNode && targetCalls.has(document.callNode)) {
      references.push(...document.definitions, ...document.spreads);
      continue;
    }
    if ([...targetCalls].some(target => document.dependencies.has(target))) {
      references.push(...document.spreads);
    }
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
