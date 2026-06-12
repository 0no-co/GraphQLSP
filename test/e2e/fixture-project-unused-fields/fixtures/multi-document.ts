import { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { useQuery } from 'urql';
import { graphql } from './gql';

const PokemonQuery = graphql(`
  query Po($id: ID!) {
    pokemon(id: $id) {
      id
      fleeRate
      ...pokemonFields
      attacks {
        special {
          name
          damage
        }
      }
      weight {
        minimum
        maximum
      }
      name
      __typename
    }
  }
`);

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

export const PokemonFields = graphql(`
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
`);

const toRow = (p: any) => p?.maxCP;

export const AliasChains = () => {
  const [result] = useQuery({
    query: PokemonQuery,
    variables: { id: '' },
  });

  const pokemon = result.data?.pokemon;
  const weight = pokemon?.weight;
  console.log(weight?.minimum);

  return null;
};

export const NamedCallback = () => {
  const [result] = useQuery({
    query: PokemonsQuery,
  });

  const rows = result.data?.pokemons?.filter((p: any) => !!p?.name).map(toRow);
  return rows;
};

export const Escape = (data: any) => {
  const poke = useFragment(PokemonFields, data);
  const obj = { list: poke };
  return obj;
};

const ChainArgQuery = graphql(`
  query ChainArg {
    pokemons {
      maxCP
      maxHP
    }
  }
`);

const formatPokemons = (pokemons: any) => pokemons;

export const ChainArg = () => {
  const [result] = useQuery({ query: ChainArgQuery });
  formatPokemons(result.data?.pokemons);
  return null;
};

const ForOfQuery = graphql(`
  query ForOf {
    pokemons {
      maxCP
      maxHP
      fleeRate
    }
  }
`);

export const ForOf = () => {
  const [result] = useQuery({ query: ForOfQuery });
  for (const p of result.data?.pokemons ?? []) {
    console.log(p?.maxCP);
  }
  return null;
};

const AssignmentQuery = graphql(`
  query Assignment {
    pokemons {
      maxCP
      maxHP
      fleeRate
    }
  }
`);

export const Assignment = (flag: boolean) => {
  const [result] = useQuery({ query: AssignmentQuery });

  let pokemons;
  pokemons = result.data?.pokemons;
  console.log(pokemons?.[0]?.maxCP);

  const first = flag ? result.data?.pokemons?.[0] : null;
  console.log(first?.maxHP);

  return null;
};

export function useFragment<Type>(
  _fragment: TypedDocumentNode<Type>,
  data: any
): Type {
  return data;
}
