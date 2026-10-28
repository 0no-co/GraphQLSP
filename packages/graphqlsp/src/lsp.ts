import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fork, spawn, type ChildProcess } from 'node:child_process';
import {
  createLanguageServerSession,
  type LanguageServerSession,
} from './session';
import {
  featureMethods,
  fileNameFromURI,
  offsetAt,
  rangeAt,
} from './languageFeatures';
import { readMessages, writeMessage } from './lspProtocol';
import type { Message } from './lspProtocol';

const log = (message: unknown) =>
  process.stderr.write(`[graphqlsp] ${message}\n`);
const debug = (message: string) => {
  if (process.env.GRAPHQLSP_RELAY_DEBUG) log(message);
};

/** Worker IPC keeps synchronous checker calls off the forwarding event loop. */
async function runWorker(): Promise<void> {
  let closing = false;
  let queue: Promise<void> = Promise.resolve();
  const send = (message: any) => {
    if (!process.connected) return;
    // IPC can close between connected and send; the callback owns that error.
    try {
      process.send?.(message, () => {});
    } catch {}
  };
  const session: Promise<LanguageServerSession> = createLanguageServerSession({
    packageJsonPath: process.env.GRAPHQLSP_TS7_PACKAGE_JSON!,
    pipe: process.env.GRAPHQLSP_TS7_PIPE!,
    logger: log,
    persist: process.env.GRAPHQLSP_PERSIST !== '0',
    onSchemaChange: () => {
      if (!closing) send({ type: 'schemaChange' });
    },
  });
  const stop = () => {
    if (closing) return;
    closing = true;
    debug('worker: stop received, waiting for queued handlers');
    void queue.then(async () => {
      debug('worker: queued handlers drained; disposing session');
      try {
        (await session).dispose();
        debug('worker: session disposal completed');
      } catch (error) {
        log(error);
      }
      if (process.connected) {
        try {
          debug('worker: sending closed acknowledgement');
          process.send?.({ type: 'closed' }, () => process.exit(0));
        } catch {
          process.exit(0);
        }
      } else process.exit(0);
    });
  };
  process.once('disconnect', stop);
  process.on('message', (message: any) => {
    if (message.type === 'stop') {
      stop();
      return;
    }
    if (closing) return;
    queue = queue.then(async () => {
      try {
        const active = await session;
        const result =
          message.method === 'check'
            ? await active.check(message.fileName)
            : await active.request(
                message.method,
                message.fileName,
                message.params
              );
        if (!closing) send({ id: message.id, result });
      } catch (error) {
        if (!closing) send({ id: message.id, error: String(error) });
      }
    });
  });
  await session;
  if (!process.connected) stop();
  else if (!closing) send({ type: 'ready' });
}

