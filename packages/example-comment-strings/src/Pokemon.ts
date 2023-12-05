export const PokemonFields = /* GraphQL */ `
  fragment pokemonFields on Pokemon {
    id
    name
    attacks {
      fast {
        damage
        name
      }
    }
  }
`;

export const WeakFields = /* GraphQL */ `
  fragment weaknessFields on Pokemon {
    weaknesses
  }
`;
