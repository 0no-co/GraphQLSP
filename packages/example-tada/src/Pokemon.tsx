import { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { FragmentOf, graphql, readFragment } from './graphql';

export const PokemonFields = graphql(`
  fragment pokemonFields on Pokemon {
    id
    name
    attacks {
      fast {
        damage
        name
      }
    }
  }
`)

export const Pokemon = (data: FragmentOf<typeof PokemonFields>) => {
  const pokemon = readFragment(PokemonFields, data);
  return `hi ${pokemon.name}`;
};
