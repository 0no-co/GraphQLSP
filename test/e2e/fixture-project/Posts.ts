import { gql } from '@urql/core';
import { Post } from './Post';

const PostsQuery = gql`
  query PostsList {
    posts {
      id
    }
  }
`;

Post({ title: '' });
