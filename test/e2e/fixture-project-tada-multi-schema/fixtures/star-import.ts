import * as pokemon from './pokemon';

// prettier-ignore
const x = pokemon.graphql(`
  query Pokemons($limit: Int!) {
    pokemons(limit: $limit) {
      id
      name
      fleeRate
      classification
      __typename
    }
  }
`);
