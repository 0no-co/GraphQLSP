/* Runs GraphQLSP's diagnostics on TypeScript 7's language server, through an
 * API session of it.
 *
 * TypeScript 7's API client is synchronous, so this runs in its own process
 * rather than in VS Code's extension host, and receives files to check from
 * the extension over Node's IPC channel. */

import type {
  LanguageServerCheckResult,
  LanguageServerSession,
} from '@0no-co/graphqlsp/check';

export type ServerRequest =
  | { type: 'stop' }
  | { type: 'check'; id: number; fileName: string }
  | {
      type: 'feature';
      id: number;
      fileName: string;
      method: string;
      params: any;
    };

export type ServerMessage =
  | {
      type: 'result';
      id: number;
      result?: any;
      error?: string;
    }
  | { type: 'schemaChange' }
  | { type: 'log'; message: string };

const send = (message: ServerMessage) => {
  if (!process.connected) return;
  try {
    process.send!(message, () => {});
  } catch {}
};
const log = (message: string) => send({ type: 'log', message });

const packageJsonPath = process.env.GRAPHQLSP_TS7_PACKAGE_JSON!;
const pipe = process.env.GRAPHQLSP_TS7_PIPE!;

// GraphQLSP's dependencies require `typescript`, which is resolved from
// TypeScript 7's installation through NODE_PATH. That only applies to
// CommonJS, so GraphQLSP's CommonJS build is required here
const session: Promise<LanguageServerSession> = new Promise(resolve => {
  const { createLanguageServerSession } =
    require('@0no-co/graphqlsp/check') as typeof import('@0no-co/graphqlsp/check');
  resolve(
    createLanguageServerSession({
      packageJsonPath,
      pipe,
      logger: log,
      onSchemaChange: () => send({ type: 'schemaChange' }),
    })
  );
});

session.then(
  () => log(`Connected to TypeScript's API session (${packageJsonPath})`),
  error => log(`Failed to connect to TypeScript's API session: ${error}`)
);

let closing = false;
let work: Promise<void> = Promise.resolve();
const stop = () => {
  if (closing) return;
  closing = true;
  void work
    .then(() => session)
    .then(session => session.dispose())
    .catch(error => process.stderr.write(String(error)))
    .finally(() => process.exit(0));
};
process.on('message', (request: ServerRequest) => {
  if (request.type === 'stop') {
    stop();
    return;
  }
  if (closing) return;
  if (request.type !== 'check' && request.type !== 'feature') return;
  work = work.then(async () => {
    try {
      const active = await session;
      const result =
        request.type === 'check'
          ? await active.check(request.fileName)
          : await active.request(
              request.method,
              request.fileName,
              request.params
            );
      if (!closing) send({ type: 'result', id: request.id, result });
    } catch (error) {
      if (!closing)
        send({ type: 'result', id: request.id, error: String(error) });
    }
  });
});

process.on('disconnect', stop);
