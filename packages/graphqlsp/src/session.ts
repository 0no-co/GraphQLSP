import path from 'node:path';

import { ts, init } from './ts';
import { templates } from './ast/templates';
import { loadSchema } from './graphql/getSchema';
import type { SchemaRef } from './graphql/getSchema';
import { getGraphQLDiagnostics } from './diagnostics';
import type { GraphQLSPHost, HostProgram } from './host';
import { loadCompiler } from './ts7/modules';
import type { CompilerName } from './ts7/modules';
import { createTypeScriptNamespace } from './ts7/namespace';
import { createChecker } from './ts7/checker';
import { readPluginConfig } from './ts7/config';
import { createAPIRelay } from './ts7/relay';
import type { APIRelay } from './ts7/relay';
import { toCheckDiagnostics } from './ts7/report';
import type { CheckDiagnostic } from './ts7/report';

export interface LanguageServerSessionOptions {
  /** Which compiler the language server runs: `typescript` (7.1+) or `tsrs`.
   * @defaultValue `'typescript'` */
  compiler?: CompilerName;
  /** The `package.json` of the TypeScript installation the language server runs,
   * e.g. the TypeScript 7 VS Code extension's `TypeScriptSDK.packageJsonPath`. */
  packageJsonPath: string;
  /** An API pipe of the language server, e.g. from the TypeScript 7 VS Code
   * extension's `TypeScriptSDK.initializeAPIConnection()`, or from its
   * `custom/initializeAPISession` request. */
  pipe: string;
  /** Receives GraphQLSP's log messages. */
  logger?: (message: string) => void;
  /** Whether to write gql.tada typings (`tadaOutputLocation`), as the
   * TypeScript 5/6 plugin does in editors.
   * @defaultValue `true` */
  persist?: boolean;
  /** Called after a project's schemas were reloaded, since diagnostics of
   * unchanged files may then change too. */
  onSchemaChange?: () => void;
}

export interface LanguageServerCheckResult {
  /** The text of the file the diagnostics were computed for. When it doesn't
   * match an editor's text, the language server hasn't caught up with the
   * editor's changes yet, and the diagnostics are outdated. */
  text: string;
  diagnostics: CheckDiagnostic[];
}

export interface LanguageServerSession {
  /** Reports GraphQLSP's diagnostics for a file in the language server's
   * current state, including unsaved changes it received from editors.
   * Returns `null` for files outside of projects configuring GraphQLSP. */
  check(fileName: string): Promise<LanguageServerCheckResult | null>;
  dispose(): void;
}

interface ProjectState {
  host: GraphQLSPHost;
  schema: SchemaRef;
  /** Swapped for the program of the snapshot a file is checked in. */
  program: HostProgram | undefined;
}

/** Runs GraphQLSP's diagnostics on a TypeScript 7.1 language server's
 * projects, through an API session connected to the language server.
 *
 * @remarks
 * TypeScript 7's language server doesn't load language service plugins, so
 * editor integrations can use this to report GraphQLSP's diagnostics next to
 * TypeScript's. Its API is synchronous, so this blocks while checking, and
 * should run in a separate process or worker, rather than e.g. in VS Code's
 * extension host.
 */
export async function createLanguageServerSession(
  options: LanguageServerSessionOptions
): Promise<LanguageServerSession> {
  const logger = options.logger || (() => {});
  const compiler = await loadCompiler(options.compiler || 'typescript', {
    from: options.packageJsonPath,
    packagePath: options.packageJsonPath,
  });
  if (compiler.kind !== 'api') {
    throw new Error(
      `TypeScript ${compiler.version} doesn't provide the TypeScript 7.1 API.`
    );
  }

  const { API } = compiler.sync;
  let relay: APIRelay | undefined;
  let api: any;
  try {
    api = API.fromLSPConnection({ pipe: options.pipe });
  } catch (error) {
    // TypeScript 7.1's sync client only spawns API servers, and doesn't
    // connect to pipes yet, so it's connected to the pipe through a relay
    if (!/not yet supported/i.test(String(error))) throw error;
    relay = createAPIRelay(options.pipe);
    try {
      api = API.fromLSPConnection({ tsserverPath: relay.tsserverPath });
    } catch (error) {
      relay.dispose();
      throw error;
    }
  }
  const typescript = createTypeScriptNamespace(compiler);
  const projects = new Map<string, ProjectState | null>();

  const getProjectState = (configFileName: string): ProjectState | null => {
    let state = projects.get(configFileName);
    if (state !== undefined) return state;

    const plugin = readPluginConfig(
      configPath => api.readConfigFile(configPath),
      configFileName
    );
    if (!plugin) {
      projects.set(configFileName, null);
      return null;
    }

    if (plugin.config.template) templates.add(plugin.config.template);
    const host: GraphQLSPHost = {
      config: plugin.config,
      languageService: {
        getProgram: () => (state ? state.program : undefined),
      },
      project: {
        getProjectName: () => configFileName,
        projectService: { logger: { info: logger } },
      },
    };
    state = {
      host,
      program: undefined,
      schema: loadSchema(host, logger, {
        rootPath: path.dirname(plugin.configPath),
        // Schemas are checked for changes on every check instead
        watch: false,
        persist: options.persist !== false,
        onChange: options.onSchemaChange,
      }),
    };
    projects.set(configFileName, state);
    return state;
  };

  return {
    async check(fileName) {
      let snapshot = api.getCurrentLanguageServerSnapshot();
      try {
        let project = snapshot.getDefaultProjectForFile(fileName);
        if (!project || !project.configFileName) return null;
        const state = getProjectState(project.configFileName);
        if (!state) return null;

        if (!state.schema.current && !Object.keys(state.schema.multi).length) {
          // While the schema loads, the language server may receive changes
          await state.schema.ready;
          snapshot.dispose();
          snapshot = api.getCurrentLanguageServerSnapshot();
          project = snapshot.getDefaultProjectForFile(fileName);
          if (!project) return null;
        }
        state.schema.checkStale();

        const source = project.program.getSourceFile(fileName);
        if (!source) return null;
        const program = project.program;
        const checker = createChecker(project.checker, project);
        state.program = {
          getSourceFile: (fileName: string) => program.getSourceFile(fileName),
          getTypeChecker: () => checker,
        };

        const previousTypeScript = ts;
        init({ typescript });
        try {
          const diagnostics =
            getGraphQLDiagnostics(fileName, state.schema, state.host) || [];
          return {
            text: source.text,
            diagnostics: toCheckDiagnostics(fileName, diagnostics),
          };
        } finally {
          init({ typescript: previousTypeScript });
          state.program = undefined;
        }
      } finally {
        snapshot.dispose();
      }
    },

    dispose() {
      projects.clear();
      try {
        api.close();
      } finally {
        if (relay) relay.dispose();
      }
    },
  };
}
