"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@urql/core");
const query = (0, core_1.gql) `
  query {
    pokemons {
      id
    }
  }
`;
