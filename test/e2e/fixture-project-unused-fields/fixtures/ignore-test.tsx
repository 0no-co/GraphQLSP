import * as React from 'react';
import { useQuery } from 'urql';
import { graphql } from './gql';

// @gql-tada-ignore-unused
const PokemonQuery = graphql(`
  query Po($id: ID!) {
    pokemon(id: $id) {
      id
      name
      fleeRate
      __typename
    }
  }
`);

const Pokemons = () => {
  const [result] = useQuery({
    query: PokemonQuery,
    variables: { id: '' }
  });
  
  // Works - we use fleeRate
  const { fleeRate } = result.data?.pokemon || {};
  console.log(fleeRate);
  
  // We intentionally pass the whole object, so we mark the query as used
  // even though id and name aren't directly accessed in this file
  return <div data-pokemon={result.data?.pokemon} />;
};