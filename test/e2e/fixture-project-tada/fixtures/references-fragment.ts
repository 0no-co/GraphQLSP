import { graphql } from './graphql';

// prettier-ignore
export const ReferencedFields = graphql(`
  fragment referencedFields on Pokemon {
    id
    name
  }
`);

// prettier-ignore
export const ReferencedItemQuery = graphql(`
  query ReferencedItem($id: ID!) {
    pokemon(id: $id) {
      ...referencedFields
    }
  }
`, [ReferencedFields]);
