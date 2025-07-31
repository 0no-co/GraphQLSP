import { useQuery } from 'urql';
import { useMemo } from 'react';
import { graphql } from './gql';

const PokemonsQuery = graphql(
  `
    query Pok {
      pokemons {
        name
        maxCP
        maxHP
        fleeRate
      }
    }
  `
);

const Pokemons = () => {
  const [result] = useQuery({
    query: PokemonsQuery,
  });

  const results = useMemo(() => {
    if (!result.data?.pokemons) return [];
    return (
      result.data.pokemons
        .filter(i => i?.name === 'Pikachu')
        .map(p => ({
          x: p?.maxCP,
          y: p?.maxHP,
        })) ?? []
    );
  }, [result.data?.pokemons]);

  // @ts-ignore
  return results;
};
