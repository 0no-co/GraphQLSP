import { expect, afterAll, beforeAll, it, describe } from 'vitest';
import { TSServer } from './server';
import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';
import ts from 'typescript/lib/tsserverlibrary';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const projectPath = path.resolve(__dirname, 'fixture-project-tada');
describe('Fragment + operations', () => {
  const outfileCombo = path.join(projectPath, 'simple.ts');
  const outfileUnusedFragment = path.join(projectPath, 'unused-fragment.ts');
  const outfileCombinations = path.join(projectPath, 'fragment.ts');

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

    server.sendCommand('updateOpen', {
      openFiles: [
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
    } catch {}
  });

  it('gives semantic-diagnostics with preceding fragments', async () => {
    await server.waitForResponse(
      e => e.type === 'event' && e.event === 'semanticDiag'
    );
    const res = server.responses.filter(
      resp =>
        resp.type === 'event' &&
        resp.event === 'semanticDiag' &&
        resp.body?.file === outfileCombo
    );
    expect(res[0].body.diagnostics).toMatchInlineSnapshot(`
      [
        {
          "category": "warning",
          "code": 52004,
          "end": {
            "line": 12,
            "offset": 1,
          },
          "start": {
            "line": 11,
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
    expect(res?.body.documentation).toEqual(`Pokemon.name: String!`);
  }, 30000);

  it('gives quick-info with documents', async () => {
    server.send({
      seq: 9,
      type: 'request',
      command: 'quickinfo',
      arguments: {
        file: outfileCombo,
        line: 7,
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
    expect(res?.body.documentation).toEqual(
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
      ]
    `);
  }, 30000);

  it('gives semantic-diagnostics with unused fragments', async () => {
    server.sendCommand('saveto', {
      file: outfileUnusedFragment,
      tmpfile: outfileUnusedFragment,
    } satisfies ts.server.protocol.SavetoRequestArgs);

    await server.waitForResponse(
      e =>
        e.type === 'event' &&
        e.event === 'semanticDiag' &&
        e.body?.file === outfileUnusedFragment
    );

    const res = server.responses.filter(
      resp =>
        resp.type === 'event' &&
        resp.event === 'semanticDiag' &&
        resp.body?.file === outfileUnusedFragment
    );
    expect(res[0].body.diagnostics).toMatchInlineSnapshot(`
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
          "text": "Unused co-located fragment definition(s) \\"pokemonFields\\" in './fragment'",
        },
      ]
    `);
  }, 30000);
});
