import path from 'path';

import {
  FieldNode,
  FragmentDefinitionNode,
  GraphQLNamedType,
  GraphQLSchema,
  Kind,
  SelectionSetNode,
  TypeInfo,
  isInterfaceType,
  isObjectType,
  parse,
  visit,
  visitWithTypeInfo,
} from 'graphql';

import { ts } from './ts';
import {
  bubbleUpCallExpression,
  bubbleUpTemplate,
  findAllCallExpressions,
  findNode,
  getSource,
} from './ast';
import * as checks from './ast/checks';
import { SchemaRef, getSchemaForName } from './graphql/getSchema';

interface GraphQLFieldLocation {
  fileName: string;
  fieldName: string;
  parentName: string;
  start: number;
  length: number;
}

interface TadaCacheMatch {
  documentText: string;
  responsePath: string[];
}

const isPositionInRange = (position: number, start: number, end: number) =>
  position >= start && position < end;

const makeDefinitionInfo = (
  location: GraphQLFieldLocation
): ts.DefinitionInfo => ({
  fileName: location.fileName,
  textSpan: {
    start: location.start,
    length: location.length,
  },
  kind: ts.ScriptElementKind.memberVariableElement,
  name: location.fieldName,
  containerKind: ts.ScriptElementKind.interfaceElement,
  containerName: location.parentName,
});

const getNameText = (name: ts.PropertyName): string | undefined => {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  if (ts.isNumericLiteral(name)) return name.text;
  return undefined;
};

const containsNode = (outer: ts.Node, inner: ts.Node): boolean =>
  inner.getStart() >= outer.getStart() && inner.getEnd() <= outer.getEnd();

const getTypeReferenceName = (node: ts.TypeReferenceNode): string => {
  const name = node.typeName;
  return ts.isIdentifier(name) ? name.text : name.right.text;
};

const getTadaCacheMatch = (node: ts.Node): TadaCacheMatch | undefined => {
  const responsePath: string[] = [];
  let current: ts.Node | undefined = node;
  let cacheProperty: ts.PropertySignature | undefined;

  while (current) {
    if (ts.isPropertySignature(current)) {
      if (
        current.parent &&
        ts.isInterfaceDeclaration(current.parent) &&
        current.parent.name.text === 'setupCache' &&
        ts.isStringLiteralLike(current.name)
      ) {
        cacheProperty = current;
        break;
      }

      const name = getNameText(current.name);
      if (!name) return undefined;
      responsePath.push(name);
    }
    current = current.parent;
  }

  if (!cacheProperty || !ts.isStringLiteralLike(cacheProperty.name)) {
    return undefined;
  }

  const cacheType = cacheProperty.type;
  if (!cacheType || !ts.isTypeReferenceNode(cacheType)) return undefined;
  if (getTypeReferenceName(cacheType) !== 'TadaDocumentNode') return undefined;

  const resultType = cacheType.typeArguments?.[0];
  if (!resultType || !containsNode(resultType, node)) return undefined;

  responsePath.reverse();
  if (!responsePath.length) return undefined;

  return {
    documentText: cacheProperty.name.text,
    responsePath,
  };
};

const findTadaCacheMatch = (
  definition: ts.DefinitionInfo,
  info: ts.server.PluginCreateInfo
): TadaCacheMatch | undefined => {
  const program = info.languageService.getProgram();
  const source = program?.getSourceFile(definition.fileName);
  if (!source) return undefined;

  const node = findNode(source, definition.textSpan.start);
  return node && getTadaCacheMatch(node);
};

const findDocumentCall = (
  documentText: string,
  schemaName: string | null,
  info: ts.server.PluginCreateInfo
): { fileName: string; node: ts.StringLiteralLike } | undefined => {
  const program = info.languageService.getProgram();
  if (!program) return undefined;

  for (const source of program.getSourceFiles()) {
    if (source.isDeclarationFile) continue;
    if (!source.getText().includes(documentText)) continue;

    const { nodes } = findAllCallExpressions(source, info, {
      searchExternal: false,
      collectFragments: false,
    });

    for (const found of nodes) {
      if (found.node.text !== documentText) continue;
      if (schemaName && found.schema !== schemaName) continue;
      return { fileName: source.fileName, node: found.node };
    }
  }
};

