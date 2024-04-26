import { graphql } from './pokemon';

// prettier-ignore
const x = graphql(`
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
