import { graphql } from './graphql.js';
import { PokemonFields } from './fragment.js';

// Spreads a fragment from another file, which has to be resolved through the type checker
export const PokemonsQuery = graphql(
  `
    query Pokemons($limit: Int!) {
      pokemons(limit: $limit) {
        id
        ...pokemonFields
      }
    }
  `,
  [PokemonFields]
);
