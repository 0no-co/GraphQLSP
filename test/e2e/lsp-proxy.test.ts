import { afterAll, beforeAll, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  readMessages,
  writeMessage,
} from '../../packages/graphqlsp/src/lspProtocol';
import {
  offsetAt,
  positionAt,
} from '../../packages/graphqlsp/src/languageFeatures';

const root = path.resolve('test/e2e/fixture-project-ts7');
const fileName = path.join(root, 'src/valid.ts');
const uri = pathToFileURL(fileName).href;
const savedText = fs.readFileSync(fileName, 'utf8');
let server: ChildProcess;
let seq = 0,
  version = 0;
const requests = new Map<
  number,
  {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }
>();
const notifications: any[] = [];
const send = (method: string, params: any) =>
  writeMessage(server.stdin!, { jsonrpc: '2.0', method, params });
const request = (method: string, params: any): Promise<any> =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      requests.delete(id);
      reject(new Error(`Timed out: ${method}`));
    }, 15000);
    requests.set(id, { resolve, reject, timer });
    writeMessage(server.stdin!, { jsonrpc: '2.0', id, method, params });
  });
const at = (text: string, offset: number) => ({
  textDocument: { uri },
  position: positionAt(text, offset),
});
const change = (text: string) =>
  send('textDocument/didChange', {
    textDocument: { uri, version: ++version },
    contentChanges: [{ text }],
  });

beforeAll(async () => {
  server = spawn(
    process.execPath,
    [
      path.resolve('packages/graphqlsp/bin/graphqlsp.cjs'),
      '--stdio',
      '--no-persist',
      '--typescript',
      path.join(root, 'node_modules/typescript-7'),
    ],
    { cwd: root, stdio: ['pipe', 'pipe', 'inherit'] }
  );
  readMessages(
    server.stdout!,
    message => {
      if (message.method && message.id != null)
        writeMessage(server.stdin!, {
          jsonrpc: '2.0',
          id: message.id,
          result: message.method === 'workspace/configuration' ? [] : null,
        });
      else if (typeof message.id === 'number') {
        const entry = requests.get(message.id);
        if (entry) {
          clearTimeout(entry.timer);
          requests.delete(message.id);
          message.error
            ? entry.reject(new Error(message.error.message))
            : entry.resolve(message.result);
        }
      } else if (message.method) notifications.push(message);
    },
    error => {
      throw error;
    }
  );
  const result = await request('initialize', {
    processId: process.pid,
    rootUri: pathToFileURL(root).href,
    capabilities: {},
    workspaceFolders: [{ name: 'fixture', uri: pathToFileURL(root).href }],
  });
  expect(result.capabilities.renameProvider.prepareProvider).toBe(true);
  expect(result.capabilities.completionProvider.triggerCharacters).toEqual(
    expect.arrayContaining(['.', '"', "'", '/', '<', '@', '$'])
  );
  expect(result.capabilities.completionProvider.resolveProvider).toBe(true);
  expect(result.capabilities.codeActionProvider.codeActionKinds).toEqual(
    expect.arrayContaining([
      'quickfix',
      'source.organizeImports.ts',
      'source.removeUnusedImports.ts',
      'source.sortImports.ts',
      'source.fixAll.ts',
      'refactor.extract',
    ])
  );
  send('initialized', {});
  send('textDocument/didOpen', {
    textDocument: {
      uri,
      languageId: 'typescript',
      version: ++version,
      text: savedText,
    },
  });
}, 30000);

afterAll(async () => {
  try {
    if (server?.exitCode == null) {
      await request('shutdown', null);
      send('exit', null);
    }
  } finally {
    server?.kill();
    for (const entry of requests.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Test ended'));
    }
    requests.clear();
  }
});

