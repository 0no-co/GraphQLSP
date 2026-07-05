import { expect, afterAll, beforeAll, it, describe } from 'vitest';
import { TSServer } from './server';
import { pollDiagnostics } from './util';
import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';
import ts from 'typescript/lib/tsserverlibrary';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const projectPath = path.resolve(__dirname, 'fixture-project-unused-fields');
describe('unused fields', () => {
  const outfileDestructuringFromStart = path.join(
    projectPath,
    'immediate-destructuring.tsx'
  );
  const outfileDestructuring = path.join(projectPath, 'destructuring.tsx');
  const outfileBail = path.join(projectPath, 'bail.tsx');
  const outfileFragmentDestructuring = path.join(
    projectPath,
    'fragment-destructuring.tsx'
  );
  const outfileFragment = path.join(projectPath, 'fragment.tsx');
  const outfilePropAccess = path.join(projectPath, 'property-access.tsx');
  const outfileChainedUsage = path.join(projectPath, 'chained-usage.ts');
  const outfileMultiDocument = path.join(projectPath, 'multi-document.ts');

  let server: TSServer;
  beforeAll(async () => {
    server = new TSServer(projectPath, { debugLog: false });

    server.sendCommand('open', {
      file: outfileDestructuring,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);
    server.sendCommand('open', {
      file: outfileBail,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);
    server.sendCommand('open', {
      file: outfileFragment,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);
    server.sendCommand('open', {
      file: outfilePropAccess,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);
    server.sendCommand('open', {
      file: outfileFragmentDestructuring,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);
    server.sendCommand('open', {
      file: outfileDestructuringFromStart,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);
    server.sendCommand('open', {
      file: outfileChainedUsage,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);
    server.sendCommand('open', {
      file: outfileMultiDocument,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);

    server.sendCommand('updateOpen', {
      openFiles: [
        {
          file: outfileDestructuring,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/destructuring.tsx'),
            'utf-8'
          ),
        },
        {
          file: outfileBail,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/bail.tsx'),
            'utf-8'
          ),
        },
        {
          file: outfileFragment,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/fragment.tsx'),
            'utf-8'
          ),
        },
        {
          file: outfilePropAccess,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/property-access.tsx'),
            'utf-8'
          ),
        },
        {
          file: outfileDestructuringFromStart,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/immediate-destructuring.tsx'),
            'utf-8'
          ),
        },
        {
          file: outfileFragmentDestructuring,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/fragment-destructuring.tsx'),
            'utf-8'
          ),
        },
        {
          file: outfileChainedUsage,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/chained-usage.ts'),
            'utf-8'
          ),
        },
        {
          file: outfileMultiDocument,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/multi-document.ts'),
            'utf-8'
          ),
        },
      ],
    } satisfies ts.server.protocol.UpdateOpenRequestArgs);

    server.sendCommand('saveto', {
      file: outfileDestructuring,
      tmpfile: outfileDestructuring,
    } satisfies ts.server.protocol.SavetoRequestArgs);
    server.sendCommand('saveto', {
      file: outfileFragment,
      tmpfile: outfileFragment,
    } satisfies ts.server.protocol.SavetoRequestArgs);
    server.sendCommand('saveto', {
      file: outfilePropAccess,
      tmpfile: outfilePropAccess,
    } satisfies ts.server.protocol.SavetoRequestArgs);
    server.sendCommand('saveto', {
      file: outfileFragmentDestructuring,
      tmpfile: outfileFragmentDestructuring,
    } satisfies ts.server.protocol.SavetoRequestArgs);
    server.sendCommand('saveto', {
      file: outfileDestructuringFromStart,
      tmpfile: outfileDestructuringFromStart,
    } satisfies ts.server.protocol.SavetoRequestArgs);
    server.sendCommand('saveto', {
      file: outfileBail,
      tmpfile: outfileBail,
    } satisfies ts.server.protocol.SavetoRequestArgs);
    server.sendCommand('saveto', {
      file: outfileChainedUsage,
      tmpfile: outfileChainedUsage,
    } satisfies ts.server.protocol.SavetoRequestArgs);
    server.sendCommand('saveto', {
      file: outfileMultiDocument,
      tmpfile: outfileMultiDocument,
    } satisfies ts.server.protocol.SavetoRequestArgs);
  });

  afterAll(() => {
    try {
      fs.unlinkSync(outfileDestructuring);
      fs.unlinkSync(outfileFragment);
      fs.unlinkSync(outfilePropAccess);
      fs.unlinkSync(outfileFragmentDestructuring);
      fs.unlinkSync(outfileDestructuringFromStart);
      fs.unlinkSync(outfileBail);
      fs.unlinkSync(outfileChainedUsage);
      fs.unlinkSync(outfileMultiDocument);
    } catch {}
  });

  it('gives unused fields with fragments', async () => {
    const diagnostics = await pollDiagnostics(server, outfileFragment);
    expect(diagnostics).toMatchInlineSnapshot(`
      [
        {
          "category": "warning",
          "code": 52005,
          "end": {
            "line": 9,
            "offset": 11,
          },
          "start": {
            "line": 9,
            "offset": 7,
          },
          "text": "Field(s) 'attacks.fast.damage', 'attacks.fast.name' are not used.",
        },
      ]
    `);
  }, 30000);

  it('gives unused fields with fragments destructuring', async () => {
    const diagnostics = await pollDiagnostics(
      server,
      outfileFragmentDestructuring
    );
    expect(diagnostics).toMatchInlineSnapshot(`
      [
        {
          "category": "warning",
          "code": 52005,
          "end": {
            "line": 9,
            "offset": 11,
          },
          "start": {
            "line": 9,
            "offset": 7,
          },
          "text": "Field(s) 'attacks.fast.damage', 'attacks.fast.name' are not used.",
        },
      ]
    `);
  }, 30000);

  it('gives semantc diagnostics with property access', async () => {
    const diagnostics = await pollDiagnostics(server, outfilePropAccess);
    expect(diagnostics).toMatchInlineSnapshot(`
      [
        {
          "category": "warning",
          "code": 52005,
          "end": {
            "line": 9,
            "offset": 12,
          },
          "start": {
            "line": 9,
            "offset": 5,
          },
          "text": "Field(s) 'pokemon.fleeRate' are not used.",
        },
        {
          "category": "warning",
          "code": 52005,
          "end": {
            "line": 14,
            "offset": 16,
          },
          "start": {
            "line": 14,
            "offset": 9,
          },
          "text": "Field(s) 'pokemon.attacks.special.damage' are not used.",
        },
        {
          "category": "warning",
          "code": 52005,
          "end": {
            "line": 19,
            "offset": 13,
          },
          "start": {
            "line": 19,
            "offset": 7,
          },
          "text": "Field(s) 'pokemon.weight.minimum', 'pokemon.weight.maximum' are not used.",
        },
        {
          "category": "error",
          "code": 2578,
          "end": {
            "line": 3,
            "offset": 20,
          },
          "start": {
            "line": 3,
            "offset": 1,
          },
          "text": "Unused '@ts-expect-error' directive.",
        },
      ]
    `);
  }, 30000);

  it('gives unused fields with destructuring', async () => {
    const diagnostics = await pollDiagnostics(server, outfileDestructuring);
    expect(diagnostics).toMatchInlineSnapshot(`
      [
        {
          "category": "warning",
          "code": 52005,
          "end": {
            "line": 14,
            "offset": 16,
          },
          "start": {
            "line": 14,
            "offset": 9,
          },
          "text": "Field(s) 'pokemon.attacks.special.name', 'pokemon.attacks.special.damage' are not used.",
        },
        {
          "category": "warning",
          "code": 52005,
          "end": {
            "line": 9,
            "offset": 12,
          },
          "start": {
            "line": 9,
            "offset": 5,
          },
          "text": "Field(s) 'pokemon.name' are not used.",
        },
        {
          "category": "error",
          "code": 2578,
          "end": {
            "line": 3,
            "offset": 20,
          },
          "start": {
            "line": 3,
            "offset": 1,
          },
          "text": "Unused '@ts-expect-error' directive.",
        },
      ]
    `);
  }, 30000);

  it('gives unused fields with immedaite destructuring', async () => {
    const diagnostics = await pollDiagnostics(
      server,
      outfileDestructuringFromStart
    );
    expect(diagnostics).toMatchInlineSnapshot(`
      [
        {
          "category": "warning",
          "code": 52005,
          "end": {
            "line": 14,
            "offset": 16,
          },
          "start": {
            "line": 14,
            "offset": 9,
          },
          "text": "Field(s) 'pokemon.attacks.special.name', 'pokemon.attacks.special.damage' are not used.",
        },
        {
          "category": "warning",
          "code": 52005,
          "end": {
            "line": 9,
            "offset": 12,
          },
          "start": {
            "line": 9,
            "offset": 5,
          },
          "text": "Field(s) 'pokemon.name' are not used.",
        },
        {
          "category": "error",
          "code": 2578,
          "end": {
            "line": 3,
            "offset": 20,
          },
          "start": {
            "line": 3,
            "offset": 1,
          },
          "text": "Unused '@ts-expect-error' directive.",
        },
      ]
    `);
  }, 30000);

  it('Bails unused fields when memo func is used', async () => {
    const diagnostics = await pollDiagnostics(server, outfileBail);
    expect(diagnostics).toMatchInlineSnapshot(`
      [
        {
          "category": "error",
          "code": 2578,
          "end": {
            "line": 4,
            "offset": 20,
          },
          "start": {
            "line": 4,
            "offset": 1,
          },
          "text": "Unused '@ts-expect-error' directive.",
        },
      ]
    `);
  }, 30000);

  it('Tracks multiple documents, alias chains and named callbacks in one file', async () => {
    const diagnostics = await pollDiagnostics(server, outfileMultiDocument);
    // The Pok document has no generated type (same as chained-usage.ts), so
    // we only assert the unused-field diagnostics here.
    const unusedFieldDiagnostics = diagnostics.filter(
      (diagnostic: any) => diagnostic.code === 52005
    );
    expect(unusedFieldDiagnostics).toMatchInlineSnapshot(`
      [
        {
          "category": "warning",
          "code": 52005,
          "end": {
            "line": 7,
            "offset": 12,
          },
          "start": {
            "line": 7,
            "offset": 5,
          },
          "text": "Field(s) 'pokemon.fleeRate', 'pokemon.name' are not used.",
        },
        {
          "category": "warning",
          "code": 52005,
          "end": {
            "line": 12,
            "offset": 16,
          },
          "start": {
            "line": 12,
            "offset": 9,
          },
          "text": "Field(s) 'pokemon.attacks.special.name', 'pokemon.attacks.special.damage' are not used.",
        },
        {
          "category": "warning",
          "code": 52005,
          "end": {
            "line": 17,
            "offset": 13,
          },
          "start": {
            "line": 17,
            "offset": 7,
          },
          "text": "Field(s) 'pokemon.weight.maximum' are not used.",
        },
        {
          "category": "warning",
          "code": 52005,
          "end": {
            "line": 30,
            "offset": 15,
          },
          "start": {
            "line": 30,
            "offset": 7,
          },
          "text": "Field(s) 'pokemons.maxHP', 'pokemons.fleeRate' are not used.",
        },
        {
          "category": "warning",
          "code": 52005,
          "end": {
            "line": 102,
            "offset": 13,
          },
          "start": {
            "line": 102,
            "offset": 5,
          },
          "text": "Field(s) 'pokemons.maxHP', 'pokemons.fleeRate' are not used.",
        },
        {
          "category": "warning",
          "code": 52005,
          "end": {
            "line": 120,
            "offset": 13,
          },
          "start": {
            "line": 120,
            "offset": 5,
          },
          "text": "Field(s) 'pokemons.fleeRate' are not used.",
        },
        {
          "category": "warning",
          "code": 52005,
          "end": {
            "line": 167,
            "offset": 13,
          },
          "start": {
            "line": 167,
            "offset": 5,
          },
          "text": "Field(s) 'pokemons.maxHP' are not used.",
        },
      ]
    `);
  }, 30000);

  it('Finds field usage in chained call-expressions', async () => {
    const diagnostics = await pollDiagnostics(server, outfileChainedUsage);
    expect(diagnostics[0]).toEqual({
      category: 'warning',
      code: 52005,
      end: {
        line: 8,
        offset: 15,
      },
      start: {
        line: 8,
        offset: 7,
      },
      text: "Field(s) 'pokemons.fleeRate' are not used.",
    });
  }, 30000);
});
