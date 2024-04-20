import { FragmentOf, graphql, readFragment } from './graphql';

export const Fields = { Pokemon: graphql(`
  fragment Pok on Pokemon {
    resistant
    types
  }`)
}

export const PokemonFields = graphql(/* GraphQL */`
  fragment pokemonFields on Pokemon {
    name
    weight { 
      minimum
    }
  }
`);

interface Props {
  data: (FragmentOf<typeof PokemonFields> & FragmentOf<typeof Fields.Pokemon>) | null;
}

export const Pokemon = ({ data }: Props) => {
  const pokemon = readFragment(PokemonFields, data);
  const resistant = readFragment(Fields.Pokemon, data);
  if (!pokemon || !resistant) {
    return null;
  }

  return (
    <li>
      {pokemon.name}
      {resistant.resistant}
    </li>
  );
};
