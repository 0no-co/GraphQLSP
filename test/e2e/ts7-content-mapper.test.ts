import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { checkProject } from '../../packages/graphqlsp/src/check';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// A project in the TypeScript 7 fixture whose `.graphql` files are mapped by a
// minimal content mapper (`mapped/mapper`) to modules exporting their documents
// through an aliased `graphql()`, like @gql.tada/content-mapper
const projectPath = path.resolve(__dirname, 'fixture-project-ts7', 'mapped');
const tsconfigPath = path.join(projectPath, 'tsconfig.json');
const compilerPath = createRequire(tsconfigPath).resolve(
  'typescript-7/package.json'
);

// tsrs's API doesn't run content mappers yet (as of 0.18), even with `runExternalCode`
const skip =
  !!process.env.GRAPHQLSP_TS7_COMPILER &&
  process.env.GRAPHQLSP_TS7_COMPILER !== 'typescript';

const check = async (runExternalCode: boolean) => {
  const result = await checkProject({
    tsconfigPath,
    compilerPath,
    runExternalCode,
  });
  return {
    files: result.files.map(file => path.relative(projectPath, file)).sort(),
    diagnostics: result.diagnostics.map(diagnostic => ({
      file: path.relative(projectPath, diagnostic.file).replace(/\\/g, '/'),
      line: diagnostic.line,
      column: diagnostic.column,
      code: diagnostic.code,
      message: diagnostic.message,
    })),
  };
};

describe.skipIf(skip)('checkProject with content mappers', () => {
  beforeAll(() => {
    // TypeScript resolves content mappers from node_modules
    const link = path.join(
      projectPath,
      'node_modules',
      'graphqlsp-test-content-mapper'
    );
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.rmSync(link, { force: true });
    fs.symlinkSync(path.join(projectPath, 'mapper'), link, 'junction');
  });

  it("doesn't find documents in mapped files without runExternalCode", async () => {
    const { diagnostics } = await check(false);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        file: 'src/persisted.ts',
        line: 6,
        message: 'Can\'t find reference to "PokemonDoc".',
      }),
      expect.objectContaining({
        file: 'src/persisted.ts',
        line: 9,
        message: 'Can\'t find reference to "PokemonDoc".',
      }),
    ]);
  });

  it('resolves documents in mapped files with runExternalCode', async () => {
    const { files, diagnostics } = await check(true);
    // The mapped `.graphql` files are part of the program, but aren't checked,
    // since their mapper reports their diagnostics
    expect(files).toEqual([
      path.join('..', 'src', 'graphql.ts'),
      path.join('src', 'graphql.ts'),
      path.join('src', 'persisted.ts'),
    ]);
    // The first hash matches the mapped document, the second one doesn't
    expect(diagnostics).toEqual([
      {
        file: 'src/persisted.ts',
        line: 9,
        column: 47,
        code: 520103,
        message: "The persisted document's hash is outdated",
      },
    ]);
  });
});
