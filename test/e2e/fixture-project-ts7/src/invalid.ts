import { graphql } from './graphql.js';

export const PokemonQuery = graphql(`
  query Pokemon($id: ID!) {
    pokemon(id: $id) {
      id
      nmae
      classification
      ...missingFragment
    }
  }
`);
