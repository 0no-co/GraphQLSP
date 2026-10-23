import { readFragment, type ResultOf } from './graphql.js';
import { Pokemons, Attacks } from './queries.graphql';

declare const result: ResultOf<typeof Pokemons>;
const pokemon = result.pokemons![0]!;
export const damage: string = readFragment(Attacks, pokemon).attacks?.fast?.[0]
  ?.damage;
