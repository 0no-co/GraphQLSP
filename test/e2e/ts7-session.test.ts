import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestContext } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import {
  createLanguageServerSession,
  type LanguageServerSession,
} from '../../packages/graphqlsp/src/check';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const projectPath = path.resolve(__dirname, 'fixture-project-ts7');
const require = createRequire(path.join(projectPath, 'tsconfig.json'));

/** A minimal LSP client speaking to a TypeScript 7 language server over stdio. */
class LanguageServer {
  #process: ChildProcess;
  #buffer = Buffer.alloc(0);
  #seq = 0;
  #pending = new Map<number, (message: any) => void>();

  constructor(command: string, args: string[]) {
    this.#process = spawn(command, args, {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    this.#process.stdout!.on('data', (chunk: Buffer) => {
      this.#buffer = Buffer.concat([this.#buffer, chunk]);
      for (;;) {
        const headerEnd = this.#buffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) break;
        const header = this.#buffer.subarray(0, headerEnd).toString();
        const length = Number(/Content-Length: (\d+)/i.exec(header)![1]);
        if (this.#buffer.length < headerEnd + 4 + length) break;
        const body = this.#buffer.subarray(
          headerEnd + 4,
          headerEnd + 4 + length
        );
        this.#buffer = this.#buffer.subarray(headerEnd + 4 + length);
        this.#receive(JSON.parse(body.toString()));
      }
    });
  }

  #receive(message: any) {
    if (message.method && message.id != null) {
      // Requests from the server, e.g. `workspace/configuration`
      this.#write({
        jsonrpc: '2.0',
        id: message.id,
        result: message.method === 'workspace/configuration' ? [] : null,
      });
    } else if (message.id != null && this.#pending.has(message.id)) {
      this.#pending.get(message.id)!(message);
      this.#pending.delete(message.id);
    }
  }

  #write(message: object) {
    const body = Buffer.from(JSON.stringify(message));
    this.#process.stdin!.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.#process.stdin!.write(body);
  }

  request(method: string, params?: unknown): Promise<any> {
    const id = ++this.#seq;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, message =>
        message.error
          ? reject(new Error(message.error.message))
          : resolve(message.result)
      );
      this.#write(
        params === undefined
          ? { jsonrpc: '2.0', id, method }
          : { jsonrpc: '2.0', id, method, params }
      );
    });
  }

  notify(method: string, params?: unknown) {
    this.#write(
      params === undefined
        ? { jsonrpc: '2.0', method }
        : { jsonrpc: '2.0', method, params }
    );
  }

  async initialize() {
    await this.request('initialize', {
      processId: process.pid,
      rootUri: url.pathToFileURL(projectPath).href,
      workspaceFolders: [
        { uri: url.pathToFileURL(projectPath).href, name: 'fixture' },
      ],
      capabilities: {},
    });
    this.notify('initialized', {});
  }

  open(fileName: string, text: string) {
    this.notify('textDocument/didOpen', {
      textDocument: {
        uri: url.pathToFileURL(fileName).href,
        languageId: 'typescript',
        version: 1,
        text,
      },
    });
  }

  change(fileName: string, version: number, text: string) {
    this.notify('textDocument/didChange', {
      textDocument: { uri: url.pathToFileURL(fileName).href, version },
      contentChanges: [{ text }],
    });
  }

  async dispose() {
    try {
      await Promise.race([
        this.request('shutdown'),
        new Promise(resolve => setTimeout(resolve, 2_000)),
      ]);
      this.notify('exit');
    } finally {
      this.#process.kill();
    }
  }
}

const servers = [
  {
    label: 'TypeScript 7',
    name: 'typescript' as const,
    packageJsonPath: require.resolve('typescript-7/package.json'),
    args: ['--lsp', '--stdio'],
  },
  {
    label: 'tsrs',
    name: 'tsrs' as const,
    packageJsonPath: require.resolve('tsrs/package.json'),
    args: ['--lsp', '-stdio'],
  },
].filter(
  server =>
    !process.env.GRAPHQLSP_TS7_COMPILER ||
    process.env.GRAPHQLSP_TS7_COMPILER === server.name
);

describe.each(servers)('language server session with $label', server => {
  const fileName = path.join(projectPath, 'src/valid.ts');
  let languageServer: LanguageServer;
  let session: LanguageServerSession | undefined;
  // Set when the language server doesn't provide API sessions
  let unsupported: string | undefined;
  const requireSession = (context: TestContext) => {
    if (unsupported) context.skip(unsupported);
    return session!;
  };

  beforeAll(async () => {
    const packageJson = JSON.parse(
      fs.readFileSync(server.packageJsonPath, 'utf8')
    );
    const bin = path.resolve(
      path.dirname(server.packageJsonPath),
      Object.values<string>(packageJson.bin)[0]!
    );
    languageServer = new LanguageServer(process.execPath, [
      bin,
      ...server.args,
    ]);
    await languageServer.initialize();

    // The editor's unsaved text introduces a schema error into the otherwise valid file
    languageServer.open(
      fileName,
      fs
        .readFileSync(fileName, 'utf8')
        .replace('...pokemonFields', '...pokemonFields\n        nmae')
    );

    let pipe: string;
    try {
      ({ pipe } = await languageServer.request(
        'custom/initializeAPISession',
        {}
      ));
    } catch (error) {
      // tsrs doesn't implement API sessions yet
      if (!/not ported|MethodNotFound|not found/i.test(String(error)))
        throw error;
      unsupported = `${server.label}: ${error}`;
      return;
    }
    session = await createLanguageServerSession({
      compiler: server.name,
      packageJsonPath: server.packageJsonPath,
      pipe,
      persist: false,
    });
  }, 60_000);

  afterAll(async () => {
    session?.dispose();
    await languageServer?.dispose();
  });

  it("reports diagnostics for the editor's unsaved text", async context => {
    const result = await requireSession(context).check(fileName);
    expect(result).not.toBeNull();
    expect(result!.text).toContain('nmae');
    expect(
      result!.diagnostics.map(({ file, ...diagnostic }) => ({
        file: path.relative(projectPath, file),
        ...diagnostic,
      }))
    ).toMatchInlineSnapshot(`
      [
        {
          "code": 52001,
          "column": 9,
          "file": "src/valid.ts",
          "length": 5,
          "line": 11,
          "message": "Cannot query field "nmae" on type "Pokemon". Did you mean "name"?",
          "severity": "error",
          "start": 332,
        },
      ]
    `);
  }, 60_000);

  it("follows the editor's changes", async context => {
    const session = requireSession(context);
    languageServer.change(fileName, 2, fs.readFileSync(fileName, 'utf8'));
    // The language server applies changes asynchronously
    let result = await session.check(fileName);
    for (let i = 0; i < 50 && result!.text.includes('nmae'); i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      result = await session.check(fileName);
    }
    expect(result!.text).not.toContain('nmae');
    expect(result!.diagnostics).toEqual([]);
  }, 60_000);

  it('returns null for files outside of GraphQLSP projects', async context => {
    const session = requireSession(context);
    const outside = path.resolve(__dirname, 'ts7.test.ts');
    languageServer.open(outside, fs.readFileSync(outside, 'utf8'));
    expect(await session.check(outside)).toBeNull();
  }, 60_000);
});
