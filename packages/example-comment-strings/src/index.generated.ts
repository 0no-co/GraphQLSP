import * as Types from '../__generated__/baseGraphQLSP';
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type PokemonsAreAwesomeQueryVariables = Types.Exact<{
  [key: string]: never;
}>;

export type PokemonsAreAwesomeQuery = {
  __typename: 'Query';
  pokemons?: Array<{ __typename: 'Pokemon'; id: string } | null> | null;
};

export const PokemonsAreAwesomeDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'PokemonsAreAwesome' },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'pokemons' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  PokemonsAreAwesomeQuery,
  PokemonsAreAwesomeQueryVariables
>;
