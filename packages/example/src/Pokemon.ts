import { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { gql } from '@urql/core';

export const PokemonFields = gql`
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
` as typeof import('./Pokemon.generated').PokemonFieldsFragmentDoc;

export const Pokemon = (data: any) => {
  const pokemon = useFragment(PokemonFields, data);
  return `hi ${pokemon.name}`;
};

export function useFragment<Type>(
  _fragment: TypedDocumentNode<Type>,
  data: any
): Type {
  return data;
}
