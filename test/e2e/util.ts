import { vi } from 'vitest';

type WaitForExpectOptions = {
  timeout?: number;
  interval?: number;
};

export const waitForExpect = async (
  expectFn: () => void,
  { interval = 500, timeout = 20000 }: WaitForExpectOptions = {}
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
