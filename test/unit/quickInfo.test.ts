import { describe, expect, it } from 'vitest';
import { buildSchema } from '../../packages/graphqlsp/node_modules/graphql/index.js';

import { Cursor } from '../../packages/graphqlsp/src/ast/cursor';
import { getHoverInfo } from '../../packages/graphqlsp/src/quickInfo';

const schema = buildSchema(`
  input SearchFilter {
    "Text to match"
    term: String
  }

  type Query {
    search(filter: SearchFilter): String
  }
`);

const query =
  'query Search($term: String!) { search(filter: { term: $term }) }';

const cursorAt = (needle: string) => new Cursor(0, query.indexOf(needle) + 1);

describe('getHoverInfo', () => {
  it('preserves variable hover information', () => {
    const hover = getHoverInfo(schema, query, cursorAt('$term })'));

    expect(hover).toEqual({
      signature: 'String',
      description:
        'The `String` scalar type represents textual data, represented as UTF-8 character sequences. The String type is most often used by GraphQL to represent free-form human-readable text.',
      deprecationReason: undefined,
    });
  });

  it('preserves input object field hover information', () => {
    const hover = getHoverInfo(schema, query, cursorAt('term: $term'));

    expect(hover).toEqual({
      signature: 'Query.term: String',
      description: 'Text to match',
      deprecationReason: undefined,
    });
  });
});
