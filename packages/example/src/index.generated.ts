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
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: string;
  String: string;
  Boolean: boolean;
  Int: number;
  Float: number;
};

/** Elemental property associated with either a Pokémon or one of their moves. */
export type PokemonType =
  | 'Grass'
  | 'Poison'
  | 'Fire'
  | 'Flying'
  | 'Water'
  | 'Bug'
  | 'Normal'
  | 'Electric'
  | 'Ground'
  | 'Fairy'
  | 'Fighting'
  | 'Psychic'
  | 'Rock'
  | 'Steel'
  | 'Ice'
  | 'Ghost'
  | 'Dragon'
  | 'Dark';

/** Move a Pokémon can perform with the associated damage and type. */
export type Attack = {
  __typename?: 'Attack';
  name?: Maybe<Scalars['String']>;
  type?: Maybe<PokemonType>;
  damage?: Maybe<Scalars['Int']>;
};

/** Requirement that prevents an evolution through regular means of levelling up. */
export type EvolutionRequirement = {
  __typename?: 'EvolutionRequirement';
  amount?: Maybe<Scalars['Int']>;
  name?: Maybe<Scalars['String']>;
};

export type PokemonDimension = {
  __typename?: 'PokemonDimension';
  minimum?: Maybe<Scalars['String']>;
  maximum?: Maybe<Scalars['String']>;
};

export type AttacksConnection = {
  __typename?: 'AttacksConnection';
  fast?: Maybe<Array<Maybe<Attack>>>;
  special?: Maybe<Array<Maybe<Attack>>>;
};

export type Pokemon = {
  __typename?: 'Pokemon';
  id: Scalars['ID'];
  name: Scalars['String'];
  classification?: Maybe<Scalars['String']>;
  types?: Maybe<Array<Maybe<PokemonType>>>;
  resistant?: Maybe<Array<Maybe<PokemonType>>>;
  weaknesses?: Maybe<Array<Maybe<PokemonType>>>;
  evolutionRequirements?: Maybe<Array<Maybe<EvolutionRequirement>>>;
  weight?: Maybe<PokemonDimension>;
  height?: Maybe<PokemonDimension>;
  attacks?: Maybe<AttacksConnection>;
  /** Likelihood of an attempt to catch a Pokémon to fail. */
  fleeRate?: Maybe<Scalars['Float']>;
  /** Maximum combat power a Pokémon may achieve at max level. */
  maxCP?: Maybe<Scalars['Int']>;
  /** Maximum health points a Pokémon may achieve at max level. */
  maxHP?: Maybe<Scalars['Int']>;
  evolutions?: Maybe<Array<Maybe<Pokemon>>>;
};

export type Query = {
  __typename?: 'Query';
  /** List out all Pokémon, optionally in pages */
  pokemons?: Maybe<Array<Maybe<Pokemon>>>;
  /** Get a single Pokémon by its ID, a three character long identifier padded with zeroes */
  pokemon?: Maybe<Pokemon>;
};

export type QueryPokemonsArgs = {
  limit?: InputMaybe<Scalars['Int']>;
  skip?: InputMaybe<Scalars['Int']>;
};

export type QueryPokemonArgs = {
  id: Scalars['ID'];
};

export type PokemonsQueryVariables = Exact<{ [key: string]: never }>;

export type PokemonsQuery = {
  __typename?: 'Query';
  pokemons?: Array<{
    __typename: 'Pokemon';
    id: string;
    name: string;
    fleeRate?: number | null;
  } | null> | null;
};

export type PokemonFieldsFragment = {
  __typename?: 'Pokemon';
  id: string;
  name: string;
};

export type PokemonQueryVariables = Exact<{
  id: Scalars['ID'];
}>;

export type PokemonQuery = {
  __typename?: 'Query';
  pokemon?: {
    __typename: 'Pokemon';
    id: string;
    fleeRate?: number | null;
    name: string;
  } | null;
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
        ],
      },
    },
  ],
} as unknown as DocumentNode<PokemonFieldsFragment, unknown>;
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
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'pokemonFields' },
                },
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
                {
                  kind: 'FragmentSpread',
                  name: { kind: 'Name', value: 'pokemonFields' },
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
        ],
      },
    },
  ],
} as unknown as DocumentNode<PokemonQuery, PokemonQueryVariables>;