export async function runLanguageServer(): Promise<void> {
  if (process.argv.includes('--session-worker')) return runWorker();
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write(
      'Usage: graphqlsp --stdio [--typescript /path/to/typescript] [--runExternalCode]\n'
    );
    return;
  }
  const option = args.indexOf('--typescript');
  if (option >= 0 && (!args[option + 1] || args[option + 1]!.startsWith('--')))
    throw new Error(
      '--typescript requires a package directory or package.json'
    );
  const packageJsonPath = fs.realpathSync(
    option >= 0
      ? path.resolve(
          args[option + 1]!,
          ...(args[option + 1]!.endsWith('.json') ? [] : ['package.json'])
        )
      : createRequire(path.join(process.cwd(), 'package.json')).resolve(
          'typescript/package.json'
        )
  );
  const manifest = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const [major, minor] = manifest.version.split('.').map(Number);
  if (major < 7 || (major === 7 && minor < 1))
    throw new Error(
      'The GraphQLSP LSP proxy requires TypeScript 7.1 or newer.'
    );
  const bin =
    typeof manifest.bin === 'string' ? manifest.bin : manifest.bin.tsc;
  const server = spawn(
    process.execPath,
    [
      path.resolve(path.dirname(packageJsonPath), bin),
      '--lsp',
      '--stdio',
      ...(args.includes('--runExternalCode') ? ['--runExternalCode'] : []),
    ],
    { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true }
  );
  const documents = new Map<string, { text: string; version: number }>();
  const nativeRequests = new Map<string | number, Message>();
  const internal = new Map<string, (message: Message) => void>();
  const pending = new Map<
    number,
    { resolve: (value: any) => void; timeout: NodeJS.Timeout }
  >();
  const timers = new Map<string, NodeJS.Timeout>();
  const graphqlDiagnostics = new Map<string, any[]>();
  const nativeDiagnostics = new Map<string, Message>();
  const cancelled = new Set<string | number>();
  const augmenting = new Set<string | number>();
  const requestDocuments = new Map<
    string | number,
    Map<string, { text: string; version: number }>
  >();
  const internalPrefix = `graphqlsp-${randomUUID()}-`;
  const uriKey = (uri: string) => {
    const file = fileNameFromURI(uri) || uri;
    return process.platform === 'win32' ? file.toLowerCase() : file;
  };
  let worker: ChildProcess | undefined,
    seq = 0,
    stopped = false;
  let shuttingDown = false;
  let shutdownRequest: Message | undefined;
  let shutdownAnswered = false;
  let shutdownTimeout: NodeJS.Timeout | undefined;
  let ready: Promise<void> = Promise.resolve();
  const native = (message: Message) => writeMessage(server.stdin!, message);
  const client = (message: Message) => writeMessage(process.stdout, message);
  const answerShutdown = (reply?: Message) => {
    if (shutdownAnswered || !shutdownRequest || stopped) return;
    shutdownAnswered = true;
    clearTimeout(shutdownTimeout);
    nativeRequests.delete(shutdownRequest.id!);
    client(reply || { jsonrpc: '2.0', id: shutdownRequest.id, result: null });
  };
  const synchronizeDocument = (uri: string): Promise<void> =>
    new Promise(resolve => {
      if (stopped || shuttingDown) {
        resolve();
        return;
      }
      const id = `${internalPrefix}sync-${++seq}`;
      const timeout = setTimeout(() => {
        debug('parent: worker stop timed out; forcing termination');
        internal.delete(id);
        resolve();
      }, 5000);
      internal.set(id, () => {
        clearTimeout(timeout);
        resolve();
      });
      native({
        jsonrpc: '2.0',
        id,
        method: 'textDocument/hover',
        params: { textDocument: { uri }, position: { line: 0, character: 0 } },
      });
    });
  const clearPending = () => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timeout);
      entry.resolve(null);
    }
    pending.clear();
  };
  let workerStop: Promise<void> | undefined;
  const stopWorker = (): Promise<void> =>
    (workerStop ??= new Promise(resolve => {
      clearPending();
      const child = worker;
      worker = undefined;
      if (!child || child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      const timeout = setTimeout(() => {
        child.kill();
        resolve();
      }, 2000);
      child.once('exit', () => {
        debug('parent: worker exited');
        clearTimeout(timeout);
        resolve();
      });
      if (child.connected) debug('parent: sending stop to worker');
      if (child.connected)
        child.send({ type: 'stop' }, error => {
          if (error) child.kill();
        });
      else child.kill();
    }));
  const ask = async (
    method: string,
    fileName: string,
    params?: any
  ): Promise<any> => {
    await ready;
    if (!worker?.connected || stopped || shuttingDown) return null;
    return new Promise(resolve => {
      const id = ++seq;
      const timeout = setTimeout(() => {
        pending.delete(id);
        resolve(null);
      }, 10000);
      pending.set(id, { resolve, timeout });
      worker!.send({ id, method, fileName, params });
    });
  };
  const publish = (uri: string) => {
    const document = documents.get(uri);
    const original = nativeDiagnostics.get(uri);
    // Don't attach diagnostics for an old native snapshot to newer edits.
    const diagnostics =
      original &&
      (original.params.version == null ||
        original.params.version === document?.version)
        ? original.params.diagnostics
        : [];
    client({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri,
        version: document?.version,
        diagnostics: [...diagnostics, ...(graphqlDiagnostics.get(uri) || [])],
      },
    });
  };
  const schedule = (uri: string, delay = 250) => {
    if (stopped || shuttingDown) return;
    clearTimeout(timers.get(uri));
    timers.set(
      uri,
      setTimeout(async () => {
        timers.delete(uri);
        const document = documents.get(uri),
          fileName = fileNameFromURI(uri);
        if (!document || !fileName || stopped || shuttingDown) return;
        await synchronizeDocument(uri);
        const result = await ask('check', fileName);
        if (documents.get(uri) !== document || stopped || shuttingDown) return;
        if (result && result.text !== document.text) {
          schedule(uri, 100);
          return;
        }
        graphqlDiagnostics.set(
          uri,
          (result?.diagnostics || []).map((diagnostic: any) => ({
            range: rangeAt(document.text, diagnostic),
            message: diagnostic.message,
            code: diagnostic.code,
            source: 'graphqlsp',
            severity:
              { error: 1, warning: 2, suggestion: 4, message: 3 }[
                diagnostic.severity as string
              ] || 3,
          }))
        );
        publish(uri);
      }, delay)
    );
  };
  const startWorker = () => {
    if (stopped || shuttingDown) return;
    const id = `${internalPrefix}api-${++seq}`;
    ready = new Promise<void>(resolve => {
      const timeout = setTimeout(() => {
        internal.delete(id);
        log('Timed out opening the TypeScript API session');
        resolve();
      }, 10000);
      internal.set(id, message => {
        clearTimeout(timeout);
        if (stopped || shuttingDown) {
          resolve();
          return;
        }
        if (message.error) {
          log(message.error.message);
          resolve();
          return;
        }
        worker = fork(process.argv[1]!, ['--session-worker'], {
          env: {
            ...process.env,
            NODE_PATH: [
              path.dirname(path.dirname(packageJsonPath)),
              process.env.NODE_PATH,
            ]
              .filter(Boolean)
              .join(path.delimiter),
            GRAPHQLSP_TS7_PACKAGE_JSON: packageJsonPath,
            GRAPHQLSP_TS7_PIPE: message.result.pipe,
            GRAPHQLSP_PERSIST: args.includes('--no-persist') ? '0' : '1',
          },
          stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
          execArgv: [],
        });
        const startup = setTimeout(() => {
          log('GraphQLSP worker startup timed out');
          worker?.kill();
          resolve();
        }, 10000);
        worker.on('message', (response: any) => {
          if (response.type === 'ready') {
            clearTimeout(startup);
            resolve();
            for (const uri of documents.keys()) schedule(uri, 0);
          } else if (response.type === 'schemaChange') {
            for (const uri of documents.keys()) schedule(uri, 0);
          } else {
            const entry = pending.get(response.id);
            if (entry) {
              clearTimeout(entry.timeout);
              pending.delete(response.id);
              if (response.error) log(response.error);
              entry.resolve(response.result ?? null);
            }
          }
        });
        worker.on('error', error => log(error));
        worker.on('exit', () => {
          clearTimeout(startup);
          clearPending();
          resolve();
        });
      });
      native({
        jsonrpc: '2.0',
        id,
        method: 'custom/initializeAPISession',
        params: {},
      });
    });
  };
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(shutdownTimeout);
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    for (const resolve of internal.values())
      resolve({ error: { message: 'Proxy closed' } });
    internal.clear();
    void stopWorker();
    server.kill();
    process.stdin.destroy();
  };
  readMessages(
    process.stdin,
    message => {
      if (message.method === 'exit') {
        process.exitCode = shutdownAnswered ? 0 : 1;
        cleanup();
        return;
      }
      if (shutdownAnswered || (shuttingDown && message.method)) {
        if (message.id != null && message.method)
          client({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32600, message: 'Server is shutting down' },
          });
        return;
      }
      // TypeScript currently rejects explicit null params on lifecycle messages.
      if (
        (message.method === 'shutdown' || message.method === 'exit') &&
        message.params === null
      )
        delete message.params;
      if (
        message.method === '$/cancelRequest' &&
        (nativeRequests.has(message.params.id) ||
          augmenting.has(message.params.id))
      )
        cancelled.add(message.params.id);
      if (message.method === 'textDocument/didOpen') {
        const doc = message.params.textDocument;
        documents.set(doc.uri, { text: doc.text, version: doc.version });
        schedule(doc.uri);
      }
      if (message.method === 'textDocument/didChange') {
        const uri = message.params.textDocument.uri,
          previous = documents.get(uri);
        if (previous) {
          let text = previous.text;
          for (const change of message.params.contentChanges)
            text = change.range
              ? text.slice(0, offsetAt(text, change.range.start)) +
                change.text +
                text.slice(offsetAt(text, change.range.end))
              : change.text;
          documents.set(uri, {
            text,
            version: message.params.textDocument.version,
          });
          graphqlDiagnostics.delete(uri);
          schedule(uri);
        }
      }
      if (message.method === 'textDocument/didSave')
        schedule(message.params.textDocument.uri, 0);
      if (message.method === 'textDocument/didClose') {
        const uri = message.params.textDocument.uri;
        clearTimeout(timers.get(uri));
        timers.delete(uri);
        documents.delete(uri);
        graphqlDiagnostics.delete(uri);
        nativeDiagnostics.delete(uri);
        client({
          jsonrpc: '2.0',
          method: 'textDocument/publishDiagnostics',
          params: { uri, diagnostics: [] },
        });
      }
      if (message.id != null && message.method) {
        if (
          message.method === 'completionItem/resolve' &&
          message.params?.data?.graphqlsp === internalPrefix
        ) {
          client({ jsonrpc: '2.0', id: message.id, result: message.params });
          return;
        }
        nativeRequests.set(message.id, message);
        if (featureMethods.has(message.method))
          requestDocuments.set(message.id, new Map(documents));
      }
      if (message.method === 'shutdown') {
        shuttingDown = true;
        shutdownRequest = message;
        for (const timer of timers.values()) clearTimeout(timer);
        timers.clear();
        // Native shutdown waits for API sessions. Close ours first, while
        // retaining the LSP forwarding loop for the shutdown response.
        void stopWorker().then(() => {
          debug('parent: forwarding native shutdown');
          if (stopped) return;
          shutdownTimeout = setTimeout(() => {
            // TS 7.1 can deadlock in API-session cleanup after transport drain.
            // Acknowledge our shutdown, terminate the in-memory child, and keep
            // the wrapper alive until the client sends exit.
            if (shutdownAnswered || stopped) return;
            log(
              'Native TypeScript shutdown did not complete in 2s; terminating its process after GraphQL worker cleanup.'
            );
            answerShutdown();
            server.kill();
          }, 2000);
          native(message);
        });
        return;
      }
      native(message);
      if (message.method === 'initialized') startWorker();
    },
    error => {
      log(error);
      cleanup();
    }
  );
  readMessages(
    server.stdout!,
    message => {
      if (
        !message.method &&
        shutdownAnswered &&
        message.id === shutdownRequest?.id
      )
        return;
      if (typeof message.id === 'string' && internal.has(message.id)) {
        const resolve = internal.get(message.id)!;
        internal.delete(message.id);
        resolve(message);
        return;
      }
      if (message.method === 'textDocument/publishDiagnostics') {
        nativeDiagnostics.set(message.params.uri, message);
        publish(message.params.uri);
        return;
      }
      if (message.method || message.id == null) {
        client(message);
        return;
      }
      const request = nativeRequests.get(message.id);
      if (request?.method === 'shutdown') {
        debug('parent: received native shutdown response');
        answerShutdown(message);
        return;
      }
      nativeRequests.delete(message.id);
      const versions = requestDocuments.get(message.id);
      requestDocuments.delete(message.id);
      if (request?.method === 'initialize' && message.result) {
        Object.assign(message.result.capabilities, {
          hoverProvider: true,
          completionProvider: {
            ...message.result.capabilities.completionProvider,
            triggerCharacters: [
              ...new Set([
                ...(message.result.capabilities.completionProvider
                  ?.triggerCharacters || []),
                '.',
                '@',
                '$',
              ]),
            ],
          },
          definitionProvider: true,
          referencesProvider: true,
          renameProvider: { prepareProvider: true },
          codeActionProvider: {
            ...(typeof message.result.capabilities.codeActionProvider ===
            'object'
              ? message.result.capabilities.codeActionProvider
              : {}),
            codeActionKinds: [
              ...new Set([
                ...(message.result.capabilities.codeActionProvider
                  ?.codeActionKinds || []),
                'quickfix',
                'refactor.extract',
              ]),
            ],
          },
        });
        client(message);
        return;
      }
      if (!request || !featureMethods.has(request.method!)) {
        cancelled.delete(message.id);
        client(message);
        return;
      }
      const uri = request.params?.textDocument?.uri,
        document = versions?.get(uri),
        fileName = fileNameFromURI(uri || '');
      if (!document || !fileName) {
        cancelled.delete(message.id);
        client(message);
        return;
      }
      augmenting.add(message.id);
      void (async () => {
        let response: any;
        for (let retry = 0; retry < 20; retry++) {
          if (
            cancelled.has(message.id!) ||
            documents.get(uri) !== document ||
            stopped
          )
            break;
          response = await ask(request.method!, fileName, request.params);
          if (!response || response.text === document.text) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (stopped || shutdownAnswered) return;
        if (cancelled.delete(message.id!)) {
          client({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32800, message: 'Request cancelled' },
          });
          return;
        }
        if (documents.get(uri) !== document) {
          client({
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32801, message: 'Document changed' },
          });
          return;
        }
        if (response?.text === document.text && response.result != null) {
          if (request.method === 'textDocument/completion') {
            for (const item of response.result.items)
              item.data = { graphqlsp: internalPrefix };
          }
          const edits =
            response.result.changes ||
            (Array.isArray(response.result)
              ? Object.assign(
                  {},
                  ...response.result.map((action: any) => action.edit?.changes)
                )
              : undefined);
          if (
            edits &&
            Object.keys(edits).some(uri => {
              const openURI =
                [...documents.keys(), ...(versions?.keys() || [])].find(
                  open => uriKey(open) === uriKey(uri)
                ) || uri;
              return documents.get(openURI) !== versions?.get(openURI);
            })
          ) {
            client({
              jsonrpc: '2.0',
              id: message.id,
              error: { code: -32801, message: 'An edited document changed' },
            });
            return;
          }
          const result =
            request.method === 'textDocument/codeAction'
              ? [...(message.result || []), ...response.result]
              : response.result;
          client({ jsonrpc: '2.0', id: message.id, result });
        } else client(message);
      })()
        .catch(error => {
          log(error);
          client(message);
        })
        .finally(() => {
          augmenting.delete(message.id!);
          cancelled.delete(message.id!);
        });
    },
    error => {
      log(error);
      cleanup();
    }
  );
  server.on('error', error => {
    log(error);
    cleanup();
    process.exitCode = 1;
  });
  server.on('exit', code => {
    if (stopped) return;
    if (shuttingDown) {
      void stopWorker().then(() => answerShutdown());
      return;
    }
    cleanup();
    process.exitCode = code || 0;
    process.stdin.destroy();
  });
  server.stdin!.on('error', error => {
    if (shuttingDown) return;
    if (!stopped) log(error);
    cleanup();
  });
  process.stdout.on('error', cleanup);
  process.stdin.on('end', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
}
