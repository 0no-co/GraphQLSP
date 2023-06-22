import { gql } from "@urql/core";

const frag = gql`
  fragment fields on Post {
    id
    someUnknownField
  }
`;

const query = gql`
  ${frag}

  query Po {
    posts {

      __typenam
      ...fields
    }
  }
`
