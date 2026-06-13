import { graphql, type FragmentOf } from './graphql';
import { PokemonFields } from './fragment';

const x = graphql(`
  query Pok($limit: Int!) {
    pokemons(limit: $limit) {
      id
      name
    }
  }
`);

export const render = (pokemon: FragmentOf<typeof PokemonFields>) => pokemon;

console.log(x);
