import path from 'node:path';
import fs from 'node:fs';
import { getLanguageFeature } from './languageFeatures';
import type { Position } from './languageFeatures';
import { clearGraphQLDiagnosticsCache } from './diagnostics';

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

export interface LanguageServerFeatureResult {
  text: string;
  result: any;
}
export interface LanguageServerSession {
  request(
    method: string,
    fileName: string,
    params: any
  ): Promise<LanguageServerFeatureResult | null>;
  hover(
    fileName: string,
    position: Position
  ): Promise<LanguageServerFeatureResult | null>;
  complete(
    fileName: string,
    position: Position
  ): Promise<LanguageServerFeatureResult | null>;
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
  ready?: boolean;
  stopWatching(): void;
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
  if (relay) {
    // API.close() releases retained files and snapshots before client.close().
    // Drain at that final boundary, while the underlying channel is usable.
    const client = api.client;
    const close = client.close.bind(client);
    let closed = false;
    client.close = () => {
      if (closed) return;
      closed = true;
      try {
        relay!.drain(client);
      } catch (error) {
        logger(`API relay already closed while draining: ${error}`);
      } finally {
        close();
      }
    };
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
    const stopWatching: (() => void)[] = [];
    state = {
      host,
      program: undefined,
      schema: loadSchema(host, logger, {
        rootPath: path.dirname(plugin.configPath),
        // @gql.tada/internal's watcher depends on the legacy TypeScript sys API.
        // Sessions own portable Node watchers instead.
        watch: false,
        persist: options.persist !== false,
        onChange: options.onSchemaChange,
      }),
      stopWatching: () => {
        for (const stop of stopWatching) stop();
      },
    };
    const ownedState = state;
    void state.schema.ready.then(() => {
      if (disposed) return;
      for (const schemaPath of ownedState.schema.sourceLocations.values()) {
        const changed = () => ownedState.schema.checkStale(true);
        fs.watchFile(schemaPath, { persistent: false, interval: 500 }, changed);
        stopWatching.push(() => fs.unwatchFile(schemaPath, changed));
      }
    });
    projects.set(configFileName, state);
    return state;
  };

  let disposed = false;
  let queue: Promise<unknown> = Promise.resolve();
  const run = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(() => {
      if (disposed) throw new Error('GraphQLSP session is disposed');
      return operation();
    });
    queue = result.catch(() => {});
    return result;
  };
  const withProject = async (
    fileName: string,
    callback: (state: ProjectState, text: string) => any
  ): Promise<any> => {
    let snapshot = api.getCurrentLanguageServerSnapshot();
    try {
      let project = snapshot.getDefaultProjectForFile(fileName);
      if (!project || !project.configFileName) return null;
      const state = getProjectState(project.configFileName);
      if (!state) return null;

      if (!state.ready) {
        // While the schema loads, the language server may receive changes
        await state.schema.ready;
        state.ready = true;
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
        getSourceFiles: () =>
          program
            .getSourceFileNames()
            .map((name: string) => program.getSourceFile(name))
            .filter(Boolean),
      };

      const previousTypeScript = ts;
      const template = state.host.config.template;
      const hadTemplate = templates.has(template);
      if (template) templates.add(template);
      init({ typescript });
      try {
        clearGraphQLDiagnosticsCache();
        return callback(state, source.text);
      } finally {
        init({ typescript: previousTypeScript });
        if (template && !hadTemplate) templates.delete(template);
        state.program = undefined;
      }
    } finally {
      snapshot.dispose();
    }
  };
  const request = (method: string, fileName: string, params: any) =>
    run(() =>
      withProject(fileName, (state, text) => ({
        text,
        result:
          getLanguageFeature(
            method,
            params,
            fileName,
            text,
            state.schema,
            state.host
          ) ?? null,
      }))
    );
  return {
    check: fileName =>
      run(() =>
        withProject(fileName, (state, text) => ({
          text,
          diagnostics: toCheckDiagnostics(
            fileName,
            getGraphQLDiagnostics(fileName, state.schema, state.host) || []
          ),
        }))
      ),
    request,
    hover: (fileName, position) =>
      request('textDocument/hover', fileName, { position }),
    complete: (fileName, position) =>
      request('textDocument/completion', fileName, { position }),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const state of projects.values()) state?.stopWatching();
      projects.clear();
      try {
        api.close();
      } finally {
        if (relay) relay.dispose();
      }
    },
  };
}
