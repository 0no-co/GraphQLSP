import { graphql } from './graphql';

const userFragment = graphql(`
  fragment PokemonFragment on Pokemon {
    id
    name
  }
`);

// This mutation correctly includes the fragment as a dep
const FirstMutation = graphql(
  `
    mutation FirstMutation {
      pokemons(limit: 1) {
        ...PokemonFragment
      }
    }
  `,
  [userFragment]
);

// This mutation uses the fragment but DOES NOT include it as a dep
// It should show an error, but currently doesn't because the fragment
// was already added as a dep in FirstMutation above
const SecondMutation = graphql(`
  mutation SecondMutation {
    pokemons(limit: 2) {
      ...PokemonFragment
    }
  }
`);

export { FirstMutation, SecondMutation };
