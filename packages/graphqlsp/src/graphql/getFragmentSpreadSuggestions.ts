import {
  CompletionItem,
  CompletionItemKind,
  ContextToken,
  ContextTokenUnion,
  Maybe,
  RuleKinds,
  getDefinitionState,
} from 'graphql-language-service';
import {
  FragmentDefinitionNode,
  GraphQLArgument,
  GraphQLCompositeType,
  GraphQLDirective,
  GraphQLEnumValue,
  GraphQLField,
  GraphQLInputFieldMap,
  GraphQLInterfaceType,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLType,
  doTypesOverlap,
  isCompositeType,
} from 'graphql';

/**
 * This part is vendored from https://github.com/graphql/graphiql/blob/main/packages/graphql-language-service/src/interface/autocompleteUtils.ts#L97
 */
type CompletionItemBase = {
  label: string;
  isDeprecated?: boolean;
};

// Create the expected hint response given a possible list and a token
function hintList<T extends CompletionItemBase>(
  token: ContextTokenUnion,
  list: Array<T>
): Array<T> {
  return filterAndSortList(list, normalizeText(token.string));
}

// Given a list of hint entries and currently typed text, sort and filter to
// provide a concise list.
function filterAndSortList<T extends CompletionItemBase>(
  list: Array<T>,
  text: string
): Array<T> {
  if (!text) {
    return filterNonEmpty<T>(list, entry => !entry.isDeprecated);
  }

  const byProximity = list.map(entry => ({
    proximity: getProximity(normalizeText(entry.label), text),
    entry,
  }));

  return filterNonEmpty(
    filterNonEmpty(byProximity, pair => pair.proximity <= 2),
    pair => !pair.entry.isDeprecated
  )
    .sort(
      (a, b) =>
        (a.entry.isDeprecated ? 1 : 0) - (b.entry.isDeprecated ? 1 : 0) ||
        a.proximity - b.proximity ||
        a.entry.label.length - b.entry.label.length
    )
    .map(pair => pair.entry);
}

// Filters the array by the predicate, unless it results in an empty array,
// in which case return the original array.
function filterNonEmpty<T>(
  array: Array<T>,
  predicate: (entry: T) => boolean
): Array<T> {
  const filtered = array.filter(predicate);
  return filtered.length === 0 ? array : filtered;
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\W/g, '');
}

// Determine a numeric proximity for a suggestion based on current text.
function getProximity(suggestion: string, text: string): number {
  // start with lexical distance
  let proximity = lexicalDistance(text, suggestion);
  if (suggestion.length > text.length) {
    // do not penalize long suggestions.
    proximity -= suggestion.length - text.length - 1;
    // penalize suggestions not starting with this phrase
    proximity += suggestion.indexOf(text) === 0 ? 0 : 0.5;
  }
  return proximity;
}

/**
 * Computes the lexical distance between strings A and B.
 *
 * The "distance" between two strings is given by counting the minimum number
 * of edits needed to transform string A into string B. An edit can be an
 * insertion, deletion, or substitution of a single character, or a swap of two
 * adjacent characters.
 *
 * This distance can be useful for detecting typos in input or sorting
 *
 * @param {string} a
 * @param {string} b
 * @return {int} distance in number of edits
 */
function lexicalDistance(a: string, b: string): number {
  let i;
  let j;
  const d = [];
  const aLength = a.length;
  const bLength = b.length;

  for (i = 0; i <= aLength; i++) {
    d[i] = [i];
  }

  for (j = 1; j <= bLength; j++) {
    d[0][j] = j;
  }

  for (i = 1; i <= aLength; i++) {
    for (j = 1; j <= bLength; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );

      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
      }
    }
  }

  return d[aLength][bLength];
}

export type AllTypeInfo = {
  type: Maybe<GraphQLType>;
  parentType: Maybe<GraphQLType>;
  inputType: Maybe<GraphQLType>;
  directiveDef: Maybe<GraphQLDirective>;
  fieldDef: Maybe<GraphQLField<any, any>>;
  enumValue: Maybe<GraphQLEnumValue>;
  argDef: Maybe<GraphQLArgument>;
  argDefs: Maybe<GraphQLArgument[]>;
  objectFieldDefs: Maybe<GraphQLInputFieldMap>;
  interfaceDef: Maybe<GraphQLInterfaceType>;
  objectTypeDef: Maybe<GraphQLObjectType>;
};

/**
 * This is vendored from https://github.com/graphql/graphiql/blob/main/packages/graphql-language-service/src/interface/getAutocompleteSuggestions.ts#L779
 */
export function getSuggestionsForFragmentSpread(
  token: ContextToken,
  typeInfo: AllTypeInfo,
  schema: GraphQLSchema,
  queryText: string,
  fragments: FragmentDefinitionNode[]
): Array<CompletionItem> {
  if (!queryText) {
    return [];
  }

  const typeMap = schema.getTypeMap();
  const defState = getDefinitionState(token.state);

  // Filter down to only the fragments which may exist here.
  const relevantFrags = fragments.filter(
    frag =>
      // Only include fragments with known types.
      typeMap[frag.typeCondition.name.value] &&
      // Only include fragments which are not cyclic.
      !(
        defState &&
        defState.kind === RuleKinds.FRAGMENT_DEFINITION &&
        defState.name === frag.name.value
      ) &&
      // Only include fragments which could possibly be spread here.
      isCompositeType(typeInfo.parentType) &&
      isCompositeType(typeMap[frag.typeCondition.name.value]) &&
      doTypesOverlap(
        schema,
        typeInfo.parentType,
        typeMap[frag.typeCondition.name.value] as GraphQLCompositeType
      )
  );

  return hintList(
    token,
    relevantFrags.map(frag => ({
      label: frag.name.value,
      detail: String(typeMap[frag.typeCondition.name.value]),
      documentation: `fragment ${frag.name.value} on ${frag.typeCondition.name.value}`,
      kind: CompletionItemKind.Field,
      type: typeMap[frag.typeCondition.name.value],
    }))
  );
}