it('forwards TypeScript hovers and adds GraphQL hovers and completions', async () => {
  const normal = await request(
    'textDocument/hover',
    at(savedText, savedText.indexOf('graphql') + 2)
  );
  expect(normal).not.toBeNull();
  const hover = await request(
    'textDocument/hover',
    at(savedText, savedText.indexOf('        id') + 9)
  );
  expect(hover.contents.value).toContain('Pokemon.id');
  const text = savedText.replace('        id', '        maxC');
  change(text);
  const completion = await request(
    'textDocument/completion',
    at(text, text.indexOf('maxC') + 4)
  );
  const field = completion.items.find((item: any) => item.label === 'maxCP');
  expect(field.textEdit.newText).toBe('maxCP');
  const start = offsetAt(text, field.textEdit.range.start),
    end = offsetAt(text, field.textEdit.range.end);
  expect(text.slice(start, end)).toBe('maxC');
  expect(await request('completionItem/resolve', field)).toEqual(field);
}, 30000);

it('keeps native TypeScript completion resolution working', async () => {
  const text =
    savedText + '\nconst value = { nativeCompletion: 1 }; value.nati';
  change(text);
  const completion = await request(
    'textDocument/completion',
    at(text, text.length)
  );
  const item = completion.items.find(
    (item: any) => item.label === 'nativeCompletion'
  );
  expect(item).toBeTruthy();
  const resolved = await request('completionItem/resolve', item);
  expect(resolved.label).toBe('nativeCompletion');
}, 30000);

it('overrides native prepareRename errors and renames fragments across files', async () => {
  change(savedText);
  const params = at(savedText, savedText.indexOf('...pokemonFields') + 4);
  const prepare = await request('textDocument/prepareRename', params);
  expect(prepare.placeholder).toBe('pokemonFields');
  const edits = await request('textDocument/rename', {
    ...params,
    newName: 'PokemonDetails',
  });
  expect(Object.keys(edits.changes)).toHaveLength(2);
}, 30000);

it('cancels feature requests and rejects results for changed documents', async () => {
  change(savedText);
  const params = at(savedText, savedText.indexOf('        id') + 9);
  const cancelled = request('textDocument/hover', params);
  send('$/cancelRequest', { id: seq });
  await expect(cancelled).rejects.toThrow(/cancel/i);
  const stale = request('textDocument/hover', params);
  change(savedText + '\n// changed');
  await expect(stale).rejects.toThrow(/changed/i);
  change(savedText);
}, 30000);

it('publishes diagnostics after incremental edits and clears them after a fix', async () => {
  const text = savedText.replace('        id', '        nmae');
  // Use an incremental change, including CRLF and a surrogate pair in a comment.
  const offset = savedText.indexOf('        id') + 8;
  send('textDocument/didChange', {
    textDocument: { uri, version: ++version },
    contentChanges: [
      {
        range: {
          start: positionAt(savedText, offset),
          end: positionAt(savedText, offset + 2),
        },
        text: 'nmae',
      },
    ],
  });
  const waitFor = async (predicate: (message: any) => boolean) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = notifications.findLast(
        message =>
          message.method === 'textDocument/publishDiagnostics' &&
          message.params.uri === uri &&
          message.params.version === version &&
          predicate(message)
      );
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('No matching diagnostics notification');
  };
  const errors = await waitFor(message =>
    message.params.diagnostics.some(
      (diagnostic: any) =>
        diagnostic.source === 'graphqlsp' && diagnostic.message.includes('nmae')
    )
  );
  const diagnostic = errors.params.diagnostics.find(
    (diagnostic: any) =>
      diagnostic.source === 'graphqlsp' && diagnostic.message.includes('nmae')
  );
  expect(
    text.slice(
      offsetAt(text, diagnostic.range.start),
      offsetAt(text, diagnostic.range.end)
    )
  ).toContain('nmae');
  const fixes = await request('textDocument/codeAction', {
    textDocument: { uri },
    range: diagnostic.range,
    context: { diagnostics: [diagnostic] },
  });
  expect(fixes.some((fix: any) => fix.title.includes('name'))).toBe(true);
  change(savedText);
  await waitFor(
    message =>
      !message.params.diagnostics.some(
        (diagnostic: any) => diagnostic.source === 'graphqlsp'
      )
  );
  send('textDocument/didClose', { textDocument: { uri } });
}, 30000);
