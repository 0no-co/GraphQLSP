import { graphql } from './graphql.js';
import { Pokemon } from './fragment.js';

export const PokemonQuery = graphql(`
  query Pokemon($id: ID!) {
    pokemon(id: $id) {
      id
      name
    }
  }
`);

console.log(Pokemon);
