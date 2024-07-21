import { ts } from './ts';

import {
  getAutocompleteSuggestions,
  getTokenAtPosition,
  getTypeInfo,
  RuleKinds,
  State,
  RuleKind,
  CompletionItem,
  onlineParser,
  CharacterStream,
  ContextToken,
} from 'graphql-language-service';
import { FragmentDefinitionNode, GraphQLSchema, Kind, parse } from 'graphql';
import { print } from '@0no-co/graphql.web';

import * as checks from './ast/checks';
import {
  bubbleUpCallExpression,
  bubbleUpTemplate,
  findNode,
  getAllFragments,
  getSource,
} from './ast';
import { Cursor } from './ast/cursor';
import { resolveTemplate } from './ast/resolve';
import { getToken } from './ast/token';
import { getSuggestionsForFragmentSpread } from './graphql/getFragmentSpreadSuggestions';
import { SchemaRef } from './graphql/getSchema';

export function getGraphQLCompletions(
  filename: string,
  cursorPosition: number,
  schema: SchemaRef,
  info: ts.server.PluginCreateInfo
): ts.WithMetadata<ts.CompletionInfo> | undefined {
  const isCallExpression = info.config.templateIsCallExpression ?? true;
  const typeChecker = info.languageService.getProgram()?.getTypeChecker();
  const source = getSource(info, filename);
  if (!source) return undefined;

  let node = findNode(source, cursorPosition);
  if (!node) return undefined;

  node = isCallExpression
    ? bubbleUpCallExpression(node)
    : bubbleUpTemplate(node);

  let text, cursor, schemaToUse: GraphQLSchema | undefined;
  if (isCallExpression && checks.isGraphQLCall(node, typeChecker)) {
    const schemaName = checks.getSchemaName(node, typeChecker);

    schemaToUse =
      schemaName && schema.multi[schemaName]
        ? schema.multi[schemaName]?.schema
        : schema.current?.schema;

    const foundToken = getToken(node.arguments[0], cursorPosition);
    if (
      !schemaToUse ||
      !foundToken ||
      foundToken.string === '.' ||
      foundToken.string === '..'
    )
      return undefined;

    const queryText = node.arguments[0].getText().slice(1, -1);
    const fragments = getAllFragments(filename, node, info);

    text = `${queryText}\n${fragments.map(x => print(x)).join('\n')}`;
    cursor = new Cursor(foundToken.line, foundToken.start - 1);
  } else if (!isCallExpression && checks.isGraphQLTag(node)) {
    const foundToken = getToken(node.template, cursorPosition);
    if (
      !foundToken ||
      !schema.current ||
      foundToken.string === '.' ||
      foundToken.string === '..'
    )
      return undefined;

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

  const [suggestions, spreadSuggestions] = getSuggestionsInternal(
    schemaToUse,
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
        kind: ts.ScriptElementKind.variableElement,
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
        kind: ts.ScriptElementKind.variableElement,
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

  const isOnTypeCondition =
    token.string === 'on' && token.state.kind === 'TypeCondition';
  let suggestions = getAutocompleteSuggestions(
    schema,
    queryText,
    cursor,
    isOnTypeCondition
      ? {
          ...token,
          state: {
            ...token.state,
            step: 1,
          },
          type: null,
        }
      : undefined
  );
  let spreadSuggestions = !isOnTypeCondition
    ? getSuggestionsForFragmentSpread(
        token,
        getTypeInfo(schema, token.state),
        schema,
        queryText,
        fragments
      )
    : [];

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
 * This is vendored from https://github.com/graphql/graphiql/blob/aeedf7614e422c783f5cfb5e226c5effa46318fd/packages/graphql-language-service/src/interface/getAutocompleteSuggestions.ts#L831
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

function runOnlineParser(
  queryText: string,
  callback: (
    stream: CharacterStream,
    state: State,
    style: string,
    index: number
  ) => void | 'BREAK'
): ContextToken {
  const lines = queryText.split('\n');
  const parser = onlineParser();
  let state = parser.startState();
  let style = '';

  let stream: CharacterStream = new CharacterStream('');

  for (let i = 0; i < lines.length; i++) {
    stream = new CharacterStream(lines[i]!);
    while (!stream.eol()) {
      style = parser.token(stream, state);
      const code = callback(stream, state, style, i);
      if (code === 'BREAK') {
        break;
      }
    }

    // Above while loop won't run if there is an empty line.
    // Run the callback one more time to catch this.
    callback(stream, state, style, i);

    if (!state.kind) {
      state = parser.startState();
    }
  }

  return {
    start: stream.getStartOfToken(),
    end: stream.getCurrentPosition(),
    string: stream.current(),
    state,
    style,
  };
}
