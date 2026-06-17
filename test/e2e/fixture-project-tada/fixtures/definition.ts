import { graphql, ResultOf } from './graphql';

const PokemonQuery = graphql(`
  query DefinitionQuery($id: ID!) {
    pokemon(id: $id) {
      id
      name
      weight {
        minimum
        maximum
      }
    }
  }
`);

declare const data: ResultOf<typeof PokemonQuery>;

data.pokemon?.name;
