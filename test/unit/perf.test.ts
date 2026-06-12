import { describe, it, expect } from 'vitest';

import {
  createTestEnvironment,
  countTypeProbes,
  TADA_GRAPHQL_MODULE,
} from './language-service';
import { findAllCallExpressions } from '../../packages/graphqlsp/src/ast';

const NOISE_CALLS = 2_000;
const GRAPHQL_CALLS = 50;

/** A file dominated by ordinary, non-GraphQL calls with a string-literal
 * first argument, as found in real codebases (i18n, tests, validation). */
const makeNoisyFile = (): string => {
  const lines = [
    `import { graphql } from './graphql';`,
    `const g = graphql;`,
    `declare const t: (key: string, fallback?: string) => string;`,
    `declare function describeCase(name: string, fn: () => void): void;`,
    `declare function itCase(name: string, fn: () => void): void;`,
    `declare const logger: {`,
    `  info(message: string): void;`,
    `  warn(message: string): void;`,
    `};`,
  ];
  const callees = ['t', 'describeCase', 'itCase', 'logger.info', 'logger.warn'];
  for (let i = 0; i < NOISE_CALLS; i++) {
    const callee = callees[i % callees.length];
    lines.push(
      callee === 'describeCase' || callee === 'itCase'
        ? `${callee}('case ${i}', () => {});`
        : `${callee}('some.key.${i}');`
    );
  }
  for (let i = 0; i < GRAPHQL_CALLS; i++) {
    const callee = i % 2 ? 'graphql' : 'g';
    lines.push(`const Query${i} = ${callee}(\`query Q${i} { field }\`);`);
  }
  return lines.join('\n');
};

/** A file with many queries sharing the same fragment dependencies. */
const makeSharedFragmentsFile = (queries: number): string => {
  const lines = [
    `import { graphql } from './graphql';`,
    `const g = graphql;`,
    `export const FieldsA = g(\`fragment FieldsA on Pokemon { id }\`);`,
    `export const FieldsB = g(\`fragment FieldsB on Pokemon { ...FieldsA name }\`, [FieldsA]);`,
  ];
  for (let i = 0; i < queries; i++) {
    lines.push(
      `const Query${i} = g(\`query Q${i} { pokemon { ...FieldsB } } \`, [FieldsB]);`
    );
  }
  return lines.join('\n');
};

describe('findAllCallExpressions perf', () => {
  it('probes the type checker per distinct callee, not per call site', () => {
    const { info, getSourceFile } = createTestEnvironment({
      '/test-project/graphql.ts': TADA_GRAPHQL_MODULE,
      '/test-project/index.ts': makeNoisyFile(),
    });
    const source = getSourceFile('/test-project/index.ts');
    const getProbeCount = countTypeProbes(info);

    const start = performance.now();
    const { nodes } = findAllCallExpressions(source, info);
    const duration = performance.now() - start;

    expect(nodes).toHaveLength(GRAPHQL_CALLS);
    const probes = getProbeCount();
    // eslint-disable-next-line no-console
    console.log(
      `[perf] noisy file (${NOISE_CALLS} noise + ${GRAPHQL_CALLS} graphql calls): ` +
        `${probes} type probes, ${duration.toFixed(1)}ms`
    );

    // The noise calls' arguments can't start a GraphQL document, so they are
    // rejected without any type probes; only the graphql/g callees and their
    // schema names are probed, once per distinct callee
    expect(probes).toBeLessThan(10);
  });

  it('skips fragment unrolling entirely with collectFragments: false', () => {
    const queries = 200;
    const { info, getSourceFile } = createTestEnvironment({
      '/test-project/graphql.ts': TADA_GRAPHQL_MODULE,
      '/test-project/index.ts': makeSharedFragmentsFile(queries),
    });
    const source = getSourceFile('/test-project/index.ts');

    const start = performance.now();
    const result = findAllCallExpressions(source, info, {
      searchExternal: false,
      collectFragments: false,
    });
    const duration = performance.now() - start;

    expect(result.nodes).toHaveLength(queries + 2);
    expect(result.fragments).toEqual([]);
    // eslint-disable-next-line no-console
    console.log(
      `[perf] shared fragments (${queries} queries, collectFragments: false): ` +
        `${duration.toFixed(1)}ms`
    );
  });

  it('deduplicates fragment unrolling for repeated references', () => {
    const queries = 200;
    const { info, getSourceFile } = createTestEnvironment({
      '/test-project/graphql.ts': TADA_GRAPHQL_MODULE,
      '/test-project/index.ts': makeSharedFragmentsFile(queries),
    });
    const source = getSourceFile('/test-project/index.ts');

    const start = performance.now();
    const { nodes, fragments } = findAllCallExpressions(source, info);
    const duration = performance.now() - start;

    expect(nodes).toHaveLength(queries + 2);
    // each query reference contributes FieldsB + FieldsA, and the FieldsB
    // definition's own fragment array contributes FieldsA
    expect(fragments).toHaveLength(queries * 2 + 1);
    // eslint-disable-next-line no-console
    console.log(
      `[perf] shared fragments (${queries} queries, default): ` +
        `${duration.toFixed(1)}ms`
    );
  });
});
