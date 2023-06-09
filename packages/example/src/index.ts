import { gql, createClient } from '@urql/core';
import { Pokemon, PokemonFields } from './Pokemon';

const PokemonsQuery = gql`
  query Pok {
    pokemons {
      id
      name
      __typename
      fleeRate
    }
  }
` as typeof import('./index.generated').PokDocument;

const client = createClient({
  url: '',
});

client
  .query(PokemonsQuery, {})
  .toPromise()
  .then(result => {
    result.data?.pokemons;
  });

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
    result.data?.pokemon;
  });
