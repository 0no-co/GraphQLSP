import { describe, it, expect } from 'vitest';

import { getGraphQLDiagnostics } from '../src/diagnostics';
import { createInfo, schemaRef } from './helpers';

describe('quick-info', () => {
  it('should error for querying a field not present in the schema', () => {
    const program = createInfo(
      "import { graphql } from '/graphql'; const query = graphql(`query Dragons { dragons { id } }`)"
    );
    const diagnostics = getGraphQLDiagnostics(
      'index.ts',
      schemaRef,
      program as any
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics).toMatchObject([
      {
        length: 8,
        start: 75,
        category: 1,
        code: 52001,
        messageText: 'Cannot query field "dragons" on type "Query".',
      },
    ]);
  });

  it('should error for querying an unknown typeCondition', () => {
    const program = createInfo(
      "import { graphql } from '/graphql'; const query = graphql(`fragment Fields on Dragon { id }`)"
    );
    const diagnostics = getGraphQLDiagnostics(
      'index.ts',
      schemaRef,
      program as any
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics).toMatchObject([
      {
        category: 1,
        messageText: 'Unknown type "Dragon".',
      },
    ]);
  });

  it.skip('should combine fragments', () => {
    const program = createInfo(
      `import { graphql } from './graphql';
import { PokemonFields } from './fragment';

// prettier-ignore
const x = graphql(\`
  query Pok($limit: Int!) {
    pokemons(limit: $limit) {
      id
      name
      fleeRate
      classification
      ...pokemonFields
      __typename
    }
  }
\`, [PokemonFields]);`,
      [
        {
          filename: '/fragment.ts',
          contents: `import { graphql } from './graphql';

// prettier-ignore
export const PokemonFields = graphql(\`
  fragment pokemonFields on Pokemon {
    id
    name
    fleeRate

  }
\`);
  
// prettier-ignore
export const Regression190 = graphql(\`
fragment pokemonFields on Pokemon {
  id
  name
  fleeRate
  
}
\`);
  
export const Pokemon = () => {};
  `,
        },
      ]
    );

    const fragmentDiagnostics = getGraphQLDiagnostics(
      '/fragment.ts',
      schemaRef,
      program as any
    );
    const diagnostics = getGraphQLDiagnostics(
      'index.ts',
      schemaRef,
      program as any
    );
    expect(fragmentDiagnostics).toHaveLength(0);
    console.log(diagnostics);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics).toMatchObject([
      {
        category: 1,
        messageText: 'Unknown type "Dragon".',
      },
    ]);
  });

  it('should warn us for a missing operation-name', () => {
    const program = createInfo(
      "import { graphql } from '/graphql'; const query = graphql(`query { pokemons { id } }`)"
    );

    const diagnostics = getGraphQLDiagnostics(
      'index.ts',
      schemaRef,
      program as any
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics).toMatchObject([
      {
        file: expect.anything(),
        length: 27,
        start: 58,
        category: 0,
        code: 52002,
        messageText: 'Operation should contain a name.',
      },
    ]);
  });
});
