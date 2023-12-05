import { gql, createClient } from '@urql/core';
import { Pokemon, PokemonFields, WeakFields } from './Pokemon';

const PokemonQuery = gql`
  query Po($id: ID!) {
    pokemon(id: $id) {
      id
      fleeRate
      __typename
    }
  }
` as typeof import('./index.generated').PoDocument;

client
  .query(PokemonQuery, { id: '' })
  .toPromise()
  .then(result => {
    result.data?.pokemons;
  });
