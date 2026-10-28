import type { Readable, Writable } from 'node:stream';

export interface Message {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
}

/** LSP framing uses UTF-8 byte counts, not JavaScript string lengths. */
export function readMessages(
  input: Readable,
  receive: (message: Message) => void,
  fail: (error: Error) => void
): void {
  let buffer = Buffer.alloc(0);
  input.on('data', (chunk: Buffer) => {
    try {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) {
          if (buffer.length > 8192) throw new Error('LSP header exceeds 8 KiB');
          return;
        }
        const match = /(?:^|\r\n)Content-Length:\s*(\d+)/i.exec(
          buffer.subarray(0, end).toString('ascii')
        );
        const length = match && Number(match[1]);
        if (
          length === null ||
          !Number.isSafeInteger(length) ||
          length < 0 ||
          length > 64 * 1024 * 1024
        )
          throw new Error('Invalid LSP Content-Length');
        if (buffer.length < end + 4 + length) return;
        const body = buffer.subarray(end + 4, end + 4 + length);
        buffer = buffer.subarray(end + 4 + length);
        receive(JSON.parse(body.toString('utf8')));
      }
    } catch (error) {
      fail(error as Error);
    }
  });
}

export function writeMessage(output: Writable, message: Message): void {
  const body = Buffer.from(JSON.stringify(message));
  output.write(
    Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body])
  );
}
