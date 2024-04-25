import { expect, afterAll, beforeAll, it, describe } from 'vitest';
import { TSServer } from './server';
import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';
import ts from 'typescript/lib/tsserverlibrary';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const projectPath = path.resolve(
  __dirname,
  'fixture-project-tada-multi-schema'
);
describe('Fragment + operations', () => {
  const outfilePokemonTypes = path.join(projectPath, 'pokemon.ts');
  const outfileTodoTypes = path.join(projectPath, 'todo.ts');
  const outfilePokemonTest = path.join(projectPath, 'simple-pokemon.ts');
  const outfileTodoTest = path.join(projectPath, 'simple-todo.ts');

  let server: TSServer;
  beforeAll(async () => {
    server = new TSServer(projectPath, { debugLog: false });

    server.sendCommand('open', {
      file: outfilePokemonTypes,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);
    server.sendCommand('open', {
      file: outfileTodoTypes,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);
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

    server.sendCommand('updateOpen', {
      openFiles: [
        {
          file: outfilePokemonTypes,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/pokemon.ts'),
            'utf-8'
          ),
        },
        {
          file: outfileTodoTypes,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/todo.ts'),
            'utf-8'
          ),
        },
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
      ],
    } satisfies ts.server.protocol.UpdateOpenRequestArgs);

    server.sendCommand('saveto', {
      file: outfilePokemonTypes,
      tmpfile: outfilePokemonTypes,
    } satisfies ts.server.protocol.SavetoRequestArgs);
    server.sendCommand('saveto', {
      file: outfileTodoTypes,
      tmpfile: outfileTodoTypes,
    } satisfies ts.server.protocol.SavetoRequestArgs);
    server.sendCommand('saveto', {
      file: outfilePokemonTest,
      tmpfile: outfilePokemonTest,
    } satisfies ts.server.protocol.SavetoRequestArgs);
    server.sendCommand('saveto', {
      file: outfileTodoTest,
      tmpfile: outfileTodoTest,
    } satisfies ts.server.protocol.SavetoRequestArgs);
  });

  afterAll(() => {
    try {
      fs.unlinkSync(outfilePokemonTypes);
      fs.unlinkSync(outfileTodoTypes);
      fs.unlinkSync(outfilePokemonTest);
      fs.unlinkSync(outfileTodoTest);
    } catch {}
  });

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

  it('gives quick-info for the todo document', async () => {
    server.send({
      seq: 9,
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
});
