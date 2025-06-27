import { ts } from './ts';
import { getHoverInformation } from 'graphql-language-service';
import { GraphQLSchema } from 'graphql';

import {
  bubbleUpCallExpression,
  bubbleUpTemplate,
  findNode,
  getSource,
} from './ast';

import * as checks from './ast/checks';
import { getToken } from './ast/token';
import { Cursor } from './ast/cursor';
import { resolveSchemaForNode, resolveTemplateWithCursor } from './ast/helpers';
import { SchemaRef } from './graphql/getSchema';

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
    schemaToUse = resolveSchemaForNode(node, schema, typeChecker);

    const foundToken = getToken(node.arguments[0], cursorPosition);
    if (!schemaToUse || !foundToken) return undefined;

    text = node.arguments[0].getText();
    cursor = new Cursor(foundToken.line, foundToken.start - 1);
  } else if (!isCallExpression && checks.isGraphQLTag(node)) {
    if (!schema.current) return undefined;

    const { combinedText, foundToken } = resolveTemplateWithCursor(
      node.template,
      filename,
      cursorPosition,
      info
    );

    if (!foundToken) return undefined;

    text = combinedText;
    cursor = new Cursor(foundToken.line, foundToken.start - 1);
    schemaToUse = schema.current.schema;
  } else {
    return undefined;
  }

  const hoverInfo = getHoverInformation(schemaToUse, text, cursor);

  return {
    kind: ts.ScriptElementKind.label,
    textSpan: {
      start: cursorPosition,
      length: 1,
    },
    kindModifiers: 'text',
    documentation: Array.isArray(hoverInfo)
      ? hoverInfo.map(item => ({ kind: 'text', text: item as string }))
      : [{ kind: 'text', text: hoverInfo as string }],
  } as ts.QuickInfo;
}
