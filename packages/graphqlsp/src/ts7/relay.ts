import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The relay's source, run as a CommonJS script by the sync client.
 *
 * @remarks
 * The sync client speaks MessagePack tuples (`[type, method, payload]`) over
 * the stdio of a process it spawns, while API sessions of TypeScript 7's
 * language server speak JSON-RPC over a pipe. The relay forwards the sync
 * client's requests to the pipe, and its responses back, decoding the
 * base64 that JSON-RPC sessions use for binary responses (source files).
 *
 * This is kept as plain JavaScript, rather than compiled, so that it only
 * depends on Node's built-in modules.
 */
const relaySource = String.raw`'use strict';
const net = require('node:net');

const MSG_REQUEST = 1;
const MSG_RESPONSE = 4;
const MSG_ERROR = 5;
// Methods that respond with raw binary in the MessagePack protocol,
// see isSourceFileResponseMethod in tsc/internal/api/session.go
const BINARY_METHODS = new Set([
  'createSourceFile',
  'createSourceFileFromFile',
  'getSourceFile',
  'getCachedSourceFile',
  'getConfigSourceFile',
  'typeToTypeNode',
  'signatureToSignatureDeclaration',
]);

const socket = net.createConnection(process.argv[2]);
let closingMethod;
socket.on('end', () => { if (process.env.GRAPHQLSP_RELAY_DEBUG) process.stderr.write('relay remote end\n'); });
if (process.env.GRAPHQLSP_RELAY_DEBUG) socket.on('connect', () => process.stderr.write('relay connected\n'));
socket.on('error', error => {
  process.stderr.write('[graphqlsp] API relay: ' + error.message + '\n');
  process.exit(1);
});
socket.on('close', () => {
  if (process.env.GRAPHQLSP_RELAY_DEBUG) process.stderr.write('relay remote close\n');
  if (!closingMethod) return process.exit(0);
  // The remote JSON-RPC loop drains its handlers before closing its socket.
  // Flush our acknowledgement before exiting the local binary relay.
  writeTuple(MSG_RESPONSE, closingMethod, Buffer.from('null'));
  process.stdout.end(() => process.exit(0));
});
process.stdin.on('end', () => socket.end());

let seq = 0;
const pending = new Map();
let socketBuffer = Buffer.alloc(0);
socket.on('data', chunk => {
  socketBuffer = Buffer.concat([socketBuffer, chunk]);
  for (;;) {
    const headerEnd = socketBuffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const match = /Content-Length: *(\d+)/i.exec(
      socketBuffer.subarray(0, headerEnd).toString()
    );
    const length = match ? Number(match[1]) : 0;
    if (socketBuffer.length < headerEnd + 4 + length) return;
    const message = JSON.parse(
      socketBuffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString()
    );
    socketBuffer = socketBuffer.subarray(headerEnd + 4 + length);
    if (message.method !== undefined) {
      // The relay doesn't provide callbacks, e.g. for file system access
      if (message.id !== undefined) {
        send({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: 'Unsupported callback' },
        });
      }
    } else if (pending.has(message.id)) {
      const method = pending.get(message.id);
      pending.delete(message.id);
      respond(method, message);
    }
  }
});

const send = message => {
  const body = Buffer.from(JSON.stringify(message));
  socket.write('Content-Length: ' + body.length + '\r\n\r\n');
  socket.write(body);
};

const respond = (method, message) => {
  if (process.env.GRAPHQLSP_RELAY_DEBUG) process.stderr.write('relay response ' + method + '\n');
  if (message.error) {
    writeTuple(MSG_ERROR, method, Buffer.from(String(message.error.message)));
  } else if (BINARY_METHODS.has(method)) {
    const data = message.result && message.result.data;
    writeTuple(
      MSG_RESPONSE,
      method,
      data ? Buffer.from(data, 'base64') : Buffer.alloc(0)
    );
  } else {
    const json = JSON.stringify(message.result);
    writeTuple(MSG_RESPONSE, method, Buffer.from(json === undefined ? 'null' : json));
  }
};

const binHeader = length => {
  const header = Buffer.alloc(5);
  header[0] = 0xc6;
  header.writeUInt32BE(length, 1);
  return header;
};

const writeTuple = (type, method, payload) => {
  const name = Buffer.from(method);
  process.stdout.write(
    Buffer.concat([
      Buffer.from([0x93, type]),
      binHeader(name.length),
      name,
      binHeader(payload.length),
      payload,
    ])
  );
};

let stdinBuffer = Buffer.alloc(0);
const readBin = offset => {
  const marker = stdinBuffer[offset];
  let size;
  let start;
  if (marker === 0xc4) {
    if (stdinBuffer.length < offset + 2) return null;
    size = stdinBuffer[offset + 1];
    start = offset + 2;
  } else if (marker === 0xc5) {
    if (stdinBuffer.length < offset + 3) return null;
    size = stdinBuffer.readUInt16BE(offset + 1);
    start = offset + 3;
  } else if (marker === 0xc6) {
    if (stdinBuffer.length < offset + 5) return null;
    size = stdinBuffer.readUInt32BE(offset + 1);
    start = offset + 5;
  } else if (marker === undefined) {
    return null;
  } else {
    throw new Error('Expected MessagePack bin, received: 0x' + marker.toString(16));
  }
  if (stdinBuffer.length < start + size) return null;
  return { value: stdinBuffer.subarray(start, start + size), end: start + size };
};

process.stdin.on('data', chunk => {
  stdinBuffer = Buffer.concat([stdinBuffer, chunk]);
  for (;;) {
    if (stdinBuffer.length < 2) return;
    if (stdinBuffer[0] !== 0x93) {
      throw new Error('Expected MessagePack tuple, received: 0x' + stdinBuffer[0].toString(16));
    }
    let offset = 1;
    let type = stdinBuffer[offset++];
    if (type === 0xcc) {
      if (stdinBuffer.length < 3) return;
      type = stdinBuffer[offset++];
    }
    const name = readBin(offset);
    if (!name) return;
    const payload = readBin(name.end);
    if (!payload) return;
    stdinBuffer = stdinBuffer.subarray(payload.end);
    if (type !== MSG_REQUEST) continue;
    const method = name.value.toString();
    if (method === '__graphqlspClose') {
      if (process.env.GRAPHQLSP_RELAY_DEBUG) process.stderr.write('relay close requested\n');
      closingMethod = method;
      socket.end();
      continue;
    }
    if (process.env.GRAPHQLSP_RELAY_DEBUG) process.stderr.write('relay request ' + method + '\n');
    const id = ++seq;
    pending.set(id, method);
    const text = payload.value.toString();
    const params = text.length ? JSON.parse(text) : null;
    send(
      params == null
        ? { jsonrpc: '2.0', id: id, method: method }
        : { jsonrpc: '2.0', id: id, method: method, params: params }
    );
  }
});
`;

