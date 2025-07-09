import { useQuery } from 'urql';
import { graphql } from './gql';
// @ts-expect-error
import { Pokemon } from './fragment';
import * as React from 'react';

const PokemonQuery = graphql(`
  query Po($id: ID!) {
    pokemon(id: $id) {
      id
      fleeRate
      ...pokemonFields
      attacks {
        special {
          name
          damage
        }
      }
      weight {
        minimum
        maximum
      }
      name
      __typename
    }
  }
`);

const Pokemons = () => {
  const [result] = useQuery({
    query: PokemonQuery,
    variables: { id: '' }
  });
  
  // Works
  const { fleeRate } = result.data?.pokemon || {};
  console.log(fleeRate)
  // @ts-expect-error
  const { pokemon: { weight: { minimum } } } = result.data || {};
  console.log(minimum)

  // Works
  const { pokemon } = result.data || {};
  console.log(pokemon?.weight?.maximum)

  // @ts-expect-error
  return <Pokemon data={result.data?.pokemon} />;
}

