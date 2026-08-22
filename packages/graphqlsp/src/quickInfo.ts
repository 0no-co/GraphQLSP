import { ts } from './ts';
import { getTokenAtPosition, getTypeInfo } from 'graphql-language-service';
import type { GraphQLArgument, GraphQLSchema } from 'graphql';
import { astFromValue, getNamedType, print } from 'graphql';

import {
  bubbleUpCallExpression,
  bubbleUpTemplate,
  findNode,
  getSchemaName,
  getSource,
} from './ast';

import * as checks from './ast/checks';
import { resolveTemplate } from './ast/resolve';
import { getToken } from './ast/token';
import { Cursor } from './ast/cursor';
import { SchemaRef, getSchemaForName } from './graphql/getSchema';

/** Matches the GraphQL spec's default reason for `@deprecated`. */
const DEFAULT_DEPRECATION_REASON = 'No longer supported';

const printDefaultValue = (arg: GraphQLArgument): string => {
  if (arg.defaultValue === undefined) return '';
  const valueAst = astFromValue(arg.defaultValue, arg.type);
  return valueAst ? ` = ${print(valueAst)}` : '';
};

const printArg = (arg: GraphQLArgument): string =>
  `${arg.name}: ${arg.type}${printDefaultValue(arg)}`;

type TypeInfo = ReturnType<typeof getTypeInfo>;

const printQualifiedField = (typeInfo: TypeInfo): string => {
  const fieldDef = typeInfo.fieldDef!;
  return fieldDef.name.startsWith('__') || !typeInfo.parentType
    ? fieldDef.name
    : `${typeInfo.parentType}.${fieldDef.name}`;
};

interface HoverInfo {
  signature: string;
  description: string | null | undefined;
  deprecationReason: string | null | undefined;
}

export const getHoverInfo = (
  schema: GraphQLSchema,
  text: string,
  cursor: Cursor
): HoverInfo | undefined => {
  const token = getTokenAtPosition(text, cursor);
  if (!token.state) return undefined;

  const { kind, step } = token.state;
  const typeInfo = getTypeInfo(schema, token.state);

  if (
    ((kind === 'Field' && step === 0) ||
      (kind === 'AliasedField' && step === 2)) &&
    typeInfo.fieldDef
  ) {
    const fieldDef = typeInfo.fieldDef;
    const args = fieldDef.args.length
      ? `(${fieldDef.args.map(printArg).join(', ')})`
      : '';
    return {
      signature: `${printQualifiedField(typeInfo)}${args}: ${fieldDef.type}`,
      description: fieldDef.description,
      deprecationReason: fieldDef.deprecationReason,
    };
  } else if (kind === 'ObjectField' && step === 0 && typeInfo.fieldDef) {
    const fieldDef = typeInfo.fieldDef;
    return {
      signature: `${printQualifiedField(typeInfo)}: ${fieldDef.type}`,
      description: fieldDef.description,
      deprecationReason: fieldDef.deprecationReason,
    };
  } else if (kind === 'Variable' && typeInfo.type) {
    const namedType = getNamedType(typeInfo.type);
    return {
      signature: `${typeInfo.type}`,
      description: namedType.description,
      deprecationReason: undefined,
    };
  } else if (kind === 'Argument' && step === 0 && typeInfo.argDef) {
    const argDef = typeInfo.argDef;
    const prefix = typeInfo.directiveDef
      ? `@${typeInfo.directiveDef.name}`
      : typeInfo.fieldDef
        ? printQualifiedField(typeInfo)
        : '';
    return {
      signature: `${prefix}(${printArg(argDef)})`,
      description: argDef.description,
      deprecationReason: argDef.deprecationReason,
    };
  } else if (kind === 'Directive' && step === 1 && typeInfo.directiveDef) {
    return {
      signature: `@${typeInfo.directiveDef.name}`,
      description: typeInfo.directiveDef.description,
      deprecationReason: undefined,
    };
  } else if (
    kind === 'EnumValue' &&
    typeInfo.enumValue &&
    'description' in typeInfo.enumValue
  ) {
    const enumValue = typeInfo.enumValue;
    const enumType = typeInfo.inputType
      ? getNamedType(typeInfo.inputType)
      : undefined;
    return {
      signature: enumType ? `${enumType}.${enumValue.name}` : enumValue.name,
      description: enumValue.description,
      deprecationReason: enumValue.deprecationReason,
    };
  } else if (
    kind === 'NamedType' &&
    typeInfo.type &&
    'description' in typeInfo.type
  ) {
    return {
      signature: `${typeInfo.type}`,
      description: typeInfo.type.description,
      deprecationReason: undefined,
    };
  } else {
    return undefined;
  }
};

export function getGraphQLQuickInfo(
  filename: string,
  cursorPosition: number,
  schema: SchemaRef,
  info: ts.server.PluginCreateInfo
): ts.QuickInfo | undefined {
  const isCallExpression = info.config.templateIsCallExpression ?? true;
  const typeChecker = info.languageService.getProgram()?.getTypeChecker();

  const source = getSource(info, filename);
  if (!source) return undefined;

  let node = findNode(source, cursorPosition);
  if (!node) return undefined;

  node = isCallExpression
    ? bubbleUpCallExpression(node)
    : bubbleUpTemplate(node);

  let cursor, text, schemaToUse: GraphQLSchema | undefined;
  if (isCallExpression && checks.isGraphQLCall(node, typeChecker)) {
    const typeChecker = info.languageService.getProgram()?.getTypeChecker();
    const schemaName = getSchemaName(node, typeChecker);

    schemaToUse = getSchemaForName(schema, schemaName);

    const foundToken = getToken(node.arguments[0], cursorPosition);
    if (!schemaToUse || !foundToken) return undefined;

    text = node.arguments[0].getText();
    cursor = new Cursor(foundToken.line, foundToken.start - 1);
  } else if (!isCallExpression && checks.isGraphQLTag(node)) {
    const foundToken = getToken(node.template, cursorPosition);
    if (!foundToken || !schema.current) return undefined;

    const { combinedText, resolvedSpans } = resolveTemplate(
      node,
      filename,
      info
    );

    const amountOfLines = resolvedSpans
      .filter(
        x =>
          x.original.start < cursorPosition &&
          x.original.start + x.original.length < cursorPosition
      )
      .reduce((acc, span) => acc + (span.lines - 1), 0);

    foundToken.line = foundToken.line + amountOfLines;
    text = combinedText;
    cursor = new Cursor(foundToken.line, foundToken.start - 1);
    schemaToUse = schema.current.schema;
  } else {
    return undefined;
  }

  const hoverInfo = getHoverInfo(schemaToUse, text, cursor);
  if (!hoverInfo) return undefined;

  const documentation: ts.SymbolDisplayPart[] = [];
  const tags: ts.JSDocTagInfo[] = [];
  if (hoverInfo.deprecationReason != null) {
    const reason = hoverInfo.deprecationReason || DEFAULT_DEPRECATION_REASON;
    documentation.push({ kind: 'text', text: `@deprecated: ${reason}` });
    tags.push({ name: 'deprecated', text: [{ kind: 'text', text: reason }] });
  }

  if (hoverInfo.description) {
    if (documentation.length)
      documentation.push({ kind: 'text', text: '\n\n' });
    documentation.push({ kind: 'text', text: hoverInfo.description });
  }

  return {
    kind: ts.ScriptElementKind.label,
    textSpan: {
      start: cursorPosition,
      length: 1,
    },
    kindModifiers: 'text',
    displayParts: [{ kind: 'text', text: hoverInfo.signature }],
    documentation,
    tags,
  };
}
