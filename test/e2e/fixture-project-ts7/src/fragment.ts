import { graphql } from './graphql.js';

export const PokemonFields = graphql(`
  fragment pokemonFields on Pokemon {
    id
    name
    fleeRate
  }
`);

export const Pokemon = () => {};
