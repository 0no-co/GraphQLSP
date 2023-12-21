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
  // @ts-expect-error
  const [{ data: { pokemon: { fleeRate, weight: { minimum, maximum } } } }] = useQuery({
    query: PokemonQuery,
    variables: { id: '' }
  });

  // @ts-expect-error
  return <Pokemon data={{ fleeRate, weight: { minimum, maximum } }} />;
}

