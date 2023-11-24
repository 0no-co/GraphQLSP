import { graphql } from './gql/gql';

export const PokemonFields = graphql(`
  fragment pokemonFields on Pokemon {
    id
    name
    fleeRate
  }
`);
