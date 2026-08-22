import { graphql } from './graphql';

// prettier-ignore
const deprecatedFields = graphql(`
  query Pok {
    pokemons {
      id
      nickname
      level
      fleeRate
    }
  }
`);

console.log(deprecatedFields);
