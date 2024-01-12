import { expect, afterAll, beforeAll, it, describe } from 'vitest';
import { TSServer } from './server';
import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';
import ts from 'typescript/lib/tsserverlibrary';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const projectPath = path.resolve(__dirname, 'fixture-project');
describe('Fragments', () => {
  const outFilePost = path.join(projectPath, 'Post.ts');
  const outFilePosts = path.join(projectPath, 'Posts.ts');

  let server: TSServer;
  beforeAll(async () => {
    server = new TSServer(projectPath, { debugLog: false });
  });

  afterAll(() => {
    try {
      fs.unlinkSync(outFilePost);
      fs.unlinkSync(outFilePosts);
    } catch {}
  });

  it('should send a message for missing fragment import', async () => {
    server.sendCommand('open', {
      file: outFilePost,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);

    server.sendCommand('open', {
      file: outFilePosts,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);

    server.sendCommand('updateOpen', {
      openFiles: [
        {
          file: outFilePosts,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/Posts.ts'),
            'utf-8'
          ),
        },
        {
          file: outFilePost,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/Post.ts'),
            'utf-8'
          ),
        },
      ],
    } satisfies ts.server.protocol.UpdateOpenRequestArgs);

    server.sendCommand('saveto', {
      file: outFilePost,
      tmpfile: outFilePost,
    } satisfies ts.server.protocol.SavetoRequestArgs);

    server.sendCommand('saveto', {
      file: outFilePosts,
      tmpfile: outFilePosts,
    } satisfies ts.server.protocol.SavetoRequestArgs);

    server.sendCommand('saveto', {
      file: outFilePosts,
      tmpfile: outFilePosts,
    } satisfies ts.server.protocol.SavetoRequestArgs);

    await server.waitForResponse(
      response =>
        response.type === 'event' &&
        response.event === 'semanticDiag' &&
        response.body.file === outFilePosts
    );

    const res = server.responses
      .reverse()
      .find(
        resp =>
          resp.type === 'event' &&
          resp.event === 'semanticDiag' &&
          resp.body.file === outFilePosts
      );

    expect(res?.body.diagnostics).toEqual([
      {
        category: 'message',
        code: 52003,
        end: {
          line: 2,
          offset: 31,
        },
        start: {
          line: 2,
          offset: 1,
        },
        text: 'Missing Fragment import(s) \'PostFields\' from "./Post".',
      },
    ]);
  }, 30000);
});
