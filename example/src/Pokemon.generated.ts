import { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: string;
  String: string;
  Boolean: boolean;
  Int: number;
  Float: number;
};

/** Move a Pokémon can perform with the associated damage and type. */
export type Attack = {
  __typename?: 'Attack';
  damage?: Maybe<Scalars['Int']>;
  name?: Maybe<Scalars['String']>;
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
  amount?: Maybe<Scalars['Int']>;
  name?: Maybe<Scalars['String']>;
};

export type Pokemon = {
  __typename?: 'Pokemon';
  attacks?: Maybe<AttacksConnection>;
  classification?: Maybe<Scalars['String']>;
  evolutionRequirements?: Maybe<Array<Maybe<EvolutionRequirement>>>;
  evolutions?: Maybe<Array<Maybe<Pokemon>>>;
  /** Likelihood of an attempt to catch a Pokémon to fail. */
  fleeRate?: Maybe<Scalars['Float']>;
  height?: Maybe<PokemonDimension>;
  id: Scalars['ID'];
  /** Maximum combat power a Pokémon may achieve at max level. */
  maxCP?: Maybe<Scalars['Int']>;
  /** Maximum health points a Pokémon may achieve at max level. */
  maxHP?: Maybe<Scalars['Int']>;
  name: Scalars['String'];
  resistant?: Maybe<Array<Maybe<PokemonType>>>;
  types?: Maybe<Array<Maybe<PokemonType>>>;
  weaknesses?: Maybe<Array<Maybe<PokemonType>>>;
  weight?: Maybe<PokemonDimension>;
};

export type PokemonDimension = {
  __typename?: 'PokemonDimension';
  maximum?: Maybe<Scalars['String']>;
  minimum?: Maybe<Scalars['String']>;
};

/** Elemental property associated with either a Pokémon or one of their moves. */
export type PokemonType =
  | 'Bug'
  | 'Dark'
  | 'Dragon'
  | 'Electric'
  | 'Fairy'
  | 'Fighting'
  | 'Fire'
  | 'Flying'
  | 'Ghost'
  | 'Grass'
  | 'Ground'
  | 'Ice'
  | 'Normal'
  | 'Poison'
  | 'Psychic'
  | 'Rock'
  | 'Steel'
  | 'Water';

export type Query = {
  __typename?: 'Query';
  /** Get a single Pokémon by its ID, a three character long identifier padded with zeroes */
  pokemon?: Maybe<Pokemon>;
  /** List out all Pokémon, optionally in pages */
  pokemons?: Maybe<Array<Maybe<Pokemon>>>;
};


export type QueryPokemonArgs = {
  id: Scalars['ID'];
};


export type QueryPokemonsArgs = {
  limit?: InputMaybe<Scalars['Int']>;
  skip?: InputMaybe<Scalars['Int']>;
};

export type FieldsFragment = { __typename?: 'Pokemon', attacks?: { __typename?: 'AttacksConnection', fast?: Array<{ __typename?: 'Attack', damage?: number | null } | null> | null } | null };

export type PokemonFieldsFragment = { __typename?: 'Pokemon', id: string, name: string };

export const FieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"fields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Pokemon"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"attacks"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"fast"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"damage"}}]}}]}}]}}]} as unknown as DocumentNode<FieldsFragment, unknown>;
export const PokemonFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"pokemonFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Pokemon"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}}]}}]} as unknown as DocumentNode<PokemonFieldsFragment, unknown>;