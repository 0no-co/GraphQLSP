import ts from 'typescript/lib/tsserverlibrary';
import {
  ScriptElementKind,
  isIdentifier,
  isNoSubstitutionTemplateLiteral,
  isTaggedTemplateExpression,
  isTemplateExpression,
  isToken,
} from 'typescript';
import {
  getAutocompleteSuggestions,
  getTokenAtPosition,
  getTypeInfo,
} from 'graphql-language-service';
import { FragmentDefinitionNode, GraphQLSchema, Kind, parse } from 'graphql';

import { findNode } from './ast';
import { getSource, getSuggestionsForFragmentSpread } from './utils';
import { Cursor } from './ast/cursor';
import { resolveTemplate } from './ast/resolve';
import { getToken } from './ast/token';

export function getGraphQLCompletions(
  filename: string,
  cursorPosition: number,
  schema: { current: GraphQLSchema | null },
  info: ts.server.PluginCreateInfo
): ts.WithMetadata<ts.CompletionInfo> | undefined {
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

    let fragments: Array<FragmentDefinitionNode> = [];
    try {
      const parsed = parse(text);
      fragments = parsed.definitions.filter(
        x => x.kind === Kind.FRAGMENT_DEFINITION
      ) as Array<FragmentDefinitionNode>;
    } catch (e) {}

    const cursor = new Cursor(foundToken.line, foundToken.start);
    const suggestions = getAutocompleteSuggestions(
      schema.current,
      text,
      cursor
    );

    const token = getTokenAtPosition(text, cursor);
    const spreadSuggestions = getSuggestionsForFragmentSpread(
      token,
      getTypeInfo(schema.current, token.state),
      schema.current,
      text,
      fragments
    );

    return {
      isGlobalCompletion: false,
      isMemberCompletion: false,
      isNewIdentifierLocation: false,
      entries: [
        ...suggestions.map(suggestion => ({
          ...suggestion,
          kind: ScriptElementKind.variableElement,
          name: suggestion.label,
          kindModifiers: 'declare',
          sortText: suggestion.sortText || '0',
          labelDetails: {
            detail: suggestion.type
              ? ' ' + suggestion.type?.toString()
              : undefined,
            description: suggestion.documentation,
          },
        })),
        ...spreadSuggestions.map(suggestion => ({
          ...suggestion,
          kind: ScriptElementKind.variableElement,
          name: suggestion.label,
          insertText: '...' + suggestion.label,
          kindModifiers: 'declare',
          sortText: '0',
          labelDetails: {
            description: suggestion.documentation,
          },
        })),
      ],
    };
  } else {
    return undefined;
  }
}
