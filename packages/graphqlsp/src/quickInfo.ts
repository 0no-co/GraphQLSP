import { ts } from './ts';
import { getHoverInformation } from 'graphql-language-service';
import { GraphQLSchema } from 'graphql';

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
  if (!source || !typeChecker) return undefined;

  let node = findNode(source, cursorPosition);
  if (!node) return undefined;

  node = isCallExpression
    ? bubbleUpCallExpression(node)
    : bubbleUpTemplate(node);

  let cursor, text, schemaToUse: GraphQLSchema | undefined;
  if (isCallExpression && checks.isGraphQLCall(node, typeChecker)) {
    const typeChecker = info.languageService.getProgram()?.getTypeChecker();
    const schemaName = getSchemaName(node, typeChecker);

    schemaToUse =
      schemaName && schema.multi[schemaName]
        ? schema.multi[schemaName]?.schema
        : schema.current?.schema;

    const foundToken = getToken(node.arguments[0], cursorPosition);
    if (!schemaToUse || !foundToken) return undefined;

    text = node.arguments[0].getText();
    cursor = new Cursor(foundToken.line, foundToken.start - 1);
  } else if (!isCallExpression && checks.isGraphQLTag(node)) {
    const foundToken = getToken(node.template, cursorPosition);
    if (!foundToken || !schema.current) return undefined;

    const { combinedText, resolvedSpans } = resolveTemplate(node, typeChecker);

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
