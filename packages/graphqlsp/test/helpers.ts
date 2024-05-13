import {
  createDefaultMapFromNodeModules,
  createSystem,
  createVirtualTypeScriptEnvironment,
} from '@typescript/vfs';
import ts from 'typescript';

export const createProgram = () => {
  const fsMap = createDefaultMapFromNodeModules({
    target: ts.ScriptTarget.ES2015,
  });
  const system = createSystem(fsMap);
  fsMap.set('index.ts', `placeholder`);

  const compilerOpts: ts.CompilerOptions = {
    plugins: [
      {
        name: '@0no-co/graphqlsp',
        schema: 'schema.graphql',
      },
    ],
  };

  const env = createVirtualTypeScriptEnvironment(
    system,
    ['index.ts'],
    ts,
    compilerOpts
  );
  env.createFile('graphql.ts', GQL);
  env.createFile('introspection.d.ts', iNTROSPECTION);
  return env;
};

const iNTROSPECTION = `export type introspection = {
  name: 'pokemons';
  query: 'Query';
  mutation: never;
  subscription: never;
  types: {
    'Attack': { kind: 'OBJECT'; name: 'Attack'; fields: { 'damage': { name: 'damage'; type: { kind: 'SCALAR'; name: 'Int'; ofType: null; } }; 'name': { name: 'name'; type: { kind: 'SCALAR'; name: 'String'; ofType: null; } }; 'type': { name: 'type'; type: { kind: 'ENUM'; name: 'PokemonType'; ofType: null; } }; }; };
    'AttacksConnection': { kind: 'OBJECT'; name: 'AttacksConnection'; fields: { 'fast': { name: 'fast'; type: { kind: 'LIST'; name: never; ofType: { kind: 'OBJECT'; name: 'Attack'; ofType: null; }; } }; 'special': { name: 'special'; type: { kind: 'LIST'; name: never; ofType: { kind: 'OBJECT'; name: 'Attack'; ofType: null; }; } }; }; };
    'Boolean': unknown;
    'EvolutionRequirement': { kind: 'OBJECT'; name: 'EvolutionRequirement'; fields: { 'amount': { name: 'amount'; type: { kind: 'SCALAR'; name: 'Int'; ofType: null; } }; 'name': { name: 'name'; type: { kind: 'SCALAR'; name: 'String'; ofType: null; } }; }; };
    'Float': unknown;
    'ID': unknown;
    'Int': unknown;
    'Pokemon': { kind: 'OBJECT'; name: 'Pokemon'; fields: { 'attacks': { name: 'attacks'; type: { kind: 'OBJECT'; name: 'AttacksConnection'; ofType: null; } }; 'classification': { name: 'classification'; type: { kind: 'SCALAR'; name: 'String'; ofType: null; } }; 'evolutionRequirements': { name: 'evolutionRequirements'; type: { kind: 'LIST'; name: never; ofType: { kind: 'OBJECT'; name: 'EvolutionRequirement'; ofType: null; }; } }; 'evolutions': { name: 'evolutions'; type: { kind: 'LIST'; name: never; ofType: { kind: 'OBJECT'; name: 'Pokemon'; ofType: null; }; } }; 'fleeRate': { name: 'fleeRate'; type: { kind: 'SCALAR'; name: 'Float'; ofType: null; } }; 'height': { name: 'height'; type: { kind: 'OBJECT'; name: 'PokemonDimension'; ofType: null; } }; 'id': { name: 'id'; type: { kind: 'NON_NULL'; name: never; ofType: { kind: 'SCALAR'; name: 'ID'; ofType: null; }; } }; 'maxCP': { name: 'maxCP'; type: { kind: 'SCALAR'; name: 'Int'; ofType: null; } }; 'maxHP': { name: 'maxHP'; type: { kind: 'SCALAR'; name: 'Int'; ofType: null; } }; 'name': { name: 'name'; type: { kind: 'NON_NULL'; name: never; ofType: { kind: 'SCALAR'; name: 'String'; ofType: null; }; } }; 'resistant': { name: 'resistant'; type: { kind: 'LIST'; name: never; ofType: { kind: 'ENUM'; name: 'PokemonType'; ofType: null; }; } }; 'types': { name: 'types'; type: { kind: 'LIST'; name: never; ofType: { kind: 'ENUM'; name: 'PokemonType'; ofType: null; }; } }; 'weaknesses': { name: 'weaknesses'; type: { kind: 'LIST'; name: never; ofType: { kind: 'ENUM'; name: 'PokemonType'; ofType: null; }; } }; 'weight': { name: 'weight'; type: { kind: 'OBJECT'; name: 'PokemonDimension'; ofType: null; } }; }; };
    'PokemonDimension': { kind: 'OBJECT'; name: 'PokemonDimension'; fields: { 'maximum': { name: 'maximum'; type: { kind: 'SCALAR'; name: 'String'; ofType: null; } }; 'minimum': { name: 'minimum'; type: { kind: 'SCALAR'; name: 'String'; ofType: null; } }; }; };
    'PokemonType': { name: 'PokemonType'; enumValues: 'Bug' | 'Dark' | 'Dragon' | 'Electric' | 'Fairy' | 'Fighting' | 'Fire' | 'Flying' | 'Ghost' | 'Grass' | 'Ground' | 'Ice' | 'Normal' | 'Poison' | 'Psychic' | 'Rock' | 'Steel' | 'Water'; };
    'Query': { kind: 'OBJECT'; name: 'Query'; fields: { 'pokemon': { name: 'pokemon'; type: { kind: 'OBJECT'; name: 'Pokemon'; ofType: null; } }; 'pokemons': { name: 'pokemons'; type: { kind: 'LIST'; name: never; ofType: { kind: 'OBJECT'; name: 'Pokemon'; ofType: null; }; } }; }; };
    'String': unknown;
  };
};

import * as gqlTada from 'gql.tada';`;

const GQL = `import { initGraphQLTada } from 'gql.tada';
import type { introspection } from './introspection.d.ts';

export const graphql = initGraphQLTada<{
  introspection: introspection;
}>();

export type { FragmentOf, ResultOf, VariablesOf } from 'gql.tada';
export { readFragment } from 'gql.tada';`;
