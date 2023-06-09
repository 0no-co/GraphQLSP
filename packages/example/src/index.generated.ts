import * as Types from '../__generated__/baseGraphQLSP';
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type PokemonsQueryVariables = Types.Exact<{ [key: string]: never }>;

export type PokemonsQuery = {
  __typename: 'Query';
  pokemons?: Array<{
    __typename: 'Pokemon';
    id: string;
    name: string;
    fleeRate?: number | null;
  } | null> | null;
};

export type PokemonQueryVariables = Types.Exact<{
  id: Types.Scalars['ID'];
}>;

export type PokemonQuery = {
  __typename: 'Query';
  pokemon?: {
    __typename: 'Pokemon';
    id: string;
    fleeRate?: number | null;
  } | null;
};

export const PokemonsDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'Pokemons' },
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
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                { kind: 'Field', name: { kind: 'Name', value: '__typename' } },
                { kind: 'Field', name: { kind: 'Name', value: 'fleeRate' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<PokemonsQuery, PokemonsQueryVariables>;
export const PokemonDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'Pokemon' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: { kind: 'Variable', name: { kind: 'Name', value: 'id' } },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'ID' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'pokemon' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'id' },
                value: {
                  kind: 'Variable',
                  name: { kind: 'Name', value: 'id' },
                },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'fleeRate' } },
                { kind: 'Field', name: { kind: 'Name', value: '__typename' } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<PokemonQuery, PokemonQueryVariables>;
