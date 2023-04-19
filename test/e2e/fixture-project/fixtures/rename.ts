import { gql } from '@urql/core';

const PostsQuery = gql`
  query Posts {
    posts {
      title
    }
  }
`;
