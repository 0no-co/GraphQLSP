import * as vscode from 'vscode';
import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';

import type { CheckDiagnostic } from '@0no-co/graphqlsp/check';
import type { ServerMessage, ServerRequest } from './server';

/** TypeScript 7's VS Code extensions: the release, and nightly builds. */
const typescript7ExtensionIds = [
  'TypeScriptTeam.native-preview',
  'TypeScriptTeam.vscode-typescript-nightly',
];

const languageIds = new Set([
  'javascript',
  'javascriptreact',
  'typescript',
  'typescriptreact',
]);

/** Changes are checked once typing pauses for this long. */
const changeDelay = 250;
/** Retries while TypeScript hasn't received an editor's latest changes yet. */
const staleRetryDelay = 100;
const maxStaleRetries = 20;

// A subset of the `ExtensionAPI` and `TypeScriptSDK` types of `typescript/vscode`
interface TypeScriptSDK {
  readonly version: string;
  readonly packageJsonPath: string | undefined;
  initializeAPIConnection(pipe?: string): Promise<string>;
}

interface TypeScript7ExtensionAPI {
  onLanguageServerInitialized(
    listener: (sdk: TypeScriptSDK) => unknown
  ): vscode.Disposable;
}

const severities: Record<
  CheckDiagnostic['severity'],
  vscode.DiagnosticSeverity
> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  suggestion: vscode.DiagnosticSeverity.Hint,
  message: vscode.DiagnosticSeverity.Information,
};

/** Reports GraphQLSP's diagnostics while TypeScript 7's language server runs.
 *
 * @remarks
 * TypeScript 7 doesn't load TypeScript server plugins, so the plugin this
 * extension contributes doesn't run with it. Instead, once TypeScript 7's
 * extension initializes its language server, this connects to an API session
 * of it, which shares the language server's projects and the editors'
 * unsaved changes, and publishes GraphQLSP's diagnostics for open files.
 *
 * TODO: Hover information and completions, e.g. through TypeScript 7's
 * `registerLspMiddleware` for `textDocument/hover` and `textDocument/completion`.
 */
export function activateTypeScript7(context: vscode.ExtensionContext): void {
  let output: vscode.OutputChannel | undefined;
  const log = (message: string) => {
    output ??= vscode.window.createOutputChannel('GraphQLSP');
    output.appendLine(message);
  };

  for (const id of typescript7ExtensionIds) {
    const extension =
      vscode.extensions.getExtension<TypeScript7ExtensionAPI>(id);
    if (!extension) continue;

    let diagnostics: TypeScript7Diagnostics | undefined;
    context.subscriptions.push({ dispose: () => diagnostics?.dispose() });

    extension.activate().then(
      api => {
        if (typeof api?.onLanguageServerInitialized !== 'function') {
          log(`${id} doesn't provide TypeScript 7's extension API.`);
          return;
        }
        context.subscriptions.push(
          // Fires after every (re)start of the language server, after which
          // API sessions have to be recreated
          api.onLanguageServerInitialized(sdk => {
            diagnostics?.dispose();
            diagnostics = undefined;
            if (!sdk.packageJsonPath) {
              log(
                `TypeScript ${sdk.version} has no API package, so GraphQLSP's diagnostics are unavailable.`
              );
              return;
            }
            diagnostics = new TypeScript7Diagnostics(
              context,
              sdk as TypeScriptSDK & { packageJsonPath: string },
              log
            );
          })
        );
      },
      error => log(`Failed to activate ${id}: ${error}`)
    );
  }
}

class TypeScript7Diagnostics {
  #collection = vscode.languages.createDiagnosticCollection('graphqlsp');
  #disposables: vscode.Disposable[] = [this.#collection];
  #server: Promise<ChildProcess | undefined>;
  #timers = new Map<string, NodeJS.Timeout>();
  #pending = new Map<
    number,
    (message: ServerMessage & { type: 'result' }) => void
  >();
  #seq = 0;
  #disposed = false;

  constructor(
    context: vscode.ExtensionContext,
    sdk: TypeScriptSDK & { packageJsonPath: string },
    private log: (message: string) => void
  ) {
    this.#server = sdk.initializeAPIConnection().then(
      pipe => this.#startServer(context, sdk.packageJsonPath, pipe),
      error => {
        log(
          `Failed to open an API session of TypeScript ${sdk.version}: ${error}`
        );
        return undefined;
      }
    );

