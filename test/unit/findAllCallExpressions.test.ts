import { describe, it, expect } from 'vitest';
import { buildSchema } from '../../packages/graphqlsp/node_modules/graphql/index.js';

import {
  createTestEnvironment,
  countTypeProbes,
  TADA_GRAPHQL_MODULE,
  ts,
} from './language-service';
import { findAllCallExpressions } from '../../packages/graphqlsp/src/ast';
import { resolveTemplate } from '../../packages/graphqlsp/src/ast/resolve';
import {
  DYNAMIC_TEMPLATE_INTERPOLATION_CODE,
  getGraphQLDiagnostics,
  MISSMATCH_HASH_TO_DOCUMENT,
  MISSING_PERSISTED_DOCUMENT,
} from '../../packages/graphqlsp/src/diagnostics';
import type { SchemaRef } from '../../packages/graphqlsp/src/graphql/getSchema';

const makeSchemaRef = (): SchemaRef => {
  const schema = buildSchema(`
    type Query { pokemon: Pokemon }
    type Pokemon { id: ID, name: String }
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

  it('discovers template expressions passed to graphql calls', () => {
    const { info, getSourceFile } = createTestEnvironment({
      '/test-project/graphql.ts': TADA_GRAPHQL_MODULE,
      '/test-project/index.ts': `
        import { graphql } from './graphql';
        const g = graphql;
        const fields = \`id name\` as const;
        const Query = g(\`query One { pokemon { \${fields} } }\`);
      `,
    });
    const source = getSourceFile('/test-project/index.ts');

    const { nodes } = findAllCallExpressions(source, info);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.node).toSatisfy(ts.isTemplateExpression);
  });

  it('validates statically resolved template expressions', () => {
    const { info, getSourceFile } = createTestEnvironment({
      '/test-project/graphql.ts': TADA_GRAPHQL_MODULE,
      '/test-project/index.ts': `
        import { graphql } from './graphql';
        const fields = \`id name\` as const;
        const Query = graphql(\`
          query One { pokemon { \${fields} unknownField } }
        \`);
      `,
    });
    const source = getSourceFile('/test-project/index.ts');
    const schemaRef = makeSchemaRef();

    const found = findAllCallExpressions(source, info).nodes[0]!;
    const resolved = resolveTemplate(found.node, source.fileName, info);
    expect(resolved.combinedText).toContain('id name unknownField');
    expect(resolved.resolvedSpans).toHaveLength(1);

    const diagnostics = getGraphQLDiagnostics(source.fileName, schemaRef, info);
    expect(diagnostics?.map(x => x.messageText)).toContain(
      'Cannot query field "unknownField" on type "Pokemon".'
    );
    const diagnostic = diagnostics?.find(x =>
      `${x.messageText}`.includes('unknownField')
    );
    expect(
      source.text.slice(
        diagnostic!.start!,
        diagnostic!.start! + diagnostic!.length!
      )
    ).toBe('unknownField');
    expect(diagnostic!.length).toBe('unknownField'.length);
  });

  it('maps diagnostics inside static interpolation back to the expression', () => {
    const { info, getSourceFile } = createTestEnvironment({
      '/test-project/graphql.ts': TADA_GRAPHQL_MODULE,
      '/test-project/index.ts': `
        import { graphql } from './graphql';
        const fields = \`id unknownField\` as const;
        const Query = graphql(\`query One { pokemon { \${fields} } }\`);
      `,
    });
    const source = getSourceFile('/test-project/index.ts');

    const diagnostic = getGraphQLDiagnostics(
      source.fileName,
      makeSchemaRef(),
      info
    )?.find(x => `${x.messageText}`.includes('unknownField'));

    expect(
      source.text.slice(
        diagnostic!.start!,
        diagnostic!.start! + diagnostic!.length!
      )
    ).toBe('${fields}');
  });

  it('maps diagnostics after adjacent static interpolations', () => {
    const { info, getSourceFile } = createTestEnvironment({
      '/test-project/graphql.ts': TADA_GRAPHQL_MODULE,
      '/test-project/index.ts': `
        import { graphql } from './graphql';
        const fields = \`id \` as const;
        const separator = \`\` as const;
        const Query = graphql(\`query One { pokemon { \${fields}\${separator}unknownField } }\`);
      `,
    });
    const source = getSourceFile('/test-project/index.ts');

    const diagnostic = getGraphQLDiagnostics(
      source.fileName,
      makeSchemaRef(),
      info
    )?.find(x => `${x.messageText}`.includes('unknownField'));

    expect(
      source.text.slice(
        diagnostic!.start!,
        diagnostic!.start! + 'unknownField'.length
      )
    ).toBe('unknownField');
  });

  it('warns when a template interpolation cannot be resolved statically', () => {
    const { info, getSourceFile } = createTestEnvironment({
      '/test-project/graphql.ts': TADA_GRAPHQL_MODULE,
      '/test-project/index.ts': `
        import { graphql } from './graphql';
        const g = graphql;
        declare const fields: string;
        const Query = g(\`query One { pokemon { \${fields} } }\`);
      `,
    });
    const source = getSourceFile('/test-project/index.ts');

    const diagnostics = getGraphQLDiagnostics(
      source.fileName,
      makeSchemaRef(),
      info
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        category: ts.DiagnosticCategory.Warning,
        code: DYNAMIC_TEMPLATE_INTERPOLATION_CODE,
        messageText:
          'GraphQL documents with non-static template interpolation cannot be validated.',
      }),
    ]);
  });

  it('accepts static interpolation in persisted documents', () => {
    const { info, getSourceFile } = createTestEnvironment({
      '/test-project/graphql.ts': TADA_GRAPHQL_MODULE,
      '/test-project/index.ts': `
        import { graphql } from './graphql';
        const fields = \`id name\` as const;
        const Query = graphql(\`query One { pokemon { \${fields} } }\`);
        graphql.persisted<typeof Query>('sha256:invalid');
      `,
    });
    const source = getSourceFile('/test-project/index.ts');

    const diagnostics = getGraphQLDiagnostics(
      source.fileName,
      makeSchemaRef(),
      info
    );

    expect(diagnostics?.map(x => x.code)).toContain(MISSMATCH_HASH_TO_DOCUMENT);
    expect(diagnostics?.map(x => x.code)).not.toContain(
      MISSING_PERSISTED_DOCUMENT
    );
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
