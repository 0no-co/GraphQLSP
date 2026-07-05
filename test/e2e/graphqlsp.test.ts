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
      response =>
        response.type === 'event' && response.event === 'projectLoadingFinish',
      true
    );

    // The schema is loaded asynchronously, so completions inside the GraphQL
    // document are empty until the plugin has finished loading it. Poll until
    // the plugin starts serving GraphQL completions before running the tests.
    for (let attempt = 0; attempt < 40; attempt++) {
      server.sendCommand('completionInfo', {
        file: testFile,
        line: 7,
        offset: 7,
        triggerKind: 1,
      } satisfies ts.server.protocol.CompletionsRequestArgs);
      await server.waitForResponse(
        response =>
          response.type === 'response' && response.command === 'completionInfo'
      );
      const res = server.responses
        .filter(
          resp => resp.type === 'response' && resp.command === 'completionInfo'
        )
        .pop() as any;
      if (res?.body?.entries?.length) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }, 30000);

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
    const defaultAttrs = {
      kind: 'var',
      kindModifiers: 'declare',
      deprecated: false,
      isDeprecated: false,
    };
    expect(res?.body.entries).toEqual([
      {
        ...defaultAttrs,
        name: 'id',
        label: 'id',
        sortText: '0id',
        detail: 'ID!',
        type: 'ID!',
        labelDetails: { detail: ' ID!' },
      },
      {
        ...defaultAttrs,
        name: 'content',
        label: 'content',
        sortText: '2content',
        detail: 'String!',
        type: 'String!',
        labelDetails: { detail: ' String!' },
      },
      {
        ...defaultAttrs,
        name: '__typename',
        label: '__typename',
        sortText: '3__typename',
        detail: 'String!',
        type: 'String!',
        documentation: 'The name of the current Object type at runtime.',
        labelDetails: {
          detail: ' String!',
          description: 'The name of the current Object type at runtime.',
        },
      },
    ]);
  }, 7500);

  it('Gives quick-info when hovering start (#15)', async () => {
    server.send({
      seq: 9,
      type: 'request',
      command: 'quickinfo',
      arguments: {
        file: testFile,
        line: 5,
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
    expect(res?.body.documentation).toEqual(
      `Query.posts: [Post]\n\nList out all posts`
    );
  }, 7500);

  it('Handles empty line (#190)', async () => {
    server.send({
      seq: 10,
      type: 'request',
      command: 'completionInfo',
      arguments: {
        file: testFile,
        line: 14,
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
    const defaultAttrs = {
      kind: 'var',
      kindModifiers: 'declare',
      deprecated: false,
      isDeprecated: false,
    };
    expect(res?.body.entries).toEqual([
      {
        ...defaultAttrs,
        name: 'post',
        label: 'post',
        sortText: '0post',
        detail: 'Post',
        type: 'Post',
        labelDetails: { detail: ' Post' },
      },
      {
        ...defaultAttrs,
        name: 'posts',
        label: 'posts',
        sortText: '1posts',
        detail: '[Post]',
        type: '[Post]',
        documentation: 'List out all posts',
        labelDetails: { detail: ' [Post]', description: 'List out all posts' },
      },
      {
        ...defaultAttrs,
        name: '__typename',
        label: '__typename',
        sortText: '2__typename',
        detail: 'String!',
        type: 'String!',
        documentation: 'The name of the current Object type at runtime.',
        labelDetails: {
          detail: ' String!',
          description: 'The name of the current Object type at runtime.',
        },
      },
      {
        ...defaultAttrs,
        name: '__schema',
        label: '__schema',
        sortText: '3__schema',
        detail: '__Schema!',
        type: '__Schema!',
        documentation: 'Access the current type schema of this server.',
        labelDetails: {
          detail: ' __Schema!',
          description: 'Access the current type schema of this server.',
        },
      },
      {
        ...defaultAttrs,
        name: '__type',
        label: '__type',
        sortText: '4__type',
        detail: '__Type',
        type: '__Type',
        documentation: 'Request the type information of a single type.',
        labelDetails: {
          detail: ' __Type',
          description: 'Request the type information of a single type.',
        },
      },
    ]);
  }, 7500);
});
