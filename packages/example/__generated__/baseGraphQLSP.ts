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
  __typename: 'Attack';
  damage?: Maybe<Scalars['Int']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  type?: Maybe<PokemonType>;
};

export type AttacksConnection = {
  __typename: 'AttacksConnection';
  fast?: Maybe<Array<Maybe<Attack>>>;
  special?: Maybe<Array<Maybe<Attack>>>;
};

/** Requirement that prevents an evolution through regular means of levelling up. */
export type EvolutionRequirement = {
  __typename: 'EvolutionRequirement';
  amount?: Maybe<Scalars['Int']['output']>;
  name?: Maybe<Scalars['String']['output']>;
};

export type Pokemon = {
  __typename: 'Pokemon';
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
  __typename: 'PokemonDimension';
  maximum?: Maybe<Scalars['String']['output']>;
  minimum?: Maybe<Scalars['String']['output']>;
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
  __typename: 'Query';
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
