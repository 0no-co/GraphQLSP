import { graphql } from './graphql';

// prettier-ignore
const misspelledField = graphql(`
  query Pok {
    pokemons {
      id
      nam
    }
  }
`);

// prettier-ignore
const misspelledTopLevelField = graphql(`
  query Pok {
    pokemo {
      id
    }
  }
`);

console.log(misspelledField, misspelledTopLevelField);
