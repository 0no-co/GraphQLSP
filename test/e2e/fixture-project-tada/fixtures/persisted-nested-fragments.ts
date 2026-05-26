import { graphql } from './graphql';

// Fragments registered under a nested object on a component
// (`Component.fragments.<name>`). The persisted hash must reflect the
// fragment text — earlier versions of `unrollTadaFragments` resolved
// the wrong identifier in this two-level access chain and silently
// omitted the fragment from the hash input.
function Attacks() {}
Attacks.fragments = {
  fast: graphql(`
    fragment PokemonAttacks on Pokemon {
      attacks {
        fast {
          name
          damage
        }
      }
    }
  `),
};

const Query = graphql(
  `
    query GetPokemonNested {
      pokemon(id: "x") {
        ...PokemonAttacks
      }
    }
  `,
  [Attacks.fragments.fast]
);

graphql.persisted('sha256:incorrect', Query);
