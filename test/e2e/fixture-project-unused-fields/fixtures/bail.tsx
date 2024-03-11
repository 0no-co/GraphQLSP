import * as React from 'react';
import { useQuery } from 'urql';
import { graphql } from './gql';
// @ts-expect-error
import { Pokemon } from './fragment';

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
  
  const pokemon = React.useMemo(() => result.data?.pokemon, [])

  // @ts-expect-error
  return <Pokemon data={result.data?.pokemon} />;
}

