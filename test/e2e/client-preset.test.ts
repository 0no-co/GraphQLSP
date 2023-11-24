import { expect, afterAll, beforeAll, it, describe } from 'vitest';
import { TSServer } from './server';
import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';
import ts from 'typescript/lib/tsserverlibrary';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const projectPath = path.resolve(__dirname, 'fixture-project-client-preset');
describe('Fragment + operations', () => {
  const outfileCombo = path.join(projectPath, 'simple.ts');
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
  });

  afterAll(() => {
    try {
      fs.unlinkSync(outfileCombinations);
      fs.unlinkSync(outfileCombo);
      fs.unlinkSync(outfileGql);
      fs.unlinkSync(outfileGraphql);
    } catch {}
  });

  it('gives semantic-diagnostics with preceding fragments', async () => {
    await server.waitForResponse(
      e => e.type === 'event' && e.event === 'semanticDiag'
    );
    const res = server.responses.filter(
      resp => resp.type === 'event' && resp.event === 'semanticDiag'
    );
    expect(res[0].body.diagnostics).toMatchInlineSnapshot(`
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
        line: 6,
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
      `Query.pokemons: [Pokemon]

List out all Pokémon, optionally in pages`
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
          "kind": "var",
          "kindModifiers": "declare",
          "labelDetails": {
            "detail": " AttacksConnection",
          },
          "name": "attacks",
          "sortText": "0attacks",
        },
        {
          "kind": "var",
          "kindModifiers": "declare",
          "labelDetails": {
            "detail": " [EvolutionRequirement]",
          },
          "name": "evolutionRequirements",
          "sortText": "2evolutionRequirements",
        },
        {
          "kind": "var",
          "kindModifiers": "declare",
          "labelDetails": {
            "detail": " [Pokemon]",
          },
          "name": "evolutions",
          "sortText": "3evolutions",
        },
        {
          "kind": "var",
          "kindModifiers": "declare",
          "labelDetails": {
            "description": "Likelihood of an attempt to catch a Pokémon to fail.",
            "detail": " Float",
          },
          "name": "fleeRate",
          "sortText": "4fleeRate",
        },
        {
          "kind": "var",
          "kindModifiers": "declare",
          "labelDetails": {
            "detail": " PokemonDimension",
          },
          "name": "height",
          "sortText": "5height",
        },
        {
          "kind": "var",
          "kindModifiers": "declare",
          "labelDetails": {
            "detail": " ID!",
          },
          "name": "id",
          "sortText": "6id",
        },
        {
          "kind": "var",
          "kindModifiers": "declare",
          "labelDetails": {
            "description": "Maximum combat power a Pokémon may achieve at max level.",
            "detail": " Int",
          },
          "name": "maxCP",
          "sortText": "7maxCP",
        },
        {
          "kind": "var",
          "kindModifiers": "declare",
          "labelDetails": {
            "description": "Maximum health points a Pokémon may achieve at max level.",
            "detail": " Int",
          },
          "name": "maxHP",
          "sortText": "8maxHP",
        },
        {
          "kind": "var",
          "kindModifiers": "declare",
          "labelDetails": {
            "detail": " String!",
          },
          "name": "name",
          "sortText": "9name",
        },
        {
          "kind": "var",
          "kindModifiers": "declare",
          "labelDetails": {
            "detail": " [PokemonType]",
          },
          "name": "resistant",
          "sortText": "10resistant",
        },
        {
          "kind": "var",
          "kindModifiers": "declare",
          "labelDetails": {
            "detail": " [PokemonType]",
          },
          "name": "types",
          "sortText": "11types",
        },
        {
          "kind": "var",
          "kindModifiers": "declare",
          "labelDetails": {
            "detail": " [PokemonType]",
          },
          "name": "weaknesses",
          "sortText": "12weaknesses",
        },
        {
          "kind": "var",
          "kindModifiers": "declare",
          "labelDetails": {
            "detail": " PokemonDimension",
          },
          "name": "weight",
          "sortText": "13weight",
        },
        {
          "kind": "var",
          "kindModifiers": "declare",
          "labelDetails": {
            "description": "The name of the current Object type at runtime.",
            "detail": " String!",
          },
          "name": "__typename",
          "sortText": "14__typename",
        },
        {
          "kind": "string",
          "kindModifiers": "",
          "name": "
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
      ",
          "replacementSpan": {
            "end": {
              "line": 10,
              "offset": 1,
            },
            "start": {
              "line": 3,
              "offset": 39,
            },
          },
          "sortText": "11",
        },
        {
          "kind": "string",
          "kindModifiers": "",
          "name": "
        query Pok($limit: Int!) {
          pokemons(limit: $limit) {
            id
            name
            fleeRate
            classification
            ...pokemonFields
            ...weaknessFields
            __typename
          }
        }
      ",
          "replacementSpan": {
            "end": {
              "line": 10,
              "offset": 1,
            },
            "start": {
              "line": 3,
              "offset": 39,
            },
          },
          "sortText": "11",
        },
      ]
    `);
  }, 30000);
});
