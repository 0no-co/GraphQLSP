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
    this.#process.stdin!.on('error', error => {
      if ((error as NodeJS.ErrnoException).code !== 'EPIPE') throw error;
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
    (server.name !== 'tsrs' || process.platform !== 'win32') &&
    (!process.env.GRAPHQLSP_TS7_COMPILER ||
      process.env.GRAPHQLSP_TS7_COMPILER === server.name)
);

describe.each(servers)('language server session with $label', server => {
  const fileName = path.join(projectPath, 'src/valid.ts');
  let languageServer: LanguageServer;
  let session: LanguageServerSession | undefined;
  let schemaChanges = 0;
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
      onSchemaChange: () => {
        schemaChanges++;
      },
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
        file: path.relative(projectPath, file).replace(/\\/g, '/'),
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

  let version = 2;
  const changeText = async (session: LanguageServerSession, text: string) => {
    languageServer.change(fileName, ++version, text);
    await languageServer.request('textDocument/hover', {
      textDocument: { uri: url.pathToFileURL(fileName).href },
      position: { line: 0, character: 0 },
    });
    for (let attempt = 0; attempt < 30; attempt++) {
      if ((await session.check(fileName))?.text === text) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const actual = (await session.check(fileName))?.text;
    throw new Error(
      `Language server did not apply the edit: ${JSON.stringify({ actual, expected: text })}`
    );
  };
  const savedText = fs.readFileSync(fileName, 'utf8');
  const positionAt = (text: string, offset: number) => {
    const lines = text.slice(0, offset).split('\n');
    return {
      line: lines.length - 1,
      character: lines[lines.length - 1]!.length,
    };
  };

  it('provides hover and completions on unsaved documents with replacement ranges', async context => {
    const session = requireSession(context);
    const text = savedText.replace('        id', '        name\n        maxC');
    await changeText(session, text);
    const hover = await session.hover(
      fileName,
      positionAt(text, text.indexOf('        name') + 10)
    );
    expect(hover?.text).toBe(text);
    expect(hover?.result.contents.value).toContain('Pokemon.name');
    const offset = text.indexOf('maxC') + 4;
    const completion = await session.complete(
      fileName,
      positionAt(text, offset)
    );
    const maxCP = completion?.result.items.find(
      (item: any) => item.label === 'maxCP'
    );
    expect(maxCP?.textEdit.newText).toBe('maxCP');
    expect(maxCP?.textEdit.range).toEqual({
      start: positionAt(text, offset - 4),
      end: positionAt(text, offset),
    });
  }, 60_000);

  it('finds schema definitions, fragment references and rename edits across files', async context => {
    const session = requireSession(context);
    await changeText(session, savedText);
    const fieldPosition = positionAt(
      savedText,
      savedText.indexOf('        id') + 9
    );
    const definition = await session.request(
      'textDocument/definition',
      fileName,
      { position: fieldPosition }
    );
    expect(definition?.result[0].uri).toBe(
      url.pathToFileURL(path.join(projectPath, 'schema.graphql')).href
    );
    const position = positionAt(
      savedText,
      savedText.indexOf('...pokemonFields') + 4
    );
    const prepare = await session.request(
      'textDocument/prepareRename',
      fileName,
      { position }
    );
    expect(prepare?.result.placeholder).toBe('pokemonFields');
    const references = await session.request(
      'textDocument/references',
      fileName,
      { position, context: { includeDeclaration: true } }
    );
    expect(references?.result).toHaveLength(2);
    const renamed = await session.request('textDocument/rename', fileName, {
      position,
      newName: 'PokemonDetails',
    });
    expect(Object.keys(renamed?.result.changes)).toHaveLength(2);
    expect(
      Object.values<any[]>(renamed?.result.changes)
        .flat()
        .every(edit => edit.newText === 'PokemonDetails')
    ).toBe(true);
    expect(
      (
        await session.request('textDocument/rename', fileName, {
          position,
          newName: 'bad-name',
        })
      )?.result
    ).toBeNull();
  }, 60_000);

  it('offers typo fixes and an extract-to-fragment refactor', async context => {
    const session = requireSession(context);
    const text = savedText.replace('        id', '        nmae');
    await changeText(session, text);
    const start = positionAt(text, text.indexOf('nmae')),
      end = positionAt(text, text.indexOf('nmae') + 4);
    const fixes = await session.request('textDocument/codeAction', fileName, {
      range: { start, end },
      context: {
        diagnostics: [{ source: 'graphqlsp', code: 52001 }],
        only: ['quickfix'],
      },
    });
    expect(
      fixes?.result.some((action: any) => action.title.includes('name'))
    ).toBe(true);
    await changeText(session, savedText);
    const offset = savedText.indexOf('        id') + 8;
    const extracted = await session.request(
      'textDocument/codeAction',
      fileName,
      {
        range: {
          start: positionAt(savedText, offset),
          end: positionAt(savedText, offset + 2),
        },
        context: { diagnostics: [], only: ['refactor.extract'] },
      }
    );
    expect(extracted?.result[0].title).toBe('Extract to fragment');
    expect(
      extracted?.result[0].edit.changes[url.pathToFileURL(fileName).href]
    ).toHaveLength(3);
  }, 60_000);

  it('leaves ordinary TypeScript positions alone and serializes concurrent calls', async context => {
    const session = requireSession(context);
    const [hover, completion] = await Promise.all([
      session.hover(fileName, { line: 0, character: 10 }),
      session.complete(fileName, { line: 0, character: 10 }),
    ]);
    expect(hover?.result).toBeNull();
    expect(completion?.result).toBeNull();
  }, 60_000);
  it('reloads changed schemas and notifies the editor', async context => {
    const active = requireSession(context);
    const schemaPath = path.join(projectPath, 'schema.graphql');
    const original = fs.readFileSync(schemaPath, 'utf8');
    const previous = schemaChanges;
    try {
      fs.writeFileSync(
        schemaPath,
        original.replace(
          '  name: String!',
          '  newEditorField: String\n  name: String!'
        )
      );
      for (
        let attempt = 0;
        attempt < 100 && schemaChanges === previous;
        attempt++
      )
        await new Promise(resolve => setTimeout(resolve, 50));
      expect(schemaChanges).toBeGreaterThan(previous);
      const text = savedText.replace('        id', '        newEditorField');
      await changeText(active, text);
      const hover = await active.hover(
        fileName,
        positionAt(text, text.indexOf('newEditorField') + 3)
      );
      expect(hover?.result.contents.value).toContain('Pokemon.newEditorField');
    } finally {
      fs.writeFileSync(schemaPath, original);
      await changeText(active, savedText);
    }
  }, 60_000);

  it('awaits named schemas on the first request without a second editor change', async context => {
    requireSession(context);
    const directory = fs.mkdtempSync(path.join(projectPath, '.named-'));
    let fresh: LanguageServerSession | undefined;
    try {
      fs.writeFileSync(
        path.join(directory, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'es2022',
            module: 'nodenext',
            moduleResolution: 'nodenext',
            skipLibCheck: true,
            plugins: [
              {
                name: '@0no-co/graphqlsp',
                schemas: [
                  {
                    name: 'one',
                    schema: '../schema.graphql',
                    tadaOutputLocation: './introspection.d.ts',
                  },
                ],
              },
            ],
          },
          include: ['*.ts'],
        })
      );
      fs.writeFileSync(
        path.join(directory, 'introspection.d.ts'),
        fs
          .readFileSync(
            path.join(projectPath, 'src/introspection.d.ts'),
            'utf8'
          )
          .replace(/^  name: never;$/m, "  name: 'one';")
      );
      const text =
        "import { initGraphQLTada } from 'gql.tada';\nimport type { introspection } from './introspection.js';\nconst graphql = initGraphQLTada<{ introspection: introspection }>();\nconst query = graphql(`query { pokemons(limit: 1) { nmae } }`);\n";
      const namedFile = path.join(directory, 'query.ts');
      fs.writeFileSync(namedFile, text);
      languageServer.open(namedFile, text);
      await languageServer.request('textDocument/hover', {
        textDocument: { uri: url.pathToFileURL(namedFile).href },
        position: { line: 0, character: 0 },
      });
      const { pipe } = await languageServer.request(
        'custom/initializeAPISession',
        {}
      );
      fresh = await createLanguageServerSession({
        compiler: server.name,
        packageJsonPath: server.packageJsonPath,
        pipe,
        persist: false,
      });
      const result = await fresh.check(namedFile);
      expect(result?.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: expect.stringContaining('nmae') }),
        ])
      );
    } finally {
      fresh?.dispose();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('returns null for files outside of GraphQLSP projects', async context => {
    const session = requireSession(context);
    const outside = path.resolve(__dirname, 'ts7.test.ts');
    languageServer.open(outside, fs.readFileSync(outside, 'utf8'));
    expect(await session.check(outside)).toBeNull();
  }, 60_000);

  it('reconnects after the language server restarts', async context => {
    requireSession(context).dispose();
    await languageServer.dispose();
    const manifest = JSON.parse(
      fs.readFileSync(server.packageJsonPath, 'utf8')
    );
    const bin = path.resolve(
      path.dirname(server.packageJsonPath),
      Object.values<string>(manifest.bin)[0]!
    );
    languageServer = new LanguageServer(process.execPath, [
      bin,
      ...server.args,
    ]);
    await languageServer.initialize();
    languageServer.open(fileName, savedText);
    const { pipe } = await languageServer.request(
      'custom/initializeAPISession',
      {}
    );
    session = await createLanguageServerSession({
      compiler: server.name,
      packageJsonPath: server.packageJsonPath,
      pipe,
      persist: false,
    });
    const hover = await session.hover(
      fileName,
      positionAt(savedText, savedText.indexOf('        id') + 9)
    );
    expect(hover?.result.contents.value).toContain('Pokemon.id');
  }, 60_000);
});