const getSchemaNameForTurboFile = (
  fileName: string,
  schema: SchemaRef
): string | null => {
  const normalize = (input: string) => path.normalize(input).toLowerCase();
  const target = normalize(fileName);
  for (const [schemaName, turboFile] of schema.turboLocations) {
    if (normalize(turboFile) === target) return schemaName;
  }
  return null;
};

const findFieldByResponsePath = (
  documentText: string,
  responsePath: readonly string[]
): FieldNode | undefined => {
  let document;
  try {
    document = parse(documentText);
  } catch (_error) {
    return undefined;
  }

  const fragments = new Map<string, FragmentDefinitionNode>();
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      fragments.set(definition.name.value, definition);
    }
  }

  const findInSelectionSet = (
    selectionSet: SelectionSetNode,
    path: readonly string[],
    seenFragments = new Set<string>()
  ): FieldNode | undefined => {
    const [head, ...rest] = path;
    if (!head) return undefined;

    for (const selection of selectionSet.selections) {
      if (selection.kind === Kind.FIELD) {
        const responseName = selection.alias
          ? selection.alias.value
          : selection.name.value;
        if (responseName !== head) continue;
        if (!rest.length) return selection;
        if (!selection.selectionSet) return undefined;
        const found = findInSelectionSet(
          selection.selectionSet,
          rest,
          seenFragments
        );
        if (found) return found;
      } else if (selection.kind === Kind.INLINE_FRAGMENT) {
        const found = findInSelectionSet(
          selection.selectionSet,
          path,
          seenFragments
        );
        if (found) return found;
      } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
        const name = selection.name.value;
        if (seenFragments.has(name)) continue;
        const fragment = fragments.get(name);
        if (!fragment) continue;
        seenFragments.add(name);
        const found = findInSelectionSet(
          fragment.selectionSet,
          path,
          seenFragments
        );
        if (found) return found;
      }
    }
  };

  for (const definition of document.definitions) {
    if (
      definition.kind === Kind.OPERATION_DEFINITION ||
      definition.kind === Kind.FRAGMENT_DEFINITION
    ) {
      const found = findInSelectionSet(definition.selectionSet, responsePath);
      if (found) return found;
    }
  }
};

const getFieldAtOffset = (
  schema: GraphQLSchema,
  documentText: string,
  offset: number
):
  | {
      field: FieldNode;
      parentType: GraphQLNamedType;
      boundStart: number;
      boundLength: number;
    }
  | undefined => {
  let document;
  try {
    document = parse(documentText);
  } catch (_error) {
    return undefined;
  }

  let found:
    | {
        field: FieldNode;
        parentType: GraphQLNamedType;
        boundStart: number;
        boundLength: number;
      }
    | undefined;

  const typeInfo = new TypeInfo(schema);
  visit(
    document,
    visitWithTypeInfo(typeInfo, {
      Field: {
        enter(field) {
          const nameLoc = field.name.loc;
          const aliasLoc = field.alias?.loc;
          const loc =
            nameLoc && isPositionInRange(offset, nameLoc.start, nameLoc.end)
              ? nameLoc
              : aliasLoc &&
                isPositionInRange(offset, aliasLoc.start, aliasLoc.end)
              ? aliasLoc
              : null;
          if (!loc) return;

          const parentType = typeInfo.getParentType();
          if (!parentType) return;

          found = {
            field,
            parentType,
            boundStart: loc.start,
            boundLength: loc.end - loc.start,
          };
          return false;
        },
      },
    })
  );

  return found;
};

const getSchemaFieldLocation = (
  schema: SchemaRef,
  schemaName: string | null,
  parentType: GraphQLNamedType,
  fieldName: string
): GraphQLFieldLocation | undefined => {
  const schemaSource = schema.sourceLocations.get(schemaName);
  if (!schemaSource) return undefined;

  if (!isObjectType(parentType) && !isInterfaceType(parentType)) {
    return undefined;
  }

  const field = parentType.getFields()[fieldName];
  const loc = field?.astNode?.name.loc;
  if (!field || !loc) return undefined;

  return {
    fileName: schemaSource,
    fieldName,
    parentName: parentType.name,
    start: loc.start,
    length: loc.end - loc.start,
  };
};

