import { PokemonFields, WeakFields } from './Pokemon';

const x = /* GraphQL */ `
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
`;

const PokemonQuery = /* GraphQL */ `
  query Po($id: ID!) {
    pokemon(id: $id) {
      id
      fleeRate
      __typename
    }
  }
`;
