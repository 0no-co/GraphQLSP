import { gql } from '@urql/core';

const PostsQuery = gql`
  query AllPosts {
    posts {
      title
      
    }
  }
`;

const Regression190 = gql`
query AllPosts {
  
}
`;

const sql = (x: string | TemplateStringsArray) => x;
const x = sql`'{}'`;
