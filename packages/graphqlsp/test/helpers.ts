import {
  createDefaultMapFromNodeModules,
  createVirtualTypeScriptEnvironment,
  createFSBackedSystem,
} from '@typescript/vfs';
import ts, { ModuleResolutionKind, ScriptTarget } from 'typescript';
import { buildSchema } from 'graphql';
import path from 'path';
import { readFileSync } from 'fs';

import { init } from '../src/ts';

init({ typescript: ts });

const rawSchema = readFileSync(path.join(__dirname, 'schema.graphql'), 'utf-8');
const schema = buildSchema(rawSchema);
export const schemaRef = {
  current: { schema, introspection: {} as any },
} as any;

export const createInfo = (
  contents: string,
  additionalFiles?: Array<{ filename: string; contents: string }>
): ts.server.PluginCreateInfo => {
  const fsMap = createDefaultMapFromNodeModules({
    target: ts.ScriptTarget.ES2015,
  });
  fsMap.set('/introspection.d.ts', iNTROSPECTION);
  fsMap.set('/graphql.ts', GQL);
  fsMap.set('index.ts', contents);
  additionalFiles?.forEach(({ filename, contents }) =>
    fsMap.set(filename, contents)
  );

  const compilerOpts: ts.CompilerOptions = {
    target: ScriptTarget.ES2016,
    esModuleInterop: true,
    moduleResolution: ModuleResolutionKind.Bundler,
    forceConsistentCasingInFileNames: true,
    strict: true,
    skipLibCheck: true,
  };

  const projectRoot = path.join(__dirname, '..');
  const system = createFSBackedSystem(fsMap, projectRoot, ts);

  const env = createVirtualTypeScriptEnvironment(
    system,
    ['index.ts'],
    ts,
    compilerOpts
  );

  return {
    ...env,
    config: {},
  } as any;
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
