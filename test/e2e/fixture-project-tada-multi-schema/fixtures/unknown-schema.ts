// A handwritten stand-in for a gql.tada graphql() function whose
// introspection carries a schema name that isn't configured
type UnknownSchemaTada = {
  (document: string): unknown;
  scalar: unknown;
  persisted: unknown;
  __name: 'unknown';
};
declare const graphql: UnknownSchemaTada;

// prettier-ignore
const x = graphql(`
  query Pokemons {
    pokemons {
      id
    }
  }
`);
