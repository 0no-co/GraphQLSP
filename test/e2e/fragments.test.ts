import { expect, afterAll, beforeAll, it, describe } from 'vitest';
import { TSServer } from './server';
import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';
import ts from 'typescript/lib/tsserverlibrary';
import { waitForExpect } from './util';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const projectPath = path.resolve(__dirname, 'fixture-project');
describe('Operation name', () => {
  const outFilePost = path.join(projectPath, 'Post.ts');
  const outFilePosts = path.join(projectPath, 'Posts.ts');
  const genFilePost = path.join(projectPath, 'Post.generated.ts');
  const genFilePosts = path.join(projectPath, 'Posts.generated.ts');
  const baseGenFile = path.join(projectPath, '__generated__/baseGraphQLSP.ts');

  let server: TSServer;
  beforeAll(async () => {
    server = new TSServer(projectPath, { debugLog: false });
  });

  afterAll(() => {
    try {
      fs.unlinkSync(outFilePost);
      fs.unlinkSync(outFilePosts);
      fs.unlinkSync(genFilePost);
      fs.unlinkSync(genFilePosts);
      fs.unlinkSync(baseGenFile);
    } catch {}
  });

  it('gets renamed correctly', async () => {
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
          file: outFilePost,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/Post.ts'),
            'utf-8'
          ),
        },
        {
          file: outFilePosts,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/Posts.ts'),
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

    await waitForExpect(() => {
      expect(fs.readFileSync(outFilePosts, 'utf-8')).toContain(
        `as typeof import('./rename.generated').PostsListDocument`
      );
      const generatedPostsFileContents = fs.readFileSync(genFilePosts, 'utf-8');
      expect(generatedPostsFileContents).toContain(
        'export const PostsListDocument = '
      );
      expect(generatedPostsFileContents).toContain(
        'import * as Types from "./__generated__/baseGraphQLSP"'
      );
      expect(fs.readFileSync(outFilePost, 'utf-8')).toContain(
        `as typeof import('./rename.generated').PostsListDocument`
      );
      const generatedPostFileContents = fs.readFileSync(genFilePost, 'utf-8');
      expect(generatedPostFileContents).toContain(
        'export const PostsFieldsFragment = '
      );
      expect(generatedPostFileContents).toContain(
        'import * as Types from "./__generated__/baseGraphQLSP"'
      );
    });

    const res = server.responses
      .reverse()
      .find(resp => resp.type === 'event' && resp.event === 'suggestionDiag');
    console.log(res);
  }, 20000);
});
