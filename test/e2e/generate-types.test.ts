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
  const outFile = path.join(projectPath, 'rename.ts');
  const genFile = path.join(projectPath, 'rename.generated.ts');
  const baseGenFile = path.join(projectPath, '__generated__/baseGraphQLSP.ts');

  let server: TSServer;
  beforeAll(async () => {
    server = new TSServer(projectPath, { debugLog: false });
  });

  afterAll(() => {
    try {
      fs.unlinkSync(outFile);
      fs.unlinkSync(genFile);
      fs.unlinkSync(baseGenFile);
    } catch {}
  });

  it('gets renamed correctly', async () => {
    server.sendCommand('open', {
      file: outFile,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);

    server.sendCommand('updateOpen', {
      openFiles: [
        {
          file: outFile,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/rename.ts'),
            'utf-8'
          ),
        },
      ],
    } satisfies ts.server.protocol.UpdateOpenRequestArgs);

    server.sendCommand('saveto', {
      file: outFile,
      tmpfile: outFile,
    } satisfies ts.server.protocol.SavetoRequestArgs);

    await waitForExpect(() => {
      expect(fs.readFileSync(outFile, 'utf-8')).toContain(
        `as typeof import('./rename.generated').PostsDocument`
      );
      const generatedFileContents = fs.readFileSync(genFile, 'utf-8');
      expect(generatedFileContents).toContain('export const PostsDocument = ');
      expect(generatedFileContents).toContain(
        'import * as Types from "./__generated__/baseGraphQLSP"'
      );
    });

    expect(() => {
      fs.lstatSync(outFile);
      fs.lstatSync(genFile);
      fs.lstatSync(baseGenFile);
    }).not.toThrow();

    server.sendCommand('updateOpen', {
      openFiles: [
        {
          file: outFile,
          fileContent: fs
            .readFileSync(outFile, 'utf-8')
            .replace('query Posts', 'query PostList'),
        },
      ],
    } satisfies ts.server.protocol.UpdateOpenRequestArgs);

    server.sendCommand('saveto', {
      file: outFile,
      tmpfile: outFile,
    } satisfies ts.server.protocol.SavetoRequestArgs);

    await waitForExpect(() => {
      expect(fs.readFileSync(outFile, 'utf-8')).toContain(
        `as typeof import('./rename.generated').PostListDocument`
      );
      expect(fs.readFileSync(genFile, 'utf-8')).toContain(
        'export const PostListDocument ='
      );
    });
  }, 20000);
});
