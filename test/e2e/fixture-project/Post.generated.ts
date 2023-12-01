import * as Types from './__generated__/baseGraphQLSP';
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type PostFieldsFragment = { __typename: 'Post'; title: string };

export const PostFieldsFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'postFields' },
      typeCondition: {
        kind: 'NamedType',
        name: { kind: 'Name', value: 'Post' },
      },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [{ kind: 'Field', name: { kind: 'Name', value: 'title' } }],
      },
    },
  ],
} as unknown as DocumentNode<PostFieldsFragment, unknown>;
