import { createClient } from '@urql/core';
import { graphql } from './gql';

const x = graphql(`
  query Pok($limit: Int!) {
    pokemons(limit: $limit) @populate {
      id
      name
      fleeRate
      classification
      ...pokemonFields
      ...weaknessFields
      __typename
    }
  }
`)

const client = createClient({
  url: '',
});

const PokemonQuery = graphql(`
  query Po($id: ID!) {
    pokemon(id: $id) {
      id
      fleeRate
      __typename
    }
  }
`);

client
  .query(PokemonQuery, { id: '' })
  .toPromise()
  .then(result => {
    result.data?.pokemon;
  });

const myQuery = graphql(`
  query PokemonsAreAwesome {
    pokemons {
      id
    }
  }
`);
