import { maskFragments } from './graphql';
import { Pokemon, PokemonFields } from './fragment';

const data = { id: '1', name: 'Pikachu', fleeRate: 0.1 };
const x = maskFragments([PokemonFields], data);

console.log(Pokemon);
