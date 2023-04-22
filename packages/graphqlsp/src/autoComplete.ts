import ts from 'typescript/lib/tsserverlibrary';
import {
  ScriptElementKind,
  isIdentifier,
  isTaggedTemplateExpression,
} from 'typescript';
import {
  getAutocompleteSuggestions,
  getTokenAtPosition,
  getTypeInfo,
  RuleKinds,
  State,
  RuleKind,
  CompletionItem,
} from 'graphql-language-service';
import { runOnlineParser } from 'graphql-language-service/dist/interface/getAutocompleteSuggestions';
import { FragmentDefinitionNode, GraphQLSchema, Kind, parse } from 'graphql';

import { bubbleUpTemplate, findNode, getSource } from './ast';
import { Cursor } from './ast/cursor';
import { resolveTemplate } from './ast/resolve';
import { getToken } from './ast/token';
import { getSuggestionsForFragmentSpread } from './graphql/getFragmentSpreadSuggestions';

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

  node = bubbleUpTemplate(node);

  if (isTaggedTemplateExpression(node)) {
    const { template, tag } = node;

    if (!isIdentifier(tag) || tag.text !== tagTemplate) return undefined;

    const foundToken = getToken(template, cursorPosition);
    if (!foundToken || !schema.current) return undefined;

    const text = resolveTemplate(node, filename, info);

    const cursor = new Cursor(foundToken.line, foundToken.start);

    const [suggestions, spreadSuggestions] = getSuggestionsInternal(
      schema.current,
      text,
      cursor
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

export function getSuggestionsInternal(
  schema: GraphQLSchema,
  queryText: string,
  cursor: Cursor
): [CompletionItem[], CompletionItem[]] {
  const token = getTokenAtPosition(queryText, cursor);

  let fragments: Array<FragmentDefinitionNode> = [];
  try {
    const parsed = parse(queryText, { noLocation: true });
    fragments = parsed.definitions.filter(
      x => x.kind === Kind.FRAGMENT_DEFINITION
    ) as Array<FragmentDefinitionNode>;
  } catch (e) {}

  let suggestions = getAutocompleteSuggestions(schema, queryText, cursor);
  let spreadSuggestions = getSuggestionsForFragmentSpread(
    token,
    getTypeInfo(schema, token.state),
    schema,
    queryText,
    fragments
  );

  const state =
    token.state.kind === 'Invalid' ? token.state.prevState : token.state;
  const parentName = getParentDefinition(token.state, RuleKinds.FIELD)?.name;

  if (state && parentName) {
    const { kind } = state;

    // Argument names
    if (kind === RuleKinds.ARGUMENTS || kind === RuleKinds.ARGUMENT) {
      const usedArguments = new Set<String>();

      runOnlineParser(queryText, (_, state) => {
        if (state.kind === RuleKinds.ARGUMENT) {
          const parentDefinition = getParentDefinition(state, RuleKinds.FIELD);
          if (
            parentName &&
            state.name &&
            parentDefinition?.name === parentName
          ) {
            usedArguments.add(state.name);
          }
        }
      });

      suggestions = suggestions.filter(
        suggestion => !usedArguments.has(suggestion.label)
      );
    }

    // Field names
    if (
      kind === RuleKinds.SELECTION_SET ||
      kind === RuleKinds.FIELD ||
      kind === RuleKinds.ALIASED_FIELD
    ) {
      const usedFields = new Set<string>();
      const usedFragments = getUsedFragments(queryText, parentName);

      runOnlineParser(queryText, (_, state) => {
        if (
          state.kind === RuleKinds.FIELD ||
          state.kind === RuleKinds.ALIASED_FIELD
        ) {
          const parentDefinition = getParentDefinition(state, RuleKinds.FIELD);
          if (
            parentDefinition &&
            parentDefinition.name === parentName &&
            state.name
          ) {
            usedFields.add(state.name);
          }
        }
      });

      suggestions = suggestions.filter(
        suggestion => !usedFields.has(suggestion.label)
      );
      spreadSuggestions = spreadSuggestions.filter(
        suggestion => !usedFragments.has(suggestion.label)
      );
    }

    // Fragment spread names
    if (kind === RuleKinds.FRAGMENT_SPREAD) {
      const usedFragments = getUsedFragments(queryText, parentName);
      suggestions = suggestions.filter(
        suggestion => !usedFragments.has(suggestion.label)
      );
      spreadSuggestions = spreadSuggestions.filter(
        suggestion => !usedFragments.has(suggestion.label)
      );
    }
  }

  return [suggestions, spreadSuggestions];
}

function getUsedFragments(queryText: string, parentName: string | undefined) {
  const usedFragments = new Set<string>();

  runOnlineParser(queryText, (_, state) => {
    if (state.kind === RuleKinds.FRAGMENT_SPREAD && state.name) {
      const parentDefinition = getParentDefinition(state, RuleKinds.FIELD);
      if (parentName && parentDefinition?.name === parentName) {
        usedFragments.add(state.name);
      }
    }
  });

  return usedFragments;
}

/**
 * This is vendoref from https://github.com/graphql/graphiql/blob/aeedf7614e422c783f5cfb5e226c5effa46318fd/packages/graphql-language-service/src/interface/getAutocompleteSuggestions.ts#L831
 */
function getParentDefinition(state: State, kind: RuleKind) {
  if (state.prevState?.kind === kind) {
    return state.prevState;
  }
  if (state.prevState?.prevState?.kind === kind) {
    return state.prevState.prevState;
  }
  if (state.prevState?.prevState?.prevState?.kind === kind) {
    return state.prevState.prevState.prevState;
  }
  if (state.prevState?.prevState?.prevState?.prevState?.kind === kind) {
    return state.prevState.prevState.prevState.prevState;
  }
}
