import { expect, afterAll, beforeAll, it, describe } from 'vitest';
import { TSServer } from './server';
import { pollDiagnostics } from './util';
import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';
import ts from 'typescript/lib/tsserverlibrary';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const projectPath = path.resolve(
  __dirname,
  'fixture-project-tada-multi-schema'
);
describe('Multiple schemas', () => {
  const outfilePokemonTest = path.join(projectPath, 'simple-pokemon.ts');
  const outfileTodoTest = path.join(projectPath, 'simple-todo.ts');
  const outfileStarImport = path.join(projectPath, 'star-import.ts');

  let server: TSServer;
  beforeAll(async () => {
    server = new TSServer(projectPath, { debugLog: false });

    server.sendCommand('open', {
      file: outfilePokemonTest,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);
    server.sendCommand('open', {
      file: outfileTodoTest,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);
    server.sendCommand('open', {
      file: outfileStarImport,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);

    server.sendCommand('updateOpen', {
      openFiles: [
        {
          file: outfilePokemonTest,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/simple-pokemon.ts'),
            'utf-8'
          ),
        },
        {
          file: outfileTodoTest,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/simple-todo.ts'),
            'utf-8'
          ),
        },
        {
          file: outfileStarImport,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/star-import.ts'),
            'utf-8'
          ),
        },
      ],
    } satisfies ts.server.protocol.UpdateOpenRequestArgs);

    server.sendCommand('saveto', {
      file: outfilePokemonTest,
      tmpfile: outfilePokemonTest,
    } satisfies ts.server.protocol.SavetoRequestArgs);
    server.sendCommand('saveto', {
      file: outfileTodoTest,
      tmpfile: outfileTodoTest,
    } satisfies ts.server.protocol.SavetoRequestArgs);
    server.sendCommand('saveto', {
      file: outfileStarImport,
      tmpfile: outfileStarImport,
    } satisfies ts.server.protocol.SavetoRequestArgs);

    // Give TS some time to figure this out...
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  afterAll(() => {
    try {
      fs.unlinkSync(outfilePokemonTest);
      fs.unlinkSync(outfileTodoTest);
      fs.unlinkSync(outfileStarImport);
    } catch {}
  });

  it('gives diagnostics about unused fields', async () => {
    const diagnostics = await pollDiagnostics(server, outfilePokemonTest);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchInlineSnapshot(`
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
      }
    `);
  }, 30000);

  it('gives quick-info for the pokemon document', async () => {
    server.send({
      seq: 9,
      type: 'request',
      command: 'quickinfo',
      arguments: {
        file: outfilePokemonTest,
        line: 8,
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

  it('gives quick-info for the pokemon document namespace', async () => {
    server.send({
      seq: 20,
      type: 'request',
      command: 'quickinfo',
      arguments: {
        file: outfileStarImport,
        line: 8,
        offset: 9,
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

  it('gives quick-info for the todo document', async () => {
    server.send({
      seq: 10,
      type: 'request',
      command: 'quickinfo',
      arguments: {
        file: outfileTodoTest,
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
    expect(res?.body.documentation).toEqual(`Todo.id: ID!`);
  }, 30000);

  it('gives completion-info for the pokemon document', async () => {
    server.send({
      seq: 11,
      type: 'request',
      command: 'completionInfo',
      arguments: {
        file: outfilePokemonTest,
        line: 9,
        offset: 7,
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
    expect(res).toMatchInlineSnapshot(`
      {
        "body": {
          "entries": [
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
          ],
          "isGlobalCompletion": false,
          "isMemberCompletion": false,
          "isNewIdentifierLocation": false,
        },
        "command": "completionInfo",
        "request_seq": 11,
        "seq": 0,
        "success": true,
        "type": "response",
      }
    `);
  }, 30000);

  it('gives completion-info for the todo document', async () => {
    server.send({
      seq: 11,
      type: 'request',
      command: 'completionInfo',
      arguments: {
        file: outfileTodoTest,
        line: 8,
        offset: 7,
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
    expect(res).toMatchInlineSnapshot(`
      {
        "body": {
          "entries": [
            {
              "deprecated": false,
              "detail": "String!",
              "isDeprecated": false,
              "kind": "var",
              "kindModifiers": "declare",
              "label": "text",
              "labelDetails": {
                "detail": " String!",
              },
              "name": "text",
              "sortText": "1text",
              "type": "String!",
            },
            {
              "deprecated": false,
              "detail": "Boolean!",
              "isDeprecated": false,
              "kind": "var",
              "kindModifiers": "declare",
              "label": "completed",
              "labelDetails": {
                "detail": " Boolean!",
              },
              "name": "completed",
              "sortText": "2completed",
              "type": "Boolean!",
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
              "sortText": "3__typename",
              "type": "String!",
            },
          ],
          "isGlobalCompletion": false,
          "isMemberCompletion": false,
          "isNewIdentifierLocation": false,
        },
        "command": "completionInfo",
        "request_seq": 11,
        "seq": 0,
        "success": true,
        "type": "response",
      }
    `);
  }, 30000);
});
