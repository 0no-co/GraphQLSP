import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import {
  readMessages,
  writeMessage,
} from '../../packages/graphqlsp/src/lspProtocol';
import {
  offsetAt,
  positionAt,
} from '../../packages/graphqlsp/src/languageFeatures';

describe('LSP transport', () => {
  it('handles fragmented frames, multiple messages and UTF-8 lengths', () => {
    const wire = new PassThrough();
    const chunks: Buffer[] = [];
    wire.on('data', chunk => chunks.push(chunk));
    writeMessage(wire, { id: 1, result: 'Pokémon 🦊' });
    writeMessage(wire, { id: 'two', result: null });
    const input = new PassThrough(),
      received: any[] = [];
    readMessages(
      input,
      message => received.push(message),
      error => {
        throw error;
      }
    );
    const data = Buffer.concat(chunks);
    for (let index = 0; index < data.length; index += 3)
      input.write(data.subarray(index, index + 3));
    expect(received).toEqual([
      { id: 1, result: 'Pokémon 🦊' },
      { id: 'two', result: null },
    ]);
  });
  it('rejects malformed frame lengths', () => {
    const input = new PassThrough();
    const errors: Error[] = [];
    readMessages(
      input,
      () => {
        throw new Error('Unexpected message');
      },
      error => errors.push(error)
    );
    input.write('Content-Length: -1\r\n\r\n');
    expect(errors[0]?.message).toBe('Invalid LSP Content-Length');
  });
  it('maps UTF-16 positions and CRLF correctly', () => {
    const text = '// 🦊\r\nquery { name }\r\n';
    const offset = text.indexOf('name');
    expect(positionAt(text, offset)).toEqual({ line: 1, character: 8 });
    expect(offsetAt(text, { line: 1, character: 8 })).toBe(offset);
    expect(offsetAt(text, { line: 0, character: 999 })).toBe(5);
  });
});
