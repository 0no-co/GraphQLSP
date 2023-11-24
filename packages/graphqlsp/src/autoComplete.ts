import ts from 'typescript/lib/tsserverlibrary';
import {
  ScriptElementKind,
  isIdentifier,
  isNoSubstitutionTemplateLiteral,
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
  onlineParser,
  CharacterStream,
  ContextToken,
} from 'graphql-language-service';
import { FragmentDefinitionNode, GraphQLSchema, Kind, parse } from 'graphql';

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
import { Logger } from '.';

export function getGraphQLCompletions(
  filename: string,
  cursorPosition: number,
  schema: { current: GraphQLSchema | null },
  info: ts.server.PluginCreateInfo
): ts.WithMetadata<ts.CompletionInfo> | undefined {
  const logger: Logger = (msg: string) =>
    info.project.projectService.logger.info(`[GraphQLSP] ${msg}`);
  const tagTemplate = info.config.template || 'gql';
  const isCallExpression = info.config.templateIsCallExpression ?? false;

  const source = getSource(info, filename);
  if (!source) return undefined;

  let node = findNode(source, cursorPosition);
  if (!node) return undefined;

  node = isCallExpression
    ? bubbleUpCallExpression(node)
    : bubbleUpTemplate(node);

  if (
    ts.isCallExpression(node) &&
    isCallExpression &&
    node.expression.getText() === tagTemplate &&
    node.arguments.length > 0 &&
    isNoSubstitutionTemplateLiteral(node.arguments[0])
  ) {
    const foundToken = getToken(node.arguments[0], cursorPosition);
    if (!schema.current || !foundToken) return undefined;

    const queryText = node.arguments[0].getText();
    const fragments = getAllFragments(filename, node, info);
    const cursor = new Cursor(foundToken.line, foundToken.start);
    const items = getAutocompleteSuggestions(
      schema.current,
      queryText,
      cursor,
      undefined,
      fragments
    );

    return {
      isGlobalCompletion: false,
      isMemberCompletion: false,
      isNewIdentifierLocation: false,
      entries: items.map(suggestion => ({
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
    };
  } else if (isTaggedTemplateExpression(node)) {
    const { template, tag } = node;

    if (!isIdentifier(tag) || tag.text !== tagTemplate) return undefined;

    const foundToken = getToken(template, cursorPosition);
    if (!foundToken || !schema.current) return undefined;

    const { combinedText: text, resolvedSpans } = resolveTemplate(
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
    stream = new CharacterStream(lines[i]);
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
