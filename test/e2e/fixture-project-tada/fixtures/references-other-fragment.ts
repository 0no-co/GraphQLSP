import { graphql } from './graphql';

// An independent fragment set deliberately reuses the same GraphQL name.
// References and rename for ReferencedFields must not include these tokens.
// prettier-ignore
export const OtherReferencedFields = graphql(`
  fragment referencedFields on Pokemon {
    id
  }
`);

// prettier-ignore
export const OtherReferencedItemQuery = graphql(`
  query OtherReferencedItem($id: ID!) {
    pokemon(id: $id) {
      ...referencedFields
    }
  }
`, [OtherReferencedFields]);
