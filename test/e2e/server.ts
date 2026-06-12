import { ChildProcess, fork } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import ts from 'typescript/lib/tsserverlibrary';

type Command = `${ts.server.protocol.CommandTypes}`;

export class TSServer {
  #server: ChildProcess;
  #seq = 0;
  #resolvePromise: (() => void) | undefined;
  #waitFor:
    | ((
        response: ts.server.protocol.Response | ts.server.protocol.Event
      ) => boolean)
    | undefined;

  responses: Array<ts.server.protocol.Response | ts.server.protocol.Event> = [];

  constructor(
    public projectPath: string,
    public options: { debugLog?: boolean } = {}
  ) {
    const tsserverPath = require.resolve('typescript/lib/tsserver');

    const server = fork(tsserverPath, ['--logVerbosity', 'verbose'], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      cwd: projectPath,
      env: {
        TSS_LOG:
          '-level verbose -traceToConsole false -logToFile true -file ./tsserver.log',
      },
    });

    if (!server?.stdout) {
      throw new Error('Failed to start tsserver');
    }

    server.stdout.setEncoding('utf-8');
    readline.createInterface({ input: server.stdout }).on('line', line => {
      if (!line.startsWith('{')) return;

      try {
        const data = JSON.parse(line);

        // tsserver emits normalized (forward-slash) paths; convert them to
        // platform-native paths so tests can compare against path.join output
        if (typeof data?.body?.file === 'string') {
          data.body.file = path.normalize(data.body.file);
        }

        this.responses.push(data);

        if (this.#resolvePromise && this.#waitFor?.(data)) {
          this.#resolvePromise();
          this.#waitFor = undefined;
          this.#resolvePromise = undefined;
        }

        if (options.debugLog) {
          console.log(data);
        }
      } catch (e) {
        console.error(e);
      }
    });

    this.#server = server;
  }

  sendCommand(command: Command, args?: Record<string, unknown>) {
    this.send({ command, arguments: args });
  }

  send(data: {}) {
    const request = JSON.stringify({
      seq: ++this.#seq,
      type: 'request',
      ...data,
    });

    this.#server.stdin?.write(`${request}\n`);
  }

  waitForResponse = (
    cb: (
      response: ts.server.protocol.Response | ts.server.protocol.Event
    ) => boolean,
    checkExisting = false
  ) => {
    if (checkExisting && this.responses.some(cb)) {
      return Promise.resolve();
    }

    this.#waitFor = cb;
    return new Promise<void>(resolve => {
      this.#resolvePromise = resolve;
    });
  };

  close() {
    this.#server.kill();
  }
}
