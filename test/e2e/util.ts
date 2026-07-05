import { vi } from 'vitest';
import type { TSServer } from './server';

type WaitForExpectOptions = {
  timeout?: number;
  interval?: number;
};

/** Polls the server with "geterr" until the semantic diagnostics for `file`
 * satisfy `isReady`, and returns the last received diagnostics.
 *
 * The plugin loads schemas asynchronously, so the diagnostics tsserver emits
 * automatically after a file is opened may predate the schema and come back
 * empty; asserting on the first received event races the schema load. */
export const pollDiagnostics = async (
  server: TSServer,
  file: string,
  isReady: (diagnostics: any[]) => boolean = diagnostics =>
    diagnostics.length > 0,
  attempts = 40
): Promise<any[]> => {
  let diagnostics: any[] = [];
  for (let attempt = 0; attempt < attempts; attempt++) {
    const seen = server.responses.length;
    server.sendCommand('geterr', { files: [file], delay: 0 });
    await server.waitForResponse(
      e =>
        e.type === 'event' &&
        e.event === 'semanticDiag' &&
        (e as any).body?.file === file
    );
    const res = server.responses
      .slice(seen)
      .find(
        e =>
          e.type === 'event' &&
          e.event === 'semanticDiag' &&
          (e as any).body?.file === file
      ) as any;
    if (res) diagnostics = res.body.diagnostics;
    if (res && isReady(diagnostics)) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return diagnostics;
};

export const waitForExpect = async (
  expectFn: () => void,
  { interval = 2000, timeout = 30000 }: WaitForExpectOptions = {}
) => {
  // @sinonjs/fake-timers injects `clock` property into setTimeout
  const usesFakeTimers = 'clock' in setTimeout;

  if (usesFakeTimers) vi.useRealTimers();

  const start = Date.now();

  while (true) {
    try {
      expectFn();
      break;
    } catch {}

    if (Date.now() - start > timeout) {
      throw new Error('Timeout');
    }

    await new Promise(resolve => setTimeout(resolve, interval));
  }

  if (usesFakeTimers) vi.useFakeTimers();
};
