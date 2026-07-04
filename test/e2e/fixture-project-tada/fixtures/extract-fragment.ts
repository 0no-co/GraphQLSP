import { graphql } from './graphql';

// prettier-ignore
const existingFields = graphql(`
  fragment PokemonFields on Pokemon {
    maxCP
    maxHP
  }
`);

// prettier-ignore
const pokemonsQuery = graphql(`
  query Pokemons($limit: Int!) {
    pokemons(limit: $limit) {
      id
      name
      fleeRate
      attacks {
        fast {
          name
          damage
        }
      }
      __typename
      ...PokemonFields
    }
  }
`, [existingFields]);

// prettier-ignore
const pokemonQuery = graphql(`
  query Pokemon($id: ID!) {
    pokemon(id: $id) {
      id
      name
      evolutions {
        id
        name
      }
    }
  }
`);

console.log(existingFields, pokemonsQuery, pokemonQuery);
