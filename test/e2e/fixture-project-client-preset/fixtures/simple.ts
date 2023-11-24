import { graphql } from './gql/gql';

const x = graphql(`
  query Pok($limit: Int!) {
    pokemons(limit: $limit) {
      id
      name
      fleeRate
      classification
      ...pokemonFields
      __typename
    }
  }
`);
