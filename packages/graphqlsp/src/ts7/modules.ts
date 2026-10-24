import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/** Packages implementing the TypeScript 7.1 API. */
export type CompilerName = 'typescript' | 'tsrs';

/** The TypeScript 7.1 API modules of a compiler package.
 *
 * @remarks
 * This is the only module that loads the TypeScript 7.1 API. Its export paths
 * and types haven't settled across releases yet, so they're typed loosely here
 * and everything else goes through these modules.
 */
export interface CompilerModules {
  kind: 'api';
  name: CompilerName;
  version: string;
  /** `typescript/sync`: the synchronous API client. */
  sync: any;
  /** `typescript/ast`: `SyntaxKind` and AST utilities. */
  ast: any;
  /** `typescript/ast/is`: node type guards. */
  is: any;
}

/** A TypeScript 5/6 installation, which still has the compiler API. */
export interface LegacyCompiler {
  kind: 'legacy';
  name: 'typescript';
  version: string;
  typescript: any;
}

export interface LoadCompilerOptions {
  /** Path the compiler package is resolved from, e.g. the `tsconfig.json` being checked. */
  from: string;
  /** Path of the compiler's `package.json` or package directory, to skip resolving it by name. */
  packagePath?: string;
}

// `typescript@7.1` exports its API as `typescript/sync` etc, while tsrs
// releases before 0.19 and earlier native previews export `<pkg>/unstable/sync`
const API_PREFIXES = ['./', './unstable/'];

const resolveTarget = (entry: unknown): string | undefined => {
  if (typeof entry === 'string') {
    return entry;
  } else if (entry && typeof entry === 'object') {
    const conditions = entry as Record<string, unknown>;
    for (const condition of ['import', 'node', 'default', 'require']) {
      const target = resolveTarget(conditions[condition]);
      if (target) return target;
    }
  }
  return undefined;
};

const findPackageJson = (options: LoadCompilerOptions, name: CompilerName) => {
  if (options.packagePath) {
    return path.basename(options.packagePath) === 'package.json'
      ? path.resolve(options.packagePath)
      : path.resolve(options.packagePath, 'package.json');
  }
  try {
    return createRequire(path.resolve(options.from)).resolve(
      `${name}/package.json`
    );
  } catch (_error) {
    throw new Error(
      `Could not find "${name}" from "${options.from}". ` +
        (name === 'tsrs'
          ? 'Install "tsrs" to check GraphQL documents with tsrs.'
          : 'Install "typescript" to check GraphQL documents.')
    );
  }
};

export const loadCompiler = async (
  name: CompilerName,
  options: LoadCompilerOptions
): Promise<CompilerModules | LegacyCompiler> => {
  const packageJsonPath = findPackageJson(options, name);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const exports = (packageJson && packageJson.exports) || {};
  const packageDir = path.dirname(packageJsonPath);

  const major = parseInt(packageJson.version, 10);
  if (packageJson.name === 'typescript' && major < 7) {
    return {
      kind: 'legacy',
      name: 'typescript',
      version: packageJson.version,
      typescript: createRequire(packageJsonPath)(packageDir),
    };
  }

  for (const prefix of API_PREFIXES) {
    const sync = resolveTarget(exports[`${prefix}sync`]);
    const ast = resolveTarget(exports[`${prefix}ast`]);
    const is = resolveTarget(exports[`${prefix}ast/is`]);
    if (!sync || !ast || !is) continue;
    const load = (target: string) =>
      import(pathToFileURL(path.resolve(packageDir, target)).href);
    const [syncModule, astModule, isModule] = await Promise.all([
      load(sync),
      load(ast),
      load(is),
    ]);
    return {
      kind: 'api',
      name: packageJson.name === 'tsrs' ? 'tsrs' : 'typescript',
      version: packageJson.version,
      sync: syncModule,
      ast: astModule,
      is: isModule,
    };
  }

  throw new Error(
    `"${packageJson.name}@${packageJson.version}" doesn't provide the TypeScript 7.1 API. ` +
      'Checking GraphQL documents requires TypeScript 5/6, "typescript@>=7.1", or "tsrs".'
  );
};
