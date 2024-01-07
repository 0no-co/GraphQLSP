import { gql } from '@urql/core';

const PostsQuery = gql`
  query AllPosts {
    posts {
      title
      
    }
  }
`;

const sql = (x: string | TemplateStringsArray) => x;
const x = sql`'{}'`;
