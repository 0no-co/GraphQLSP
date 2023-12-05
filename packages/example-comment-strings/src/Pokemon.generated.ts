import * as Types from '../__generated__/baseGraphQLSP';
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type PokemonFieldsFragment = {
  __typename: 'Pokemon';
  id: string;
  name: string;
  attacks?: {
    __typename: 'AttacksConnection';
    fast?: Array<{
      __typename: 'Attack';
      damage?: number | null;
      name?: string | null;
    } | null> | null;
  } | null;
};

export type WeaknessFieldsFragment = {
  __typename: 'Pokemon';
  weaknesses?: Array<Types.PokemonType | null> | null;
};

export const PokemonFieldsFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'pokemonFields' },
      typeCondition: {
        kind: 'NamedType',
        name: { kind: 'Name', value: 'Pokemon' },
      },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'id' } },
          { kind: 'Field', name: { kind: 'Name', value: 'name' } },
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'attacks' },
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'fast' },
                  selectionSet: {
                    kind: 'SelectionSet',
                    selections: [
                      {
                        kind: 'Field',
                        name: { kind: 'Name', value: 'damage' },
                      },
                      { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<PokemonFieldsFragment, unknown>;
export const WeaknessFieldsFragmentDoc = {
  kind: 'Document',
  definitions: [
    {
      kind: 'FragmentDefinition',
      name: { kind: 'Name', value: 'weaknessFields' },
      typeCondition: {
        kind: 'NamedType',
        name: { kind: 'Name', value: 'Pokemon' },
      },
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          { kind: 'Field', name: { kind: 'Name', value: 'weaknesses' } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<WeaknessFieldsFragment, unknown>;