import { expect, afterAll, beforeAll, it, describe } from 'vitest';
import { TSServer } from './server';
import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';
import ts from 'typescript/lib/tsserverlibrary';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const projectPath = path.resolve(__dirname, 'fixture-project-tada');

const outfileFragment = path.join(projectPath, 'references-fragment.ts');
const outfileUsage = path.join(projectPath, 'references-usage.ts');

const fragmentFixture = fs.readFileSync(
  path.join(projectPath, 'fixtures/references-fragment.ts'),
  'utf-8'
);
const usageFixture = fs.readFileSync(
  path.join(projectPath, 'fixtures/references-usage.ts'),
  'utf-8'
);

const fragmentName = 'referencedFields';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const positionAt = (text: string, index: number) => {
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  const lastNewline = before.lastIndexOf('\n');
  return { line, offset: index - lastNewline };
};

const indexOf = (text: string, search: string) => {
  const index = text.indexOf(search);
  if (index === -1) throw new Error(`Could not find "${search}" in fixture`);
  return index;
};

// Name token offsets of the definition and every spread of the fragment
const definitionIndex =
  indexOf(fragmentFixture, `fragment ${fragmentName}`) + 'fragment '.length;
const fragmentSpreadIndex = indexOf(fragmentFixture, `...${fragmentName}`) + 3;
const usageSpreadIndex = indexOf(usageFixture, `...${fragmentName}`) + 3;

const expectedSpans = [
  {
    file: outfileFragment,
    start: positionAt(fragmentFixture, definitionIndex),
    end: positionAt(fragmentFixture, definitionIndex + fragmentName.length),
    isDefinition: true,
  },
  {
    file: outfileFragment,
    start: positionAt(fragmentFixture, fragmentSpreadIndex),
    end: positionAt(fragmentFixture, fragmentSpreadIndex + fragmentName.length),
    isDefinition: false,
  },
  {
    file: outfileUsage,
    start: positionAt(usageFixture, usageSpreadIndex),
    end: positionAt(usageFixture, usageSpreadIndex + fragmentName.length),
    isDefinition: false,
  },
];

const bySpan = (a: any, b: any) =>
  a.file.localeCompare(b.file) ||
  a.start.line - b.start.line ||
  a.start.offset - b.start.offset;

const request = async (
  server: TSServer,
  command: 'references' | 'rename',
  args: Record<string, unknown>
) => {
  server.send({ type: 'request', command, arguments: args });

  await server.waitForResponse(
    response => response.type === 'response' && response.command === command
  );

  return server.responses
    .slice()
    .reverse()
    .find(
      response => response.type === 'response' && response.command === command
    ) as ts.server.protocol.Response;
};

// The plugin activates asynchronously, so requests are retried until the
// GraphQL-aware result shows up
const waitForResult = async <T>(
  run: () => Promise<T | undefined>
): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const result = await run();
      if (result !== undefined) return result;
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }

  throw new Error(`Expected result was not found. Last error: ${lastError}`);
};