const getDefinitionForDocumentField = (
  filename: string,
  cursorPosition: number,
  schema: SchemaRef,
  info: ts.server.PluginCreateInfo
): ts.DefinitionInfoAndBoundSpan | undefined => {
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
  let schemaToUse: GraphQLSchema | undefined;

  if (isCallExpression && checks.isGraphQLCall(node, typeChecker)) {
    schemaName = checks.getSchemaName(node, typeChecker);
    schemaToUse = getSchemaForName(schema, schemaName);
    documentNode = node.arguments[0] as ts.StringLiteralLike;
  } else if (!isCallExpression && checks.isGraphQLTag(node)) {
    if (!ts.isNoSubstitutionTemplateLiteral(node.template)) return undefined;
    schemaToUse = schema.current?.schema;
    documentNode = node.template;
  } else {
    return undefined;
  }

  if (!schemaToUse || !ts.isStringLiteralLike(documentNode)) return undefined;

  const documentStart = documentNode.getStart() + 1;
  const documentOffset = cursorPosition - documentStart;
  if (documentOffset < 0 || documentOffset >= documentNode.text.length) {
    return undefined;
  }

  const found = getFieldAtOffset(
    schemaToUse,
    documentNode.text,
    documentOffset
  );
  if (!found) return undefined;

  const location = getSchemaFieldLocation(
    schema,
    schemaName,
    found.parentType,
    found.field.name.value
  );
  if (!location) return undefined;

  return {
    textSpan: {
      start: documentStart + found.boundStart,
      length: found.boundLength,
    },
    definitions: [makeDefinitionInfo(location)],
  };
};

const getDefinitionForTadaResultField = (
  schema: SchemaRef,
  info: ts.server.PluginCreateInfo,
  originalDefinitions: readonly ts.DefinitionInfo[] | undefined
): readonly ts.DefinitionInfo[] | undefined => {
  if (!originalDefinitions?.length) return undefined;

  let sawTadaCacheDefinition = false;
  for (const definition of originalDefinitions) {
    const cacheMatch = findTadaCacheMatch(definition, info);
    if (!cacheMatch) continue;
    sawTadaCacheDefinition = true;

    const schemaName = getSchemaNameForTurboFile(definition.fileName, schema);
    const documentCall = findDocumentCall(
      cacheMatch.documentText,
      schemaName,
      info
    );
    if (!documentCall) continue;

    const field = findFieldByResponsePath(
      cacheMatch.documentText,
      cacheMatch.responsePath
    );
    const loc = (field?.alias || field?.name)?.loc;
    if (!loc) continue;

    return [
      {
        fileName: documentCall.fileName,
        textSpan: {
          start: documentCall.node.getStart() + 1 + loc.start,
          length: loc.end - loc.start,
        },
        kind: ts.ScriptElementKind.memberVariableElement,
        name: cacheMatch.responsePath[cacheMatch.responsePath.length - 1]!,
        containerKind: ts.ScriptElementKind.scriptElement,
        containerName: '',
      },
    ];
  }

  // If TypeScript was about to navigate into gql.tada's turbo cache, don't
  // fall back to that generated file. We either remap to the user's GraphQL
  // document above, or suppress the generated-cache location.
  return sawTadaCacheDefinition ? [] : undefined;
};

export function getGraphQLDefinitionAtPosition(
  filename: string,
  cursorPosition: number,
  schema: SchemaRef,
  info: ts.server.PluginCreateInfo,
  originalDefinitions: readonly ts.DefinitionInfo[] | undefined
): readonly ts.DefinitionInfo[] | undefined {
  const documentFieldDefinition = getDefinitionForDocumentField(
    filename,
    cursorPosition,
    schema,
    info
  );
  if (documentFieldDefinition?.definitions?.length) {
    return documentFieldDefinition.definitions;
  }

  return getDefinitionForTadaResultField(schema, info, originalDefinitions);
}

export function getGraphQLDefinitionAndBoundSpan(
  filename: string,
  cursorPosition: number,
  schema: SchemaRef,
  info: ts.server.PluginCreateInfo,
  original: ts.DefinitionInfoAndBoundSpan | undefined
): ts.DefinitionInfoAndBoundSpan | undefined {
  const documentFieldDefinition = getDefinitionForDocumentField(
    filename,
    cursorPosition,
    schema,
    info
  );
  if (documentFieldDefinition?.definitions?.length) {
    return documentFieldDefinition;
  }

  const definitions = getDefinitionForTadaResultField(
    schema,
    info,
    original?.definitions
  );
  if (!definitions) return undefined;

  return {
    textSpan: original?.textSpan || { start: cursorPosition, length: 1 },
    definitions,
  };
}
