/* eslint-disable */
import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = {
  [K in keyof T]: T[K];
};
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]?: Maybe<T[SubKey]>;
};
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]: Maybe<T[SubKey]>;
};
export type MakeEmpty<
  T extends { [key: string]: unknown },
  K extends keyof T
> = { [_ in K]?: never };
export type Incremental<T> =
  | T
  | {
      [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never;
    };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string };
  String: { input: string; output: string };
  Boolean: { input: boolean; output: boolean };
  Int: { input: number; output: number };
  Float: { input: number; output: number };
};

/** Move a Pokémon can perform with the associated damage and type. */
export type Attack = {
  __typename?: 'Attack';
  damage?: Maybe<Scalars['Int']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  type?: Maybe<PokemonType>;
};

export type AttacksConnection = {
  __typename?: 'AttacksConnection';
  fast?: Maybe<Array<Maybe<Attack>>>;
  special?: Maybe<Array<Maybe<Attack>>>;
};

/** Requirement that prevents an evolution through regular means of levelling up. */
export type EvolutionRequirement = {
  __typename?: 'EvolutionRequirement';
  amount?: Maybe<Scalars['Int']['output']>;
  name?: Maybe<Scalars['String']['output']>;
};

export type Pokemon = {
  __typename?: 'Pokemon';
  attacks?: Maybe<AttacksConnection>;
  /** @deprecated And this is the reason why */
  classification?: Maybe<Scalars['String']['output']>;
  evolutionRequirements?: Maybe<Array<Maybe<EvolutionRequirement>>>;
  evolutions?: Maybe<Array<Maybe<Pokemon>>>;
  /** Likelihood of an attempt to catch a Pokémon to fail. */
  fleeRate?: Maybe<Scalars['Float']['output']>;
  height?: Maybe<PokemonDimension>;
  id: Scalars['ID']['output'];
  /** Maximum combat power a Pokémon may achieve at max level. */
  maxCP?: Maybe<Scalars['Int']['output']>;
  /** Maximum health points a Pokémon may achieve at max level. */
  maxHP?: Maybe<Scalars['Int']['output']>;
  name: Scalars['String']['output'];
  resistant?: Maybe<Array<Maybe<PokemonType>>>;
  types?: Maybe<Array<Maybe<PokemonType>>>;
  weaknesses?: Maybe<Array<Maybe<PokemonType>>>;
  weight?: Maybe<PokemonDimension>;
};

export type PokemonDimension = {
  __typename?: 'PokemonDimension';
  maximum?: Maybe<Scalars['String']['output']>;
  minimum?: Maybe<Scalars['String']['output']>;
};

/** Elemental property associated with either a Pokémon or one of their moves. */
export enum PokemonType {
  Bug = 'Bug',
  Dark = 'Dark',
  Dragon = 'Dragon',
  Electric = 'Electric',
  Fairy = 'Fairy',
  Fighting = 'Fighting',
  Fire = 'Fire',
  Flying = 'Flying',
  Ghost = 'Ghost',
  Grass = 'Grass',
  Ground = 'Ground',
  Ice = 'Ice',
  Normal = 'Normal',
  Poison = 'Poison',
  Psychic = 'Psychic',
  Rock = 'Rock',
  Steel = 'Steel',
  Water = 'Water',
}

export type Query = {
  __typename?: 'Query';
  /** Get a single Pokémon by its ID, a three character long identifier padded with zeroes */
  pokemon?: Maybe<Pokemon>;
  /** List out all Pokémon, optionally in pages */
  pokemons?: Maybe<Array<Maybe<Pokemon>>>;
};

export type QueryPokemonArgs = {
  id: Scalars['ID']['input'];
};

export type QueryPokemonsArgs = {
  limit?: InputMaybe<Scalars['Int']['input']>;
  skip?: InputMaybe<Scalars['Int']['input']>;
};

export type PokemonFieldsFragment = {
  __typename?: 'Pokemon';
  id: string;
  name: string;
  attacks?: {
    __typename?: 'AttacksConnection';
    fast?: Array<{
      __typename?: 'Attack';
      damage?: number | null;
      name?: string | null;
    } | null> | null;
  } | null;
} & { ' $fragmentName'?: 'PokemonFieldsFragment' };

export type WeaknessFieldsFragment = {
  __typename?: 'Pokemon';
  weaknesses?: Array<PokemonType | null> | null;
} & { ' $fragmentName'?: 'WeaknessFieldsFragment' };

export type PokQueryVariables = Exact<{
  limit: Scalars['Int']['input'];
}>;

export type PokQuery = {
  __typename?: 'Query';
  pokemons?: Array<
    | ({
        __typename: 'Pokemon';
        id: string;
        name: string;
        fleeRate?: number | null;
        classification?: string | null;
      } & {
        ' $fragmentRefs'?: {
          PokemonFieldsFragment: PokemonFieldsFragment;
          WeaknessFieldsFragment: WeaknessFieldsFragment;
        };
      })
    | null
  > | null;
};

export type PoQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;

export type PoQuery = {
  __typename?: 'Query';
  pokemon?: {
    __typename: 'Pokemon';
    id: string;
    fleeRate?: number | null;
  } | null;
};

export type PokemonsAreAwesomeQueryVariables = Exact<{ [key: string]: never }>;

export type PokemonsAreAwesomeQuery = {
  __typename?: 'Query';
  pokemons?: Array<{ __typename?: 'Pokemon'; id: string } | null> | null;
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
export const PokDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'Pok' },
      variableDefinitions: [
        {
          kind: 'VariableDefinition',
          variable: {
            kind: 'Variable',
            name: { kind: 'Name', value: 'limit' },
          },
          type: {
            kind: 'NonNullType',
            type: { kind: 'NamedType', name: { kind: 'Name', value: 'Int' } },
          },
        },
      ],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [
          {
            kind: 'Field',
            name: { kind: 'Name', value: 'pokemons' },
            arguments: [
              {
                kind: 'Argument',
                name: { kind: 'Name', value: 'limit' },
                value: {
                  kind: 'Variable',
                  name: { kind: 'Name', value: 'limit' },
                },
              },
            ],
            selectionSet: {
              kind: 'SelectionSet',
              selections: [
                { kind: 'Field', name: { kind: 'Name', value: 'id' } },
                { kind: 'Field', name: { kind: 'Name', value: 'name' } },
                { kind: 'Field', name: { kind: 'Name', value: 'fleeRate' } },
                {
                  kind: 'Field',
                  name: { kind: 'Name', value: 'classification' },
                },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'pokemonFields' },
                },
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'weaknessFields' },
                },
                { kind: 'Field', name: { kind: 'Name', value: '__typename' } },
              ],
            },
          },
        ],
      },
    },
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
} as unknown as DocumentNode<PokQuery, PokQueryVariables>;
export const PoDocument = {
  kind: 'Document',
  definitions: [
    {
      kind: 'OperationDefinition',
      operation: 'query',
      name: { kind: 'Name', value: 'Po' },
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
} as unknown as DocumentNode<PoQuery, PoQueryVariables>;
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
