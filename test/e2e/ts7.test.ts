import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import url from 'node:url';

import {
  checkProject,
  type CheckDiagnostic,
  type CompilerName,
} from '../../packages/graphqlsp/src/check';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const projectPath = path.resolve(__dirname, 'fixture-project-ts7');
const tsconfigPath = path.join(projectPath, 'tsconfig.json');
// The fixture project installs TypeScript 7 (as `typescript-7`) and tsrs,
// while the workspace's own `typescript` is TypeScript 5/6
const require = createRequire(tsconfigPath);
const workspaceRequire = createRequire(import.meta.url);

interface Compiler {
  label: string;
  name: CompilerName;
  packagePath: string;
}

// The TypeScript 7.1 API implementations to check with. CI installs other
// versions of these packages, and `GRAPHQLSP_TS7_COMPILER` selects one of them
const compilers: Compiler[] = [
  {
    label: 'TypeScript 7',
    name: 'typescript' as const,
    packagePath: require.resolve('typescript-7/package.json'),
  },
  {
    label: 'tsrs',
    name: 'tsrs' as const,
    packagePath: require.resolve('tsrs/package.json'),
  },
].filter(
  compiler =>
    !process.env.GRAPHQLSP_TS7_COMPILER ||
    process.env.GRAPHQLSP_TS7_COMPILER === compiler.name
);

const toSnapshot = (diagnostics: CheckDiagnostic[]) =>
  diagnostics
    .map(({ file, ...diagnostic }) => ({
      file: path.relative(projectPath, file),
      ...diagnostic,
    }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.start - b.start);

// The workspace's TypeScript 5/6 runs the same diagnostics through its
// compiler API, which TypeScript 7 has to report identically
const legacyDiagnostics = checkProject({
  tsconfigPath,
  compilerPath: workspaceRequire.resolve('typescript/package.json'),
}).then(result => toSnapshot(result.diagnostics));

describe('checkProject with TypeScript 5/6', () => {
  it('reports diagnostics for the fixture project', async () => {
    expect(await legacyDiagnostics).toMatchInlineSnapshot(`
      [
        {
          "code": 52003,
          "column": 25,
          "file": "src/colocation.ts",
          "length": 15,
          "line": 2,
          "message": "Unused co-located fragment definition(s) "pokemonFields" in './fragment.js'",
          "severity": "warning",
          "start": 64,
        },
        {
          "code": 52005,
          "column": 5,
          "file": "src/field-usage.ts",
          "length": 7,
          "line": 11,
          "message": "Field(s) 'pokemon.fleeRate' are not used.",
          "severity": "warning",
          "start": 302,
        },
        {
          "code": 52005,
          "column": 7,
          "file": "src/field-usage.ts",
          "length": 6,
          "line": 15,
          "message": "Field(s) 'pokemon.weight.maximum' are not used.",
          "severity": "warning",
          "start": 362,
        },
        {
          "code": 52001,
          "column": 7,
          "file": "src/invalid.ts",
          "length": 5,
          "line": 7,
          "message": "Cannot query field "nmae" on type "Pokemon". Did you mean "name"?",
          "severity": "error",
          "start": 145,
        },
        {
          "code": 52004,
          "column": 7,
          "file": "src/invalid.ts",
          "length": 15,
          "line": 8,
          "message": "The field Pokemon.classification is deprecated. And this is the reason why",
          "severity": "warning",
          "start": 156,
        },
        {
          "code": 52001,
          "column": 10,
          "file": "src/invalid.ts",
          "length": 16,
          "line": 9,
          "message": "Unknown fragment "missingFragment".",
          "severity": "error",
          "start": 180,
        },
      ]
    `);
  }, 60_000);
});

describe.each(compilers)('checkProject with $label', compiler => {
  it('reports the same diagnostics as TypeScript 5/6', async () => {
    const result = await checkProject({
      tsconfigPath,
      compiler: compiler.name,
      compilerPath: compiler.packagePath,
    });
    expect(result.compiler).toEqual({
      name: compiler.name,
      version: require(compiler.packagePath).version,
    });
    if (compiler.name === 'typescript')
      expect(parseInt(result.compiler.version, 10)).toBeGreaterThanOrEqual(7);
    expect(result.files.map(file => path.relative(projectPath, file)).sort())
      .toMatchInlineSnapshot(`
        [
          "src/colocation.ts",
          "src/field-usage.ts",
          "src/fragment.ts",
          "src/graphql.ts",
          "src/invalid.ts",
          "src/valid.ts",
        ]
      `);
    expect(toSnapshot(result.diagnostics)).toEqual(await legacyDiagnostics);
  }, 60_000);

  it('checks only the given files', async () => {
    const result = await checkProject({
      tsconfigPath,
      compiler: compiler.name,
      compilerPath: compiler.packagePath,
      files: [path.join(projectPath, 'src/valid.ts')],
    });
    expect(result.files).toEqual([path.join(projectPath, 'src/valid.ts')]);
    expect(result.diagnostics).toEqual([]);
  }, 60_000);
});