export interface APIRelay {
  /** Passed as the sync client's `tsserverPath`, which it spawns. */
  tsserverPath: string;
  /** Half-closes the API socket and waits for remote request-handler drain. */
  drain(client: { apiRequest(method: string, params: unknown): unknown }): void;
  dispose(): void;
}

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** Lets TypeScript 7.1's sync client connect to an API pipe, e.g. of a
 * language server, which it doesn't support yet.
 *
 * @remarks
 * The sync client spawns its `tsserverPath` instead, and a shell script
 * runs the relay with the current Node executable in its place. In VS Code's
 * extension host, that is Electron, hence `ELECTRON_RUN_AS_NODE`.
 */
export const createAPIRelay = (pipe: string): APIRelay => {
  if (process.platform === 'win32') {
    throw new Error(
      "TypeScript 7.1's sync API client can't connect to API pipes on Windows yet."
    );
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'graphqlsp-'));
  const relayPath = path.join(directory, 'relay.cjs');
  const tsserverPath = path.join(directory, 'tsserver');
  fs.writeFileSync(relayPath, relaySource);
  fs.writeFileSync(
    tsserverPath,
    '#!/bin/sh\n' +
      `ELECTRON_RUN_AS_NODE=1 exec ${quote(process.execPath)} ${quote(
        relayPath
      )} ${quote(pipe)}\n`,
    { mode: 0o755 }
  );
  return {
    tsserverPath,
    drain(client) {
      client.apiRequest('__graphqlspClose', null);
    },
    dispose() {
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
};
