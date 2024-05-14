import { describe, it, expect } from 'vitest';

import { getGraphQLDiagnostics } from '../src/diagnostics';
import { createInfo, schemaRef } from './helpers';

describe('quick-info', () => {
  it('should error for querying something not present on the schema', () => {
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
