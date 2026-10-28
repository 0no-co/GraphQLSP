import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  readMessages,
  writeMessage,
} from '../../packages/graphqlsp/src/lspProtocol';
import { positionAt } from '../../packages/graphqlsp/src/languageFeatures';

const project = path.resolve('test/e2e/fixture-project-ts7');
const file = path.join(project, 'src/valid.ts');
const uri = pathToFileURL(file).href;
const text = fs.readFileSync(file, 'utf8');

it.each(
  [0, 249, 260, 300, 500, 700].flatMap(pause =>
    [true, false].map(close => ({ pause, close }))
  )
)(
  'closes its API session before native shutdown after $pause ms (didClose=$close)',
  async ({ pause, close }) => {
    const child = spawn(
      process.execPath,
      [
        path.resolve('packages/graphqlsp/bin/graphqlsp.cjs'),
        '--stdio',
        '--no-persist',
        '--typescript',
        path.join(project, 'node_modules/typescript-7'),
      ],
      { cwd: project, stdio: ['pipe', 'pipe', 'inherit'] }
    );
    let seq = 0;
    const pending = new Map<
      number,
      {
        resolve: (value: any) => void;
        reject: (error: Error) => void;
        timer: NodeJS.Timeout;
      }
    >();
    const send = (method: string, params?: any) =>
      writeMessage(child.stdin!, { jsonrpc: '2.0', method, params });
    const request = (method: string, params?: any) =>
      new Promise<any>((resolve, reject) => {
        const id = ++seq;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out: ${method}`));
        }, 7000);
        pending.set(id, { resolve, reject, timer });
        writeMessage(child.stdin!, { jsonrpc: '2.0', id, method, params });
      });
    child.stdin!.on('error', () => {});
    readMessages(
      child.stdout!,
      message => {
        if (message.method && message.id != null)
          writeMessage(child.stdin!, {
            jsonrpc: '2.0',
            id: message.id,
            result: message.method === 'workspace/configuration' ? [] : null,
          });
        else if (typeof message.id === 'number') {
          const entry = pending.get(message.id);
          if (entry) {
            clearTimeout(entry.timer);
            pending.delete(message.id);
            message.error
              ? entry.reject(new Error(message.error.message))
              : entry.resolve(message.result);
          }
        }
      },
      error => {
        for (const entry of pending.values()) entry.reject(error);
      }
    );
    try {
      await request('initialize', {
        processId: process.pid,
        rootUri: pathToFileURL(project).href,
        capabilities: {},
      });
      send('initialized', {});
      send('textDocument/didOpen', {
        textDocument: { uri, languageId: 'typescript', version: 1, text },
      });
      const hover = await request('textDocument/hover', {
        textDocument: { uri },
        position: positionAt(text, text.indexOf('        id') + 9),
      });
      expect(hover.contents.value).toContain('Pokemon.id');
      send('textDocument/didChange', {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: text.replace('        id', '        nmae') }],
      });
      await new Promise(resolve => setTimeout(resolve, pause));
      if (close) send('textDocument/didClose', { textDocument: { uri } });
      expect(await request('shutdown')).toBeNull();
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(child.exitCode).toBeNull();
      await expect(
        request('textDocument/hover', {
          textDocument: { uri },
          position: { line: 0, character: 0 },
        })
      ).rejects.toThrow('shutting down');
      const exited = new Promise<number | null>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Proxy did not exit')),
          3000
        );
        child.once('exit', code => {
          clearTimeout(timeout);
          resolve(code);
        });
      });
      send('exit');
      expect(await exited).toBe(0);
    } finally {
      child.stdin!.end();
      child.kill();
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error('Test ended'));
      }
      pending.clear();
    }
  },
  15000
);
