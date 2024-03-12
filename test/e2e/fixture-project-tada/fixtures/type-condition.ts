import { graphql } from './graphql';
import { PokemonFields } from './fragment';

// prettier-ignore
const x = graphql(`
  query Pok($limit: Int!) {
    pokemons(limit: $limit) {
      id
      name
      fleeRate
      classification
      ...pokemonFields
      __typename
      ... on 
    }
  }
`, [PokemonFields]);
