import { graphql } from './graphql';
import { Pokemon } from './fragment';

const x = graphql(`
  query Pok($limit: Int!) {
    pokemons(limit: $limit) {
      id
      name
    }
  }
`);

console.log(Pokemon);
