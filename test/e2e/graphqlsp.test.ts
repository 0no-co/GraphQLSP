import { expect, afterAll, beforeAll, it, describe } from 'vitest';
import { TSServer } from './server';
import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';
import ts from 'typescript/lib/tsserverlibrary';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const projectPath = path.resolve(__dirname, 'fixture-project');

let server: TSServer;

describe('simple', () => {
  const testFile = path.join(projectPath, 'simple.ts');
  const generatedFile = path.join(projectPath, 'simple.generated.ts');
  const baseGeneratedFile = path.join(
    projectPath,
    '__generated__/baseGraphQLSP.ts'
  );

  beforeAll(async () => {
    server = new TSServer(projectPath, { debugLog: false });
    const fixtureFileContent = fs.readFileSync(
      path.resolve(testFile, '../fixtures/simple.ts'),
      'utf-8'
    );

    server.sendCommand('open', {
      file: testFile,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);

    server.sendCommand('updateOpen', {
      openFiles: [{ file: testFile, fileContent: fixtureFileContent }],
    } satisfies ts.server.protocol.UpdateOpenRequestArgs);

    server.sendCommand('saveto', {
      file: testFile,
      tmpfile: testFile,
    } satisfies ts.server.protocol.SavetoRequestArgs);

    await server.waitForResponse(
      response => response.type === 'event' && response.event === 'setTypings'
    );
  });

  afterAll(() => {
    try {
      fs.unlinkSync(testFile);
      fs.unlinkSync(generatedFile);
      fs.unlinkSync(baseGeneratedFile);
    } catch {}
    server.close();
  });

  it('Proposes suggestions for a selection-set', async () => {
    server.send({
      seq: 8,
      type: 'request',
      command: 'completionInfo',
      arguments: {
        file: testFile,
        line: 7,
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
    expect(typeof res?.body.entries).toEqual('object');
    const defaultAttrs = { kind: 'var', kindModifiers: 'declare' };
    expect(res?.body.entries).toEqual([
      {
        ...defaultAttrs,
        name: 'id',
        sortText: '0id',
        labelDetails: { detail: ' ID!' },
      },
      {
        ...defaultAttrs,
        name: 'content',
        sortText: '2content',
        labelDetails: { detail: ' String!' },
      },
      {
        ...defaultAttrs,
        name: '__typename',
        sortText: '3__typename',
        labelDetails: {
          detail: ' String!',
          description: 'The name of the current Object type at runtime.',
        },
      },
    ]);
  }, 7500);

  it('Gives quick-info when hovering', async () => {
    server.send({
      seq: 9,
      type: 'request',
      command: 'quickinfo',
      arguments: {
        file: testFile,
        line: 5,
        offset: 7,
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
      `Query.posts: [Post]\n\nList out all posts`
    );
  }, 7500);
});
