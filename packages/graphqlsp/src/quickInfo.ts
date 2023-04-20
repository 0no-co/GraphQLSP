import ts from 'typescript/lib/tsserverlibrary';
import {
  isIdentifier,
  isNoSubstitutionTemplateLiteral,
  isTaggedTemplateExpression,
  isTemplateExpression,
  isToken,
} from 'typescript';
import { getHoverInformation } from 'graphql-language-service';
import { GraphQLSchema } from 'graphql';

import { findNode, getSource } from './ast';
import { resolveTemplate } from './ast/resolve';
import { getToken } from './ast/token';
import { Cursor } from './ast/cursor';

export function getGraphQLQuickInfo(
  filename: string,
  cursorPosition: number,
  schema: { current: GraphQLSchema | null },
  info: ts.server.PluginCreateInfo
): ts.QuickInfo | undefined {
  const tagTemplate = info.config.template || 'gql';

  const source = getSource(info, filename);
  if (!source) return undefined;

  let node = findNode(source, cursorPosition);
  if (!node) return undefined;

  while (
    isNoSubstitutionTemplateLiteral(node) ||
    isToken(node) ||
    isTemplateExpression(node)
  ) {
    node = node.parent;
  }

  if (isTaggedTemplateExpression(node)) {
    const { template, tag } = node;
    if (!isIdentifier(tag) || tag.text !== tagTemplate) return undefined;

    const text = resolveTemplate(node, filename, info);
    const foundToken = getToken(template, cursorPosition);

    if (!foundToken || !schema.current) return undefined;

    const hoverInfo = getHoverInformation(
      schema.current,
      text,
      new Cursor(foundToken.line, foundToken.start)
    );

    return {
      kind: ts.ScriptElementKind.string,
      textSpan: {
        start: cursorPosition,
        length: 1,
      },
      kindModifiers: '',
      displayParts: Array.isArray(hoverInfo)
        ? hoverInfo.map(item => ({ kind: '', text: item as string }))
        : [{ kind: '', text: hoverInfo as string }],
    };
  } else {
    return undefined;
  }
}
