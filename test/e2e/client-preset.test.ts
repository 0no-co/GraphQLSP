import { expect, afterAll, beforeAll, it, describe } from 'vitest';
import { TSServer } from './server';
import { pollDiagnostics } from './util';
import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';
import ts from 'typescript/lib/tsserverlibrary';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const projectPath = path.resolve(__dirname, 'fixture-project-client-preset');
describe('Fragment + operations', () => {
  const outfileCombo = path.join(projectPath, 'simple.ts');
  const outfileUnusedFragment = path.join(projectPath, 'unused-fragment.ts');
  const outfileCombinations = path.join(projectPath, 'fragment.ts');
  const outfileGql = path.join(projectPath, 'gql', 'gql.ts');
  const outfileGraphql = path.join(projectPath, 'gql', 'graphql.ts');

  let server: TSServer;
  beforeAll(async () => {
    server = new TSServer(projectPath, { debugLog: false });

    server.sendCommand('open', {
      file: outfileCombo,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);
    server.sendCommand('open', {
      file: outfileCombinations,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);
    server.sendCommand('open', {
      file: outfileUnusedFragment,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);
    server.sendCommand('open', {
      file: outfileGql,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);
    server.sendCommand('open', {
      file: outfileGraphql,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);

    server.sendCommand('updateOpen', {
      openFiles: [
        {
          file: outfileGraphql,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/gql/graphql.ts'),
            'utf-8'
          ),
        },
        {
          file: outfileGql,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/gql/gql.ts'),
            'utf-8'
          ),
        },
        {
          file: outfileCombinations,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/fragment.ts'),
            'utf-8'
          ),
        },
        {
          file: outfileCombo,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/simple.ts'),
            'utf-8'
          ),
        },
        {
          file: outfileUnusedFragment,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/unused-fragment.ts'),
            'utf-8'
          ),
        },
      ],
    } satisfies ts.server.protocol.UpdateOpenRequestArgs);

    server.sendCommand('saveto', {
      file: outfileGraphql,
      tmpfile: outfileGraphql,
    } satisfies ts.server.protocol.SavetoRequestArgs);
    server.sendCommand('saveto', {
      file: outfileGql,
      tmpfile: outfileGql,
    } satisfies ts.server.protocol.SavetoRequestArgs);
    server.sendCommand('saveto', {
      file: outfileCombo,
      tmpfile: outfileCombo,
    } satisfies ts.server.protocol.SavetoRequestArgs);
    server.sendCommand('saveto', {
      file: outfileCombinations,
      tmpfile: outfileCombinations,
    } satisfies ts.server.protocol.SavetoRequestArgs);
    server.sendCommand('saveto', {
      file: outfileUnusedFragment,
      tmpfile: outfileUnusedFragment,
    } satisfies ts.server.protocol.SavetoRequestArgs);
  });

  afterAll(() => {
    try {
      fs.unlinkSync(outfileUnusedFragment);
      fs.unlinkSync(outfileCombinations);
      fs.unlinkSync(outfileCombo);
      fs.unlinkSync(outfileGql);
      fs.unlinkSync(outfileGraphql);
    } catch {}
  });

  it('gives semantic-diagnostics with preceding fragments', async () => {
    const diagnostics = await pollDiagnostics(server, outfileCombo);
    expect(diagnostics).toMatchInlineSnapshot(`
      [
        {
          "category": "warning",
          "code": 52004,
          "end": {
            "line": 10,
            "offset": 1,
          },
          "start": {
            "line": 9,
            "offset": 7,
          },
          "text": "The field Pokemon.classification is deprecated. And this is the reason why",
        },
      ]
    `);
  }, 30000);

  it('gives quick-info with preceding fragments', async () => {
    server.send({
      seq: 9,
      type: 'request',
      command: 'quickinfo',
      arguments: {
        file: outfileCombinations,
        line: 7,
        offset: 8,
      },
    });

    await server.waitForResponse(
      response =>
        response.type === 'response' && response.command === 'quickinfo'
    );

    const res = server.responses
      .reverse()
      .find(resp => resp.type === 'response' && resp.command === 'quickinfo');

    expect(res).toBeDefined();
    expect(typeof res?.body).toEqual('object');
    expect(res?.body.displayString).toEqual(`Pokemon.name: String!`);
    expect(res?.body.documentation).toEqual('');
  }, 30000);

  it('gives quick-info with documents', async () => {
    server.send({
      seq: 9,
      type: 'request',
      command: 'quickinfo',
      arguments: {
        file: outfileCombo,
        line: 5,
        offset: 10,
      },
    });

    await server.waitForResponse(
      response =>
        response.type === 'response' && response.command === 'quickinfo'
    );

    const res = server.responses
      .reverse()
      .find(resp => resp.type === 'response' && resp.command === 'quickinfo');

    expect(res).toBeDefined();
    expect(typeof res?.body).toEqual('object');
    expect(res?.body.displayString).toEqual(
      `Query.pokemons(limit: Int, skip: Int): [Pokemon]`
    );
    expect(res?.body.documentation).toEqual(
      `List out all Pokémon, optionally in pages`
    );
  }, 30000);

  it('gives suggestions with preceding fragments', async () => {
    server.send({
      seq: 10,
      type: 'request',
      command: 'completionInfo',
      arguments: {
        file: outfileCombinations,
        line: 8,
        offset: 5,
        includeExternalModuleExports: true,
        includeInsertTextCompletions: true,
        triggerKind: 1,
      },
    });

    await server.waitForResponse(
      response =>
        response.type === 'response' && response.command === 'completionInfo'
    );

    const res = server.responses
      .reverse()
      .find(
        resp => resp.type === 'response' && resp.command === 'completionInfo'
      );

    expect(res).toBeDefined();
    expect(typeof res?.body.entries).toEqual('object');
    expect(res?.body.entries).toMatchInlineSnapshot(`
      [
        {
          "deprecated": false,
          "detail": "AttacksConnection",
          "isDeprecated": false,
          "kind": "var",
          "kindModifiers": "declare",
          "label": "attacks",
          "labelDetails": {
            "detail": " AttacksConnection",
          },
          "name": "attacks",
          "sortText": "0attacks",
          "type": "AttacksConnection",
        },
        {
          "deprecated": false,
          "detail": "[EvolutionRequirement]",
          "isDeprecated": false,
          "kind": "var",
          "kindModifiers": "declare",
          "label": "evolutionRequirements",
          "labelDetails": {
            "detail": " [EvolutionRequirement]",
          },
          "name": "evolutionRequirements",
          "sortText": "2evolutionRequirements",
          "type": "[EvolutionRequirement]",
        },
        {
          "deprecated": false,
          "detail": "[Pokemon]",
          "isDeprecated": false,
          "kind": "var",
          "kindModifiers": "declare",
          "label": "evolutions",
          "labelDetails": {
            "detail": " [Pokemon]",
          },
          "name": "evolutions",
          "sortText": "3evolutions",
          "type": "[Pokemon]",
        },
        {
          "deprecated": false,
          "detail": "Float",
          "documentation": "Likelihood of an attempt to catch a Pokémon to fail.",
          "isDeprecated": false,
          "kind": "var",
          "kindModifiers": "declare",
          "label": "fleeRate",
          "labelDetails": {
            "description": "Likelihood of an attempt to catch a Pokémon to fail.",
            "detail": " Float",
          },
          "name": "fleeRate",
          "sortText": "4fleeRate",
          "type": "Float",
        },
        {
          "deprecated": false,
          "detail": "PokemonDimension",
          "isDeprecated": false,
          "kind": "var",
          "kindModifiers": "declare",
          "label": "height",
          "labelDetails": {
            "detail": " PokemonDimension",
          },
          "name": "height",
          "sortText": "5height",
          "type": "PokemonDimension",
        },
        {
          "deprecated": false,
          "detail": "ID!",
          "isDeprecated": false,
          "kind": "var",
          "kindModifiers": "declare",
          "label": "id",
          "labelDetails": {
            "detail": " ID!",
          },
          "name": "id",
          "sortText": "6id",
          "type": "ID!",
        },
        {
          "deprecated": false,
          "detail": "Int",
          "documentation": "Maximum combat power a Pokémon may achieve at max level.",
          "isDeprecated": false,
          "kind": "var",
          "kindModifiers": "declare",
          "label": "maxCP",
          "labelDetails": {
            "description": "Maximum combat power a Pokémon may achieve at max level.",
            "detail": " Int",
          },
          "name": "maxCP",
          "sortText": "7maxCP",
          "type": "Int",
        },
        {
          "deprecated": false,
          "detail": "Int",
          "documentation": "Maximum health points a Pokémon may achieve at max level.",
          "isDeprecated": false,
          "kind": "var",
          "kindModifiers": "declare",
          "label": "maxHP",
          "labelDetails": {
            "description": "Maximum health points a Pokémon may achieve at max level.",
            "detail": " Int",
          },
          "name": "maxHP",
          "sortText": "8maxHP",
          "type": "Int",
        },
        {
          "deprecated": false,
          "detail": "String!",
          "isDeprecated": false,
          "kind": "var",
          "kindModifiers": "declare",
          "label": "name",
          "labelDetails": {
            "detail": " String!",
          },
          "name": "name",
          "sortText": "9name",
          "type": "String!",
        },
        {
          "deprecated": false,
          "detail": "[PokemonType]",
          "isDeprecated": false,
          "kind": "var",
          "kindModifiers": "declare",
          "label": "resistant",
          "labelDetails": {
            "detail": " [PokemonType]",
          },
          "name": "resistant",
          "sortText": "10resistant",
          "type": "[PokemonType]",
        },
        {
          "deprecated": false,
          "detail": "[PokemonType]",
          "isDeprecated": false,
          "kind": "var",
          "kindModifiers": "declare",
          "label": "types",
          "labelDetails": {
            "detail": " [PokemonType]",
          },
          "name": "types",
          "sortText": "11types",
          "type": "[PokemonType]",
        },
        {
          "deprecated": false,
          "detail": "[PokemonType]",
          "isDeprecated": false,
          "kind": "var",
          "kindModifiers": "declare",
          "label": "weaknesses",
          "labelDetails": {
            "detail": " [PokemonType]",
          },
          "name": "weaknesses",
          "sortText": "12weaknesses",
          "type": "[PokemonType]",
        },
        {
          "deprecated": false,
          "detail": "PokemonDimension",
          "isDeprecated": false,
          "kind": "var",
          "kindModifiers": "declare",
          "label": "weight",
          "labelDetails": {
            "detail": " PokemonDimension",
          },
          "name": "weight",
          "sortText": "13weight",
          "type": "PokemonDimension",
        },
        {
          "deprecated": false,
          "detail": "String!",
          "documentation": "The name of the current Object type at runtime.",
          "isDeprecated": false,
          "kind": "var",
          "kindModifiers": "declare",
          "label": "__typename",
          "labelDetails": {
            "description": "The name of the current Object type at runtime.",
            "detail": " String!",
          },
          "name": "__typename",
          "sortText": "14__typename",
          "type": "String!",
        },
      ]
    `);
  }, 30000);

  it('gives semantic-diagnostics with unused fragments', async () => {
    server.sendCommand('saveto', {
      file: outfileUnusedFragment,
      tmpfile: outfileUnusedFragment,
    } satisfies ts.server.protocol.SavetoRequestArgs);

    const diagnostics = await pollDiagnostics(server, outfileUnusedFragment);
    expect(diagnostics).toMatchInlineSnapshot(`
      [
        {
          "category": "warning",
          "code": 52003,
          "end": {
            "line": 2,
            "offset": 37,
          },
          "start": {
            "line": 2,
            "offset": 25,
          },
          "text": "Unused co-located fragment definition(s) "pokemonFields" in './fragment'",
        },
      ]
    `);
  }, 30000);
});
