import { FragmentOf, graphql, readFragment } from './graphql';

export const PokemonFields = graphql(`
  fragment pokemonFields on Pokemon {
    name
    weight { 
      minimum
    }
  }
`);

interface Props {
  data: FragmentOf<typeof PokemonFields> | null;
}

const PokemonItem = ({ data }: Props) => {
  const pokemon = readFragment(PokemonFields, data);
  if (!pokemon) {
    return null;
  }

  return (
    <li>
      {pokemon.name}
    </li>
  );
};

export { PokemonItem };