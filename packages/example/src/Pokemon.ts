import { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { createClient, gql } from '@urql/core';

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

export const WeakFields = gql`
  fragment weaknessFields on Pokemon {
    weaknesses
  }
` as typeof import('./Pokemon.generated').WeaknessFieldsFragmentDoc;

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