    this.#disposables.push(
      vscode.workspace.onDidOpenTextDocument(document =>
        this.#schedule(document, 0)
      ),
      vscode.workspace.onDidChangeTextDocument(event =>
        this.#schedule(event.document, changeDelay)
      ),
      vscode.workspace.onDidSaveTextDocument(document =>
        this.#schedule(document, 0)
      ),
      vscode.workspace.onDidCloseTextDocument(document => {
        this.#cancel(document);
        this.#collection.delete(document.uri);
      })
    );
    this.#checkAll();
  }

  #startServer(
    context: vscode.ExtensionContext,
    packageJsonPath: string,
    pipe: string
  ): ChildProcess | undefined {
    if (this.#disposed) return undefined;
    const server = fork(
      context.asAbsolutePath(path.join('dist', 'typescript7', 'server.js')),
      [],
      {
        cwd: path.dirname(packageJsonPath),
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          // Resolves `typescript` from the language server's installation
          NODE_PATH: [
            path.dirname(path.dirname(packageJsonPath)),
            process.env.NODE_PATH,
          ]
            .filter(Boolean)
            .join(path.delimiter),
          GRAPHQLSP_TS7_PACKAGE_JSON: packageJsonPath,
          GRAPHQLSP_TS7_PIPE: pipe,
        },
        execArgv: [],
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      }
    );
    server.stdout!.on('data', chunk => this.log(String(chunk).trimEnd()));
    server.stderr!.on('data', chunk => this.log(String(chunk).trimEnd()));
    server.on('message', (message: ServerMessage) => {
      if (message.type === 'log') {
        this.log(message.message);
      } else if (message.type === 'schemaChange') {
        this.#checkAll();
      } else if (message.type === 'result') {
        this.#pending.get(message.id)?.(message);
        this.#pending.delete(message.id);
      }
    });
    server.on('exit', code => {
      for (const resolve of this.#pending.values())
        resolve({ type: 'result', id: -1, error: `exited with ${code}` });
      this.#pending.clear();
      if (!this.#disposed) {
        this.log(`GraphQLSP's TypeScript 7 server exited (${code}).`);
        this.#collection.clear();
      }
    });
    return server;
  }

  #checkAll() {
    for (const document of vscode.workspace.textDocuments)
      this.#schedule(document, 0);
  }

  #cancel(document: vscode.TextDocument) {
    const key = document.uri.toString();
    clearTimeout(this.#timers.get(key));
    this.#timers.delete(key);
  }

  #schedule(document: vscode.TextDocument, delay: number, retries = 0) {
    if (
      this.#disposed ||
      document.uri.scheme !== 'file' ||
      !languageIds.has(document.languageId)
    ) {
      return;
    }
    this.#cancel(document);
    const key = document.uri.toString();
    this.#timers.set(
      key,
      setTimeout(() => {
        this.#timers.delete(key);
        this.#check(document, retries);
      }, delay)
    );
  }

  async #check(document: vscode.TextDocument, retries: number) {
    const server = await this.#server;
    if (!server || !server.connected || this.#disposed) return;

    const version = document.version;
    const id = ++this.#seq;
    const message = await new Promise<ServerMessage & { type: 'result' }>(
      resolve => {
        this.#pending.set(id, resolve);
        server.send({
          type: 'check',
          id,
          fileName: document.uri.fsPath,
        } satisfies ServerRequest);
      }
    );

    // Newer changes have been scheduled to be checked already
    if (this.#disposed || document.isClosed || document.version !== version) {
      return;
    } else if (message.error) {
      this.log(`Failed to check ${document.uri.fsPath}: ${message.error}`);
      return;
    } else if (!message.result) {
      this.#collection.delete(document.uri);
      return;
    } else if (message.result.text !== document.getText()) {
      // TypeScript hasn't received the editor's latest changes yet
      if (retries < maxStaleRetries)
        this.#schedule(document, staleRetryDelay, retries + 1);
      return;
    }

    this.#collection.set(
      document.uri,
      message.result.diagnostics.map(diagnostic => {
        const result = new vscode.Diagnostic(
          new vscode.Range(
            document.positionAt(diagnostic.start),
            document.positionAt(diagnostic.start + diagnostic.length)
          ),
          diagnostic.message,
          severities[diagnostic.severity]
        );
        result.code = diagnostic.code;
        result.source = 'graphqlsp';
        return result;
      })
    );
  }

  dispose() {
    this.#disposed = true;
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    for (const disposable of this.#disposables) disposable.dispose();
    this.#server.then(server => server?.kill());
  }
}
