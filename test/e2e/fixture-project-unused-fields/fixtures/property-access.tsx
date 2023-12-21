import { createClient, useQuery } from 'urql';
import { graphql } from './gql';
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
  
  const pokemon = result.data?.pokemon
  console.log(result.data?.pokemon?.attacks && result.data?.pokemon?.attacks.special && result.data?.pokemon?.attacks.special[0] && result.data?.pokemon?.attacks.special[0].name)
  console.log(pokemon?.name)

  return <Pokemon data={result.data?.pokemon} />;
}

