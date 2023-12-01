import { gql } from '@urql/core';

export const PostFields = gql`
  fragment postFields on Post {
    title
  }
` as typeof import('./Post.generated').PostFieldsFragmentDoc;

export const Post = (post: any) => {
  return post.title;
};
