import path from 'node:path';

import { ts, init } from './ts';
import { templates } from './ast/templates';
import { loadSchema } from './graphql/getSchema';
import {
  clearGraphQLDiagnosticsCache,
  getGraphQLDiagnostics,
} from './diagnostics';
import type { GraphQLSPHost, HostProgram } from './host';
import { loadCompiler } from './ts7/modules';
import type {
  CompilerModules,
  CompilerName,
  LegacyCompiler,
} from './ts7/modules';
import { createTypeScriptNamespace } from './ts7/namespace';
import { createChecker } from './ts7/checker';
import { readPluginConfig } from './ts7/config';
import type { ReadConfigFile } from './ts7/config';
import { toCheckDiagnostics } from './ts7/report';
import type { CheckDiagnostic } from './ts7/report';

export type { CompilerName };
export type { CheckDiagnostic, CheckSeverity } from './ts7/report';
export { createLanguageServerSession } from './session';
export type {
  LanguageServerCheckResult,
  LanguageServerFeatureResult,
  LanguageServerSession,
  LanguageServerSessionOptions,
} from './session';

export interface CheckProjectOptions {
  /** Path of the `tsconfig.json` to check. */
  tsconfigPath: string;
  /** Which compiler to check with: `typescript` (5, 6, or 7.1+) or `tsrs`.
   * @defaultValue `'typescript'` */
  compiler?: CompilerName;
  /** Path of the compiler's `package.json` or package directory. By default,
   * `compiler` is resolved from the `tsconfigPath`. */
  compilerPath?: string;
  /** Files to check. Defaults to all of the project's non-declaration files
   * outside of `node_modules`. */
  files?: readonly string[];
  /** Receives GraphQLSP's log messages. */
  logger?: (message: string) => void;
  /** Runs the project's content mappers (`contentMappers` in its `tsconfig.json`),
   * like `tsc --runExternalCode`, so documents imported from mapped files (e.g.
   * `.graphql` files) are part of the program. Mappers are external processes,
   * so this is opt-in. Only applies to TypeScript 7.1+ and tsrs.
   * @defaultValue `false` */
  runExternalCode?: boolean;
}

export interface CheckProjectResult {
  compiler: { name: CompilerName; version: string };
  /** Absolute path of the checked `tsconfig.json`. */
  tsconfigPath: string;
  /** Absolute paths of the checked files. */
  files: string[];
  diagnostics: CheckDiagnostic[];
}

// Content-mapped files (e.g. `.graphql`) are part of the program as virtual
// TypeScript, but their mappers report their diagnostics, so only TypeScript
// and JavaScript files are checked
const isScriptFile = (fileName: string) => /\.[cm]?[jt]sx?$/.test(fileName);

const isCheckedFile = (fileName: string) =>
  isScriptFile(fileName) &&
  !/\.d\.[cm]?ts$/.test(fileName) &&
  !/[\\/]node_modules[\\/]/.test(fileName);

// GraphQLSP's modules share a single `ts` namespace, so checks run one at a time
let queue: Promise<unknown> = Promise.resolve();

/** Checks a project's GraphQL documents with TypeScript (5, 6, or 7.1+) or tsrs.
 *
 * @remarks
 * TypeScript 7 doesn't load language service plugins, so this runs
 * GraphQLSP's diagnostics on the TypeScript 7.1 API instead, reporting the
 * same diagnostics the TypeScript 5/6 plugin reports in editors. With
 * TypeScript 5/6, the project is loaded with its compiler API instead.
 *
 * The project's GraphQLSP plugin entry is read from its `tsconfig.json`.
 * Schemas are loaded once, without watching them, and gql.tada typings
 * aren't written.
 */
export function checkProject(
  options: CheckProjectOptions
): Promise<CheckProjectResult> {
  const result = queue.then(() => runCheck(options));
  queue = result.catch(() => {});
  return result;
}

interface OpenedProject {
  /** The `typescript` namespace GraphQLSP's modules run with. */
  typescript: typeof ts;
  program: HostProgram;
  /** The project's files that are checked by default. */
  fileNames: string[];
  dispose(): void;
}

interface ProjectLoader {
  readConfigFile: ReadConfigFile;
  open(tsconfigPath: string): OpenedProject;
  dispose(): void;
}

