import { ts } from './ts';
import { getHoverInformation } from 'graphql-language-service';
import { GraphQLSchema } from 'graphql';

import {
  bubbleUpCallExpression,
  bubbleUpTemplate,
  findNode,
  getSource,
} from './ast';
import { resolveTemplate } from './ast/resolve';
import { getToken } from './ast/token';
import { Cursor } from './ast/cursor';
import { templates } from './ast/templates';

export function getGraphQLQuickInfo(
  filename: string,
  cursorPosition: number,
  schema: { current: GraphQLSchema | null },
  info: ts.server.PluginCreateInfo
): ts.QuickInfo | undefined {
  const isCallExpression = info.config.templateIsCallExpression ?? true;

  const source = getSource(info, filename);
  if (!source) return undefined;

  let node = findNode(source, cursorPosition);
  if (!node) return undefined;

  node = isCallExpression
    ? bubbleUpCallExpression(node)
    : bubbleUpTemplate(node);

  let cursor, text;
  if (
    ts.isCallExpression(node) &&
    isCallExpression &&
    templates.has(node.expression.getText()) &&
    node.arguments.length > 0 &&
    ts.isNoSubstitutionTemplateLiteral(node.arguments[0])
  ) {
    const foundToken = getToken(node.arguments[0], cursorPosition);
    if (!schema.current || !foundToken) return undefined;

    text = node.arguments[0].getText();
    cursor = new Cursor(foundToken.line, foundToken.start - 1);
  } else if (ts.isTaggedTemplateExpression(node)) {
    const { template, tag } = node;
    if (!ts.isIdentifier(tag) || !templates.has(tag.text)) return undefined;

    const foundToken = getToken(template, cursorPosition);

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
  } else {
    return undefined;
  }

  const hoverInfo = getHoverInformation(schema.current, text, cursor);

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
