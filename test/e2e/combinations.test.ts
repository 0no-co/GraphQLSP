import { expect, afterAll, beforeAll, it, describe } from 'vitest';
import { TSServer } from './server';
import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';
import ts from 'typescript/lib/tsserverlibrary';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const projectPath = path.resolve(__dirname, 'fixture-project');
describe('Fragment + operations', () => {
  const outfileCombinations = path.join(projectPath, 'Combination.ts');

  let server: TSServer;
  beforeAll(async () => {
    server = new TSServer(projectPath, { debugLog: false });

    server.sendCommand('open', {
      file: outfileCombinations,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);

    server.sendCommand('updateOpen', {
      openFiles: [
        {
          file: outfileCombinations,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/Combination.ts'),
            'utf-8'
          ),
        },
      ],
    } satisfies ts.server.protocol.UpdateOpenRequestArgs);

    server.sendCommand('saveto', {
      file: outfileCombinations,
      tmpfile: outfileCombinations,
    } satisfies ts.server.protocol.SavetoRequestArgs);
  });

  afterAll(() => {
    try {
      fs.unlinkSync(outfileCombinations);
    } catch {}
  });

  it('gives semantic-diagnostics with preceding fragments', async () => {
    await server.waitForResponse(
      e => e.type === 'event' && e.event === 'semanticDiag'
    );
    const res = server.responses
      .reverse()
      .find(resp => resp.type === 'event' && resp.event === 'semanticDiag');
    expect(res?.body.diagnostics).toMatchInlineSnapshot(`
      [
        {
          "category": "error",
          "code": 52001,
          "end": {
            "line": 7,
            "offset": 1,
          },
          "start": {
            "line": 6,
            "offset": 5,
          },
          "text": "Cannot query field \\"someUnknownField\\" on type \\"Post\\".",
        },
        {
          "category": "error",
          "code": 52001,
          "end": {
            "line": 11,
            "offset": 10,
          },
          "start": {
            "line": 11,
            "offset": 3,
          },
          "text": "Cannot query field \\"someUnknownField\\" on type \\"Post\\".",
        },
        {
          "category": "error",
          "code": 52001,
          "end": {
            "line": 17,
            "offset": 1,
          },
          "start": {
            "line": 16,
            "offset": 7,
          },
          "text": "Cannot query field \\"__typenam\\" on type \\"Post\\".",
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
        line: 14,
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
  }, 30000);

  it('gives suggestions with preceding fragments', async () => {
    server.send({
      seq: 10,
      type: 'request',
      command: 'completionInfo',
      arguments: {
        file: outfileCombinations,
        line: 15,
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
    expect(res?.body.entries).toMatchInlineSnapshot(`
      [
        {
          "kind": "var",
          "kindModifiers": "declare",
          "labelDetails": {
            "detail": " ID!",
          },
          "name": "id",
          "sortText": "0id",
        },
        {
          "kind": "var",
          "kindModifiers": "declare",
          "labelDetails": {
            "detail": " String!",
          },
          "name": "title",
          "sortText": "1title",
        },
        {
          "kind": "var",
          "kindModifiers": "declare",
          "labelDetails": {
            "detail": " String!",
          },
          "name": "content",
          "sortText": "2content",
        },
        {
          "kind": "var",
          "kindModifiers": "declare",
          "labelDetails": {
            "description": "The name of the current Object type at runtime.",
            "detail": " String!",
          },
          "name": "__typename",
          "sortText": "3__typename",
        },
      ]
    `);
  }, 30000);
});