const createApiLoader = (
  modules: CompilerModules,
  tsconfigPath: string,
  runExternalCode: boolean
): ProjectLoader => {
  const api = new modules.sync.API({
    cwd: path.dirname(tsconfigPath),
    runExternalCode,
  });
  return {
    readConfigFile: configPath => api.readConfigFile(configPath),
    open(tsconfigPath) {
      const snapshot = api.createSnapshot({ openProjects: [tsconfigPath] });
      const project = snapshot.getConfiguredProject(tsconfigPath);
      if (!project) {
        throw new Error(`Could not load the project of "${tsconfigPath}".`);
      }
      const checker = createChecker(project.checker, project);
      return {
        typescript: createTypeScriptNamespace(modules),
        program: {
          getSourceFile: fileName => project.program.getSourceFile(fileName),
          getTypeChecker: () => checker,
        },
        fileNames: project.program.getSourceFileNames().filter(isCheckedFile),
        dispose() {
          snapshot.dispose();
        },
      };
    },
    dispose() {
      api.close();
    },
  };
};

const createLegacyLoader = (compiler: LegacyCompiler): ProjectLoader => {
  const typescript: typeof ts = compiler.typescript;
  return {
    readConfigFile: configPath =>
      typescript.readConfigFile(configPath, typescript.sys.readFile),
    open(tsconfigPath) {
      const parsed = typescript.getParsedCommandLineOfConfigFile(
        tsconfigPath,
        {},
        {
          ...typescript.sys,
          onUnRecoverableConfigFileDiagnostic(diagnostic) {
            throw new Error(
              typescript.flattenDiagnosticMessageText(
                diagnostic.messageText,
                '\n'
              )
            );
          },
        }
      );
      if (!parsed) {
        throw new Error(`Could not load the project of "${tsconfigPath}".`);
      }
      const program = typescript.createProgram({
        rootNames: parsed.fileNames,
        options: parsed.options,
        projectReferences: parsed.projectReferences,
      });
      return {
        typescript,
        program,
        fileNames: program
          .getSourceFiles()
          .map(source => source.fileName)
          .filter(isCheckedFile),
        dispose() {},
      };
    },
    dispose() {},
  };
};

async function runCheck(
  options: CheckProjectOptions
): Promise<CheckProjectResult> {
  const tsconfigPath = path.resolve(options.tsconfigPath);
  const logger = options.logger || (() => {});
  const compiler = await loadCompiler(options.compiler || 'typescript', {
    from: tsconfigPath,
    packagePath: options.compilerPath,
  });

  const loader =
    compiler.kind === 'api'
      ? createApiLoader(compiler, tsconfigPath, !!options.runExternalCode)
      : createLegacyLoader(compiler);
  const previousTypeScript = ts;
  let project: OpenedProject | undefined;
  let template: string | undefined;
  try {
    const plugin = readPluginConfig(loader.readConfigFile, tsconfigPath);
    if (!plugin) {
      throw new Error(
        `No GraphQLSP plugin entry was found in "${tsconfigPath}". ` +
          'Add "@0no-co/graphqlsp" or "gql.tada/ts-plugin" to its "compilerOptions.plugins".'
      );
    }

    project = loader.open(tsconfigPath);
    init({ typescript: project.typescript });
    clearGraphQLDiagnosticsCache();
    if (plugin.config.template && !templates.has(plugin.config.template)) {
      template = plugin.config.template;
      templates.add(template!);
    }

    const { program } = project;
    const host: GraphQLSPHost = {
      config: plugin.config,
      languageService: { getProgram: () => program },
      project: {
        getProjectName: () => tsconfigPath,
        projectService: { logger: { info: logger } },
      },
    };

    const schema = loadSchema(host, logger, {
      rootPath: path.dirname(plugin.configPath),
      watch: false,
      persist: false,
    });
    await schema.ready;

    const files = options.files
      ? options.files.map(file => path.resolve(file)).filter(isScriptFile)
      : project.fileNames;

    const diagnostics: CheckDiagnostic[] = [];
    const lineStartsByFile = new Map<string, number[]>();
    for (const file of files) {
      let fileDiagnostics: ts.Diagnostic[] | undefined;
      try {
        fileDiagnostics = getGraphQLDiagnostics(file, schema, host);
      } catch (error) {
        throw new Error(`Failed to check "${file}": ${error}`, {
          cause: error,
        });
      }

      diagnostics.push(
        ...toCheckDiagnostics(file, fileDiagnostics || [], lineStartsByFile)
      );
    }

    return {
      compiler: { name: compiler.name, version: compiler.version },
      tsconfigPath,
      files,
      diagnostics,
    };
  } finally {
    if (template) templates.delete(template);
    init({ typescript: previousTypeScript });
    if (project) project.dispose();
    loader.dispose();
  }
}
