import { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { graphql } from './gql';

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

export const Pokemon = (data: any) => {
  const { name } = useFragment(PokemonFields, data);
  return `hi ${name}`;
};

export function useFragment<Type>(
  _fragment: TypedDocumentNode<Type>,
  data: any
): Type {
  return data;
}
