import { gql } from '@urql/core';

export const fields = gql`
  fragment fields on Pokemon {
    classification
  }
` as typeof import('./Pokemon.generated').FieldsFragmentDoc;

export const PokemonFields = gql`
  fragment pokemonFields on Pokemon {
    id
    name
  }
` as typeof import('./Pokemon.generated').PokemonFieldsFragmentDoc;
