import { expect, afterAll, beforeAll, it, describe } from 'vitest';
import { TSServer } from './server';
import { pollDiagnostics } from './util';
import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';
import ts from 'typescript/lib/tsserverlibrary';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const projectPath = path.resolve(__dirname, 'fixture-project-tada');
describe('Fragment + operations', () => {
  const outfileCombo = path.join(projectPath, 'simple.ts');
  const outfileTypeCondition = path.join(projectPath, 'type-condition.ts');
  const outfileUnusedFragment = path.join(projectPath, 'unused-fragment.ts');
  const outfileUsedFragmentMask = path.join(
    projectPath,
    'used-fragment-mask.ts'
  );
  const outfileUsedFragmentDirect = path.join(
    projectPath,
    'used-fragment-direct.ts'
  );
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
      file: outfileTypeCondition,
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
      file: outfileUsedFragmentMask,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);
    server.sendCommand('open', {
      file: outfileUsedFragmentDirect,
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
          file: outfileTypeCondition,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/type-condition.ts'),
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
        {
          file: outfileUsedFragmentMask,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/used-fragment-mask.ts'),
            'utf-8'
          ),
        },
        {
          file: outfileUsedFragmentDirect,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/used-fragment-direct.ts'),
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
      file: outfileTypeCondition,
      tmpfile: outfileTypeCondition,
    } satisfies ts.server.protocol.SavetoRequestArgs);
    server.sendCommand('saveto', {
      file: outfileCombinations,
      tmpfile: outfileCombinations,
    } satisfies ts.server.protocol.SavetoRequestArgs);
    server.sendCommand('saveto', {
      file: outfileUnusedFragment,
      tmpfile: outfileUnusedFragment,
    } satisfies ts.server.protocol.SavetoRequestArgs);
    server.sendCommand('saveto', {
      file: outfileUsedFragmentMask,
      tmpfile: outfileUsedFragmentMask,
    } satisfies ts.server.protocol.SavetoRequestArgs);
    server.sendCommand('saveto', {
      file: outfileUsedFragmentDirect,
      tmpfile: outfileUsedFragmentDirect,
    } satisfies ts.server.protocol.SavetoRequestArgs);
  });

  afterAll(() => {
    try {
      fs.unlinkSync(outfileUnusedFragment);
      fs.unlinkSync(outfileUsedFragmentMask);
      fs.unlinkSync(outfileUsedFragmentDirect);
      fs.unlinkSync(outfileCombinations);
      fs.unlinkSync(outfileCombo);
      fs.unlinkSync(outfileTypeCondition);
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

  it('should not warn about unused fragments when using maskFragments', async () => {
    server.sendCommand('saveto', {
      file: outfileUsedFragmentMask,
      tmpfile: outfileUsedFragmentMask,
    } satisfies ts.server.protocol.SavetoRequestArgs);

    // A single "geterr" round suffices: the schema is known to be loaded
    // once the preceding tests have seen GraphQL diagnostics
    const diagnostics = await pollDiagnostics(
      server,
      outfileUsedFragmentMask,
      () => true,
      1
    );
    // Should have no diagnostics about unused fragments since maskFragments uses them
    expect(diagnostics).toMatchInlineSnapshot(`[]`);
  }, 30000);

  it('should not warn about unused fragments when the fragment is used directly (not co-located)', async () => {
    server.sendCommand('saveto', {
      file: outfileUsedFragmentDirect,
      tmpfile: outfileUsedFragmentDirect,
    } satisfies ts.server.protocol.SavetoRequestArgs);

    const diagnostics = await pollDiagnostics(
      server,
      outfileUsedFragmentDirect,
      () => true,
      1
    );
    expect(diagnostics).toMatchInlineSnapshot(`[]`);
  }, 30000);

  it('gives quick-info at start of word (#15)', async () => {
    server.send({
      seq: 11,
      type: 'request',
      command: 'quickinfo',
      arguments: {
        file: outfileCombinations,
        line: 7,
        offset: 5,
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

  it('gives suggestions with empty line (#190)', async () => {
    server.send({
      seq: 12,
      type: 'request',
      command: 'completionInfo',
      arguments: {
        file: outfileCombinations,
        line: 19,
        offset: 3,
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

  it('gives suggestions for type-conditions (#261)', async () => {
    server.send({
      seq: 13,
      type: 'request',
      command: 'completionInfo',
      arguments: {
        file: outfileTypeCondition,
        line: 14,
        offset: 14,
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
          "documentation": "",
          "kind": "var",
          "kindModifiers": "declare",
          "label": "Pokemon",
          "labelDetails": {
            "description": "",
          },
          "name": "Pokemon",
          "sortText": "0",
        },
      ]
    `);
  }, 30000);
});

describe('Fragment dependencies - Issue #494', () => {
  const projectPath = path.resolve(__dirname, 'fixture-project-tada');
  const outfileMissingFragmentDep = path.join(
    projectPath,
    'missing-fragment-dep.ts'
  );

  let server: TSServer;
  beforeAll(async () => {
    server = new TSServer(projectPath, { debugLog: false });

    server.sendCommand('open', {
      file: outfileMissingFragmentDep,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);

    server.sendCommand('updateOpen', {
      openFiles: [
        {
          file: outfileMissingFragmentDep,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/missing-fragment-dep.ts'),
            'utf-8'
          ),
        },
      ],
    } satisfies ts.server.protocol.UpdateOpenRequestArgs);

    server.sendCommand('saveto', {
      file: outfileMissingFragmentDep,
      tmpfile: outfileMissingFragmentDep,
    } satisfies ts.server.protocol.SavetoRequestArgs);
  });

  afterAll(() => {
    try {
      fs.unlinkSync(outfileMissingFragmentDep);
    } catch {}
  });

  it('warns about missing fragment dep even when fragment is used in another query in same file', async () => {
    const diagnostics = await pollDiagnostics(
      server,
      outfileMissingFragmentDep
    );

    // Should have a diagnostic about the unknown fragment in SecondQuery
    expect(diagnostics.length).toBeGreaterThan(0);

    const fragmentError = diagnostics.find((diag: any) =>
      diag.text.includes('PokemonBasicInfo')
    );

    expect(fragmentError).toBeDefined();
    expect(fragmentError.text).toBe('Unknown fragment "PokemonBasicInfo".');
    expect(fragmentError.code).toBe(52001);
    expect(fragmentError.category).toBe('error');
  }, 30000);
});
