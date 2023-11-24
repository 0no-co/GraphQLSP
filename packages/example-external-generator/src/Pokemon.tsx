import { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { graphql } from './gql';

export const PokemonFields = graphql(`
  fragment pokemonFields on Pokemon {
    id
    nam
    attacks {
      fast {
        damage
        name
      }
    }
  }
`)

export const WeakFields = graphql(`
  fragment weaknessFields on Pokemon {
    weaknesses
  }
`)

export const Pokemon = (data: any) => {
  const pokemon = useFragment(PokemonFields, data);
  return `hi ${pokemon.name}`;
};

type X = { hello: string };

const x: X = { hello: '' };

export function useFragment<Type>(
  _fragment: TypedDocumentNode<Type>,
  data: any
): Type {
  return data;
}
