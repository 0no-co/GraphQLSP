import { expect, afterEach, afterAll, beforeEach, it } from 'vitest';
import { TSServer } from './server';
import path from 'node:path';
import fs from 'node:fs';
import ts from 'typescript/lib/tsserverlibrary';

const projectPath = path.resolve('./fixture-project');

let server: TSServer;
beforeEach(() => {
  server = new TSServer(projectPath, { debugLog: false });
});
afterEach(() => {
  server.close();
});

const testFile = path.join(projectPath, 'simple.ts');
const generatedFile = path.join(projectPath, 'simple.generated.ts');

afterAll(() => {
  try {
    fs.unlinkSync(testFile);
    fs.unlinkSync(generatedFile);
  } catch {}
});

it('passes simple smoke test', async () => {
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

  expect(() => {
    fs.lstatSync(testFile);
    fs.lstatSync(generatedFile);
  }).not.toThrow();

  expect(fs.readFileSync(testFile, 'utf-8')).toContain(
    `as typeof import('./simple.generated').AllPostsDocument`
  );
  expect(fs.readFileSync(generatedFile, 'utf-8')).toContain(
    'export const AllPostsDocument = '
  );
});
