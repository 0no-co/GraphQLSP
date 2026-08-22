import { describe, it, expect } from 'vitest';
import { buildSchema } from '../../packages/graphqlsp/node_modules/graphql/index.js';
import { parse as parse17 } from 'graphql17';

import { createTestEnvironment, TADA_GRAPHQL_MODULE } from './language-service';
import {
  parse,
  PARSE_OPTIONS,
} from '../../packages/graphqlsp/src/graphql/parse';
import {
  getGraphQLDiagnostics,
  SEMANTIC_DIAGNOSTIC_CODE,
} from '../../packages/graphqlsp/src/diagnostics';
import type { SchemaRef } from '../../packages/graphqlsp/src/graphql/getSchema';

const FRAGMENT_ARGUMENTS_DOCUMENT = `
  fragment Fields($limit: Int! = 2) on Pokemon {
    id
    attacks(limit: $limit)
  }

  query One($limit: Int!) {
    pokemon { ...Fields(limit: $limit) }
  }
`;

const makeSchemaRef = (): SchemaRef => {
  const schema = buildSchema(`
    type Query { pokemon: Pokemon }
    type Pokemon { id: ID, name: String, attacks(limit: Int): [String] }
  `);
  return {
    current: { schema },
    multi: { pokemons: { schema } },
    version: 1,
    errors: { config: null, load: new Map(), write: new Map() },
    outputLocations: new Map(),
    sourceLocations: new Map(),
    turboLocations: new Map(),
    checkStale() {},
  } as unknown as SchemaRef;
};

describe('fragment arguments', () => {
  it('reads fragment arguments when the project is on GraphQL 17', () => {
    // GraphQLSP parses with the user's `graphql`; this is the version that
    // understands the syntax, and `PARSE_OPTIONS` is what unlocks it.
    const document = parse17(FRAGMENT_ARGUMENTS_DOCUMENT, PARSE_OPTIONS);

    const fragment = document.definitions[0];
    const operation = document.definitions[1];
    if (
      fragment?.kind !== 'FragmentDefinition' ||
      operation?.kind !== 'OperationDefinition'
    ) {
      throw new Error('Expected a fragment definition and an operation.');
    }

    expect(
      fragment.variableDefinitions?.map(x => x.variable.name.value)
    ).toEqual(['limit']);

    const spread = operation.selectionSet.selections[0];
    expect(
      spread?.kind === 'Field' &&
        spread.selectionSet?.selections[0]?.kind === 'FragmentSpread' &&
        spread.selectionSet.selections[0].arguments?.map(x => x.name.value)
    ).toEqual(['limit']);
  });

  it('leaves parsing unchanged on GraphQL versions without the option', () => {
    // Older versions ignore unknown parse options, so passing it is inert
    // rather than a hard failure.
    expect(() => parse('query One { pokemon { id } }')).not.toThrow();
    expect(() => parse(FRAGMENT_ARGUMENTS_DOCUMENT)).toThrow(/Syntax Error/);
  });

  it('still reports the syntax error on GraphQL versions without the option', () => {
    const { info, getSourceFile } = createTestEnvironment({
      '/test-project/graphql.ts': TADA_GRAPHQL_MODULE,
      '/test-project/index.ts': `
        import { graphql } from './graphql';
        const Query = graphql(\`${FRAGMENT_ARGUMENTS_DOCUMENT}\`);
      `,
    });

    const source = getSourceFile('/test-project/index.ts');
    const diagnostics = getGraphQLDiagnostics(
      source.fileName,
      makeSchemaRef(),
      info
    );

    expect(diagnostics?.map(x => x.code)).toEqual([SEMANTIC_DIAGNOSTIC_CODE]);
    expect(`${diagnostics?.[0]?.messageText}`).toContain('Syntax Error');
  });
});
