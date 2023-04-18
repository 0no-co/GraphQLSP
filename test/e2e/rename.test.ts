import { expect, afterAll, beforeAll, it, describe } from 'vitest';
import { TSServer } from './server';
import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';
import ts from 'typescript/lib/tsserverlibrary';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const projectPath = path.resolve(__dirname, 'fixture-project');
describe('Operation name', () => {
  const outFile = path.join(projectPath, 'rename.ts');
  const genFile = path.join(projectPath, 'rename.generated.ts');

  let server: TSServer;
  beforeAll(async () => {
    server = new TSServer(projectPath, { debugLog: false });
  });

  afterAll(() => {
    try {
      fs.unlinkSync(outFile);
      fs.unlinkSync(genFile);
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

    await server.waitForResponse(
      response => response.type === 'event' && response.event === 'setTypings'
    );

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

    await server.waitForResponse(
      response =>
        response.type === 'event' && response.event === 'suggestionDiag'
    );

    expect(fs.readFileSync(outFile, 'utf-8')).toContain(
      `as typeof import('./rename.generated').PostListDocument`
    );
    expect(fs.readFileSync(genFile, 'utf-8')).toContain(
      'export const PostListDocument ='
    );
  }, 12500);
});
