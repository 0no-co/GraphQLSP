import { expect, afterAll, beforeAll, it, describe } from 'vitest';
import { TSServer } from './server';
import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';
import ts from 'typescript/lib/tsserverlibrary';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// Polls the server with "geterr" until a non-empty semantic-diagnostics
// response arrives for the given file. The schema is loaded asynchronously,
// so the error-state may not have settled when the file is first checked.
const waitForDiagnostics = async (
  server: TSServer,
  file: string
): Promise<any[]> => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const seen = server.responses.length;
    server.sendCommand('geterr', { files: [file], delay: 0 });
    await server.waitForResponse(
      e =>
        e.type === 'event' &&
        e.event === 'semanticDiag' &&
        e.body?.file === file
    );
    const res = server.responses
      .slice(seen)
      .find(
        e =>
          e.type === 'event' &&
          e.event === 'semanticDiag' &&
          e.body?.file === file
      ) as any;
    if (res && res.body.diagnostics.length) return res.body.diagnostics;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return [];
};

const openFixture = async (server: TSServer, projectPath: string) => {
  const testFile = path.join(projectPath, 'simple.ts');
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

  await server.waitForResponse(
    response => response.type === 'event' && response.event === 'setTypings'
  );

  return testFile;
};

describe('Schema that fails to load', () => {
  const projectPath = path.resolve(
    __dirname,
    'fixture-project-misconfiguration'
  );
  const testFile = path.join(projectPath, 'simple.ts');

  let server: TSServer;
  beforeAll(async () => {
    server = new TSServer(projectPath, { debugLog: false });
    await openFixture(server, projectPath);
  });

  afterAll(() => {
    try {
      fs.unlinkSync(testFile);
    } catch {}
    server.close();
  });

  it('reports the schema-loading failure on the GraphQL document', async () => {
    const diagnostics = await waitForDiagnostics(server, testFile);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      category: 'error',
      code: 52006,
    });
    expect(diagnostics[0].text).toMatch(/Failed to load the GraphQL schema/);
    expect(diagnostics[0].text).toMatch(/does-not-exist\.graphql/);
    // The diagnostic is positioned on the first GraphQL document in the file
    expect(diagnostics[0].start.line).toBe(3);
  }, 15000);
});

describe('Tagged templates in call-expression mode', () => {
  const projectPath = path.resolve(__dirname, 'fixture-project-mode-mismatch');
  const testFile = path.join(projectPath, 'simple.ts');

  let server: TSServer;
  beforeAll(async () => {
    server = new TSServer(projectPath, { debugLog: false });
    await openFixture(server, projectPath);
  });

  afterAll(() => {
    try {
      fs.unlinkSync(testFile);
    } catch {}
    server.close();
  });

  it('warns that documents in tagged templates are ignored', async () => {
    const diagnostics = await waitForDiagnostics(server, testFile);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      category: 'warning',
      code: 52007,
    });
    expect(diagnostics[0].text).toMatch(/templateIsCallExpression/);
    expect(diagnostics[0].start.line).toBe(3);
  }, 15000);
});

describe('Unknown schema name', () => {
  const projectPath = path.resolve(
    __dirname,
    'fixture-project-tada-multi-schema'
  );
  const testFile = path.join(projectPath, 'unknown-schema.ts');

  let server: TSServer;
  beforeAll(async () => {
    server = new TSServer(projectPath, { debugLog: false });
    const fixtureFileContent = fs.readFileSync(
      path.join(projectPath, 'fixtures/unknown-schema.ts'),
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
    } catch {}
    server.close();
  });

  it('reports documents naming a schema that is not configured', async () => {
    const diagnostics = await waitForDiagnostics(server, testFile);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      category: 'error',
      code: 52008,
    });
    expect(diagnostics[0].text).toMatch(/schema named "unknown"/);
    expect(diagnostics[0].text).toMatch(/pokemons, todos/);
  }, 15000);
});

describe('Missing "schema" config option', () => {
  const projectPath = path.resolve(__dirname, 'fixture-project-missing-schema');
  const testFile = path.join(projectPath, 'simple.ts');

  let server: TSServer;
  beforeAll(async () => {
    server = new TSServer(projectPath, { debugLog: false });
    await openFixture(server, projectPath);
  });

  afterAll(() => {
    try {
      fs.unlinkSync(testFile);
    } catch {}
    server.close();
  });

  it('reports the missing "schema" option on the GraphQL document', async () => {
    const diagnostics = await waitForDiagnostics(server, testFile);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      category: 'error',
      code: 52006,
    });
    expect(diagnostics[0].text).toMatch(/missing a `schema` property/);
    expect(diagnostics[0].text).toMatch(/compilerOptions\.plugins/);
    expect(diagnostics[0].start.line).toBe(3);
  }, 15000);
});
