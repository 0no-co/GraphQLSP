import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { init } from '../../packages/graphqlsp/src/ts';
import { loadSchema } from '../../packages/graphqlsp/src/graphql/getSchema';

it('recovers created schemas and invalidates deleted or replaced schemas', async () => {
  init({ typescript: ts });
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'graphqlsp-recovery-')
  );
  const file = path.join(directory, 'schema.graphql');
  let changes = 0;
  const schema = loadSchema(
    {
      config: { schema: './schema.graphql' },
      project: {
        getProjectName: () => path.join(directory, 'tsconfig.json'),
        projectService: { logger: { info: () => {} } },
      },
      languageService: { getProgram: () => undefined },
    },
    () => {},
    {
      rootPath: directory,
      watch: false,
      persist: false,
      onChange: () => changes++,
    }
  );
  const changed = async (operation: () => Promise<unknown>) => {
    const previous = changes;
    await operation();
    schema.checkStale(true);
    for (let attempt = 0; attempt < 100 && changes === previous; attempt++)
      await new Promise(resolve => setTimeout(resolve, 10));
    expect(changes).toBeGreaterThan(previous);
  };
  try {
    await schema.ready;
    expect(schema.current).toBeNull();
    expect(schema.errors.load.size).toBeGreaterThan(0);
    await changed(() => fs.writeFile(file, 'type Query { first: String }'));
    expect(
      schema.current?.schema.getQueryType()?.getFields().first
    ).toBeTruthy();
    expect(schema.errors.load.size).toBe(0);
    await changed(() => fs.unlink(file));
    expect(schema.current).toBeNull();
    expect(schema.errors.load.size).toBeGreaterThan(0);
    await changed(() => fs.writeFile(file, 'type Query { second: String }'));
    expect(
      schema.current?.schema.getQueryType()?.getFields().second
    ).toBeTruthy();
    await changed(async () => {
      await fs.writeFile(file, 'type Query { third: String }');
      await fs.utimes(file, new Date('2020-01-01'), new Date('2020-01-01'));
    });
    expect(
      schema.current?.schema.getQueryType()?.getFields().third
    ).toBeTruthy();
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
