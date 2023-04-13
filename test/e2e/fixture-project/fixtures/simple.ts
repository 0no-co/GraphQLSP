import gql from 'graphql-tag';

const PostsQuery = gql`
  query AllPosts {
    posts {
      title
    }
  }
`;
