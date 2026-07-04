import { expect, afterAll, beforeAll, it, describe } from 'vitest';
import { TSServer } from './server';
import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';
import ts from 'typescript/lib/tsserverlibrary';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const projectPath = path.resolve(__dirname, 'fixture-project');

// The plugin logs to the tsserver project-service log, which `TSServer`
// configures (through the TSS_LOG environment variable) to be written to
// `tsserver.log` inside the fixture project
const logFile = path.join(projectPath, 'tsserver.log');

const readLog = (): string => {
  try {
    return fs.readFileSync(logFile, 'utf-8');
  } catch {
    return '';
  }
};

const waitForLog = async (pattern: RegExp): Promise<string> => {
  let contents = '';
  for (let attempt = 0; attempt < 40; attempt++) {
    contents = readLog();
    if (pattern.test(contents)) return contents;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return contents;
};

let server: TSServer;

describe('Performance logging', () => {
  const testFile = path.join(projectPath, 'Perf.ts');

  beforeAll(async () => {
    // Remove log output of previously run tests re-using this fixture, so
    // the assertions below only see lines produced by this server instance
    try {
      fs.unlinkSync(logFile);
    } catch {}

    server = new TSServer(projectPath, { debugLog: false });

    const fixtureFileContent = fs.readFileSync(
      path.join(projectPath, 'fixtures/simple.ts'),
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
  });

  afterAll(() => {
    try {
      fs.unlinkSync(testFile);
    } catch {}
    server.close();
  });

  it('logs perf lines for diagnostics, completions and the schema load', async () => {
    // Diagnostics are pushed as events after the file is opened/saved
    await server.waitForResponse(
      e => e.type === 'event' && e.event === 'semanticDiag',
      true
    );

    server.send({
      seq: 100,
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

    // The tsserver log is written asynchronously to the responses above, so
    // poll until the expected lines have been flushed
    const log = await waitForLog(
      /\[GraphQLSP\] perf: getCompletionsAtPosition \d+\.\d+ms/
    );

    expect(log).toMatch(
      /\[GraphQLSP\] perf: schema load \d+\.\d+ms .*schema\.graphql/
    );
    expect(log).toMatch(
      /\[GraphQLSP\] perf: getSemanticDiagnostics \d+\.\d+ms .*Perf\.ts/
    );
    expect(log).toMatch(
      /\[GraphQLSP\] perf: getCompletionsAtPosition \d+\.\d+ms .*Perf\.ts/
    );
  }, 30000);
});