describe('Fragment references and rename', () => {
  let server: TSServer;

  beforeAll(async () => {
    server = new TSServer(projectPath, { debugLog: false });

    server.sendCommand('open', {
      file: outfileFragment,
      fileContent: '// empty',
      scriptKindName: 'TS',
      projectRootPath: projectPath,
    } satisfies ts.server.protocol.OpenRequestArgs);
    server.sendCommand('open', {
      file: outfileUsage,
      fileContent: '// empty',
      scriptKindName: 'TS',
      projectRootPath: projectPath,
    } satisfies ts.server.protocol.OpenRequestArgs);

    server.sendCommand('updateOpen', {
      openFiles: [
        { file: outfileFragment, fileContent: fragmentFixture },
        { file: outfileUsage, fileContent: usageFixture },
      ],
    } satisfies ts.server.protocol.UpdateOpenRequestArgs);

    server.sendCommand('saveto', {
      file: outfileFragment,
      tmpfile: outfileFragment,
    } satisfies ts.server.protocol.SavetoRequestArgs);
    server.sendCommand('saveto', {
      file: outfileUsage,
      tmpfile: outfileUsage,
    } satisfies ts.server.protocol.SavetoRequestArgs);
  });

  afterAll(() => {
    try {
      fs.unlinkSync(outfileFragment);
      fs.unlinkSync(outfileUsage);
    } catch {}
    server.close();
  });

  it('finds all references from the fragment definition', async () => {
    const refs = await waitForResult(async () => {
      const response = await request(server, 'references', {
        file: outfileFragment,
        ...positionAt(fragmentFixture, definitionIndex + 2),
      });
      const refs = response.body?.refs;
      return refs?.length === expectedSpans.length ? refs : undefined;
    });

    const spans = refs
      .map((ref: any) => ({
        file: path.normalize(ref.file),
        start: ref.start,
        end: ref.end,
        isDefinition: ref.isDefinition,
      }))
      .sort(bySpan);

    expect(spans).toEqual([...expectedSpans].sort(bySpan));
  }, 30000);

  it('finds all references from a fragment spread in another file', async () => {
    const refs = await waitForResult(async () => {
      const response = await request(server, 'references', {
        file: outfileUsage,
        ...positionAt(usageFixture, usageSpreadIndex + 2),
      });
      const refs = response.body?.refs;
      return refs?.length === expectedSpans.length ? refs : undefined;
    });

    const spans = refs
      .map((ref: any) => ({
        file: path.normalize(ref.file),
        start: ref.start,
        end: ref.end,
        isDefinition: ref.isDefinition,
      }))
      .sort(bySpan);

    expect(spans).toEqual([...expectedSpans].sort(bySpan));
  }, 30000);

  it('renames a fragment from a spread across all files', async () => {
    const body = await waitForResult(async () => {
      const response = await request(server, 'rename', {
        file: outfileUsage,
        ...positionAt(usageFixture, usageSpreadIndex + 2),
      });
      return response.body?.info?.canRename ? response.body : undefined;
    });

    expect(body.info.canRename).toBe(true);
    expect(body.info.displayName).toBe(fragmentName);
    expect(body.info.fullDisplayName).toBe(fragmentName);
    expect(body.info.triggerSpan).toEqual({
      start: positionAt(usageFixture, usageSpreadIndex),
      end: positionAt(usageFixture, usageSpreadIndex + fragmentName.length),
    });

    const locations = body.locs
      .flatMap((group: any) =>
        group.locs.map((loc: any) => ({
          file: path.normalize(group.file),
          start: loc.start,
          end: loc.end,
        }))
      )
      .sort(bySpan);

    expect(locations).toEqual(
      [...expectedSpans]
        .sort(bySpan)
        .map(({ file, start, end }) => ({ file, start, end }))
    );
  }, 30000);

  it('renames a fragment from its definition', async () => {
    const body = await waitForResult(async () => {
      const response = await request(server, 'rename', {
        file: outfileFragment,
        ...positionAt(fragmentFixture, definitionIndex),
      });
      return response.body?.info?.canRename ? response.body : undefined;
    });

    expect(body.info.displayName).toBe(fragmentName);
    expect(body.info.triggerSpan).toEqual({
      start: positionAt(fragmentFixture, definitionIndex),
      end: positionAt(fragmentFixture, definitionIndex + fragmentName.length),
    });

    const locationCount = body.locs.reduce(
      (count: number, group: any) => count + group.locs.length,
      0
    );
    expect(locationCount).toBe(expectedSpans.length);
  }, 30000);

  it('falls back to TypeScript references outside GraphQL documents', async () => {
    const importIndex = indexOf(usageFixture, 'ReferencedFields');

    const refs = await waitForResult(async () => {
      const response = await request(server, 'references', {
        file: outfileUsage,
        ...positionAt(usageFixture, importIndex + 2),
      });
      const refs = response.body?.refs;
      return refs?.length ? refs : undefined;
    });

    // The TypeScript identifier is defined in the fragment file and used in
    // the usage file, which proves the original language service still runs
    const files = new Set(refs.map((ref: any) => path.normalize(ref.file)));
    expect(files).toContain(outfileFragment);
    expect(files).toContain(outfileUsage);
  }, 30000);
});
