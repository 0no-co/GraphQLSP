import type { TadaDocumentNode } from 'gql.tada';
import { graphql } from './graphql.js';

declare function useQuery<Data, Variables>(args: {
  query: TadaDocumentNode<Data, Variables>;
  variables: Variables;
}): [{ data?: Data }];

const PokemonQuery = graphql(`
  query PokemonUsage($id: ID!) {
    pokemon(id: $id) {
      id
      name
      fleeRate
      weight {
        minimum
        maximum
      }
    }
  }
`);

export function logPokemon() {
  const [result] = useQuery({ query: PokemonQuery, variables: { id: '1' } });
  const pokemon = result.data?.pokemon;
  console.log(pokemon?.name, pokemon?.weight?.minimum);
}
