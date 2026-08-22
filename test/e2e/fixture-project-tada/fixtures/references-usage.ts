import { graphql } from './graphql';
import { ReferencedFields } from './references-fragment';

// prettier-ignore
export const ReferencedListQuery = graphql(`
  query ReferencedList($limit: Int!) {
    pokemons(limit: $limit) {
      ...referencedFields
      __typename
    }
  }
`, [ReferencedFields]);
