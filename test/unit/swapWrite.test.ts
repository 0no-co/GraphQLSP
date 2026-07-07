import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { swapWrite } from '../../packages/graphqlsp/src/graphql/getSchema';

const directories: string[] = [];

const makeTarget = async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'graphqlsp-'));
  directories.push(directory);
  return path.join(directory, 'graphql-env.d.ts');
};

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map(directory => fs.rm(directory, { recursive: true, force: true }))
  );
});

describe('swapWrite', () => {
  it('does not mutate an existing file when its contents are unchanged', async () => {
    const target = await makeTarget();
    const contents = 'export type introspection = {};\n';
    const originalTime = new Date('2020-01-01T00:00:00.000Z');

    await fs.writeFile(target, contents);
    await fs.utimes(target, originalTime, originalTime);
    const before = await fs.stat(target);

    await swapWrite(target, contents);

    const after = await fs.stat(target);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    await expect(fs.readFile(target, 'utf8')).resolves.toBe(contents);
    await expect(fs.stat(`${target}.tmp`)).rejects.toThrow();
  });

  it('compares bytes rather than decoded text before skipping a write', async () => {
    const target = await makeTarget();
    const originalTime = new Date('2020-01-01T00:00:00.000Z');
    const contents = '\uFFFD';

    await fs.writeFile(target, Buffer.from([0xff]));
    await fs.utimes(target, originalTime, originalTime);
    const before = await fs.stat(target);

    await swapWrite(target, contents);

    const after = await fs.stat(target);
    expect(after.mtimeMs).toBeGreaterThan(before.mtimeMs);
    await expect(fs.readFile(target)).resolves.toEqual(Buffer.from(contents));
  });

  it('replaces an existing file when its contents change', async () => {
    const target = await makeTarget();
    const originalTime = new Date('2020-01-01T00:00:00.000Z');

    await fs.writeFile(target, 'old contents');
    await fs.utimes(target, originalTime, originalTime);
    const before = await fs.stat(target);

    await swapWrite(target, 'new contents');

    const after = await fs.stat(target);
    expect(after.mtimeMs).toBeGreaterThan(before.mtimeMs);
    await expect(fs.readFile(target, 'utf8')).resolves.toBe('new contents');
    await expect(fs.stat(`${target}.tmp`)).rejects.toThrow();
  });

  // Multiple plugin instances may share one `tadaOutputLocation`, e.g.
  // several TS projects in a monorepo extending the same tsconfig. See:
  // https://github.com/0no-co/gql.tada/issues/571
  it('tolerates concurrent writes to the same target', async () => {
    const target = await makeTarget();
    await fs.writeFile(target, 'initial');

    const writers = Array.from({ length: 20 }, (_, index) =>
      swapWrite(target, `contents-${index}`)
    );
    await expect(Promise.all(writers)).resolves.not.toThrow();

    // The last rename wins, but the target must match one write in full
    // and no swap-files may be left behind
    const contents = await fs.readFile(target, 'utf8');
    expect(contents).toMatch(/^contents-\d+$/);
    const leftovers = (await fs.readdir(path.dirname(target))).filter(file =>
      file.endsWith('.tmp')
    );
    expect(leftovers).toEqual([]);
  });
});
