import { gql, createClient } from '@urql/core';
import { Pokemon, PokemonFields, WeakFields } from './Pokemon';

const x = gql`
  query Pok($limit: Int!) {
    pokemons(limit: $limit) {
      id
      name
      fleeRate
      classification
      ...pokemonFields
      ...weaknessFields
      __typename
    }
  }

  ${PokemonFields}
  ${WeakFields}
` as typeof import('./index.generated').PokDocument;

const client = createClient({
  url: '',
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
    result.data?.pokemons;
  });

const myQuery = gql`
  query PokemonsAreAwesome {
    pokemons {
      id
    }
  }
`;
