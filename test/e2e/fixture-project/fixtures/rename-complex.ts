import { gql } from '@urql/core';

export const PostFields = gql`
  fragment PostFields on Post {
    id
  }
` as typeof import('./rename-complex.generated').PostFieldsFragmentDoc;

export const Post2Fields = gql`
  fragment Post2Fields on Post {
    title
  }
` as typeof import('./rename-complex.generated').PostFieldsFragmentDoc;
