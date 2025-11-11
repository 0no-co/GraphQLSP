import { graphql } from './graphql';

const pokemonFragment = graphql(`
  fragment PokemonBasicInfo on Pokemon {
    id
    name
  }
`);

// This query correctly includes the fragment as a dep
const FirstQuery = graphql(
  `
    query FirstQuery {
      pokemons(limit: 1) {
        ...PokemonBasicInfo
      }
    }
  `,
  [pokemonFragment]
);

// This query uses the fragment but DOES NOT include it as a dep
// It should show an error, but currently doesn't because the fragment
// was already added as a dep in FirstQuery above
const SecondQuery = graphql(`
  query SecondQuery {
    pokemons(limit: 2) {
      ...PokemonBasicInfo
    }
  }
`);

export { FirstQuery, SecondQuery };
