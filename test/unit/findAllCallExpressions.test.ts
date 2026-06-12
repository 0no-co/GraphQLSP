import { describe, it, expect } from 'vitest';

import {
  createTestEnvironment,
  countTypeProbes,
  TADA_GRAPHQL_MODULE,
} from './language-service';
import { findAllCallExpressions } from '../../packages/graphqlsp/src/ast';

const FRAGMENT_FIXTURE = `
  import { graphql } from './graphql';
  const g = graphql;

  export const PokemonFields = g(\`
    fragment PokemonFields on Pokemon { id name }
  \`);

  export const MoreFields = g(\`
    fragment MoreFields on Pokemon { ...PokemonFields hp }
  \`, [PokemonFields]);

  const QueryOne = g(\`
    query One { pokemon { ...MoreFields } }
  \`, [MoreFields]);

  const QueryTwo = g(\`
    query Two { pokemon { ...MoreFields } }
  \`, [MoreFields]);
`;

const makeEnvironment = () =>
  createTestEnvironment({
    '/test-project/graphql.ts': TADA_GRAPHQL_MODULE,
    '/test-project/index.ts': FRAGMENT_FIXTURE,
  });

describe('findAllCallExpressions', () => {
  it('detects tada graphql functions aliased to other names', () => {
    const { info, getSourceFile } = makeEnvironment();
    const source = getSourceFile('/test-project/index.ts');

    const { nodes } = findAllCallExpressions(source, info);
    expect(nodes).toHaveLength(4);
    expect(nodes.map(x => x.schema)).toEqual([
      'pokemons',
      'pokemons',
      'pokemons',
      'pokemons',
    ]);
    expect(nodes.map(x => x.tadaFragmentRefs?.length)).toEqual([0, 1, 1, 1]);
  });

  it('collects fragments from fragment arrays, once per reference', () => {
    const { info, getSourceFile } = makeEnvironment();
    const source = getSourceFile('/test-project/index.ts');

    const { fragments } = findAllCallExpressions(source, info);
    expect(fragments.map(fragment => fragment.name.value)).toEqual([
      // from `MoreFields`' fragment array:
      'PokemonFields',
      // from `QueryOne`'s fragment array:
      'MoreFields',
      'PokemonFields',
      // from `QueryTwo`'s fragment array:
      'MoreFields',
      'PokemonFields',
    ]);
  });

  it('returns identical nodes but no fragments with collectFragments: false', () => {
    const { info, getSourceFile } = makeEnvironment();
    const source = getSourceFile('/test-project/index.ts');

    const expected = findAllCallExpressions(source, info);
    const result = findAllCallExpressions(source, info, {
      searchExternal: false,
      collectFragments: false,
    });

    expect(result.nodes).toEqual(expected.nodes);
    expect(result.fragments).toEqual([]);
  });

  it('discovers documents with leading ignored tokens', () => {
    const { info, getSourceFile } = createTestEnvironment({
      '/test-project/graphql.ts': TADA_GRAPHQL_MODULE,
      '/test-project/index.ts': `
        import { graphql } from './graphql';
        const g = graphql;

        const CommentFirst = g(\`
          # A leading comment
          query One { pokemon { id } }
        \`);
        const Shorthand = g('{ pokemon { id } }');
        const Mutation = g(\`mutation Two { evolve }\`);
        const Subscription = g(\`subscription Three { evolved }\`);
      `,
    });
    const source = getSourceFile('/test-project/index.ts');

    const { nodes } = findAllCallExpressions(source, info);
    expect(nodes).toHaveLength(4);
  });

  it('rejects non-document strings without probing the callee type', () => {
    const { info, getSourceFile } = createTestEnvironment({
      '/test-project/graphql.ts': TADA_GRAPHQL_MODULE,
      '/test-project/index.ts': `
        declare const t: (key: string, fallback?: string) => string;
        declare function describeCase(name: string, fn: () => void): void;

        t('page.title');
        t('query.results.empty', 'No results');
        describeCase('queries the API', () => {});
      `,
    });
    const source = getSourceFile('/test-project/index.ts');
    const getProbeCount = countTypeProbes(info);

    const { nodes } = findAllCallExpressions(source, info);
    expect(nodes).toHaveLength(0);
    // None of the string arguments can start a GraphQL document, so the
    // callees' types are never resolved
    expect(getProbeCount()).toBe(0);
  });

  it('keeps boolean third argument behavior (searchExternal only)', () => {
    const { info, getSourceFile } = makeEnvironment();
    const source = getSourceFile('/test-project/index.ts');

    const expected = findAllCallExpressions(source, info, true);
    const result = findAllCallExpressions(source, info, false);

    // A boolean only gates the external fragment search; fragment arrays
    // are still unrolled
    expect(result.nodes).toEqual(expected.nodes);
    expect(result.fragments).toEqual(expected.fragments);
    expect(result.fragments.length).toBeGreaterThan(0);
  });
});
