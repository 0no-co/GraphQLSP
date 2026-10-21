import { expect, afterAll, beforeAll, it, describe } from 'vitest';
import { TSServer } from './server';
import { pollDiagnostics } from './util';
import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';
import ts from 'typescript/lib/tsserverlibrary';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const projectPath = path.resolve(
  __dirname,
  'fixture-project-tada-graphql-files'
);

const files = {
  index: path.join(projectPath, 'index.ts'),
  queries: path.join(projectPath, 'queries.graphql'),
  fragments: path.join(projectPath, 'fragments.graphql'),
  invalid: path.join(projectPath, 'invalid.graphql'),
  broken: path.join(projectPath, 'broken.graphql'),
  typing: path.join(projectPath, 'typing.graphql'),
  schema: path.join(projectPath, 'schema.graphql'),
};

const read = (file: string) => fs.readFileSync(file, 'utf-8');

const positionOf = (file: string, search: string, offset = 0) => {
  const text = read(file);
  const index = text.indexOf(search);
  if (index === -1) throw new Error(`Could not find "${search}" in ${file}`);
  const before = text.slice(0, index + offset);
  return {
    line: before.split('\n').length,
    offset: index + offset - before.lastIndexOf('\n'),
  };
};

describe('.graphql files', () => {
  let server: TSServer;

  const request = async (
    command: string,
    args: Record<string, unknown>
  ): Promise<any> => {
    const seen = server.responses.length;
    server.sendCommand(command as any, args);
    await server.waitForResponse(
      response => response.type === 'response' && response.command === command
    );
    return server.responses
      .slice(seen)
      .find(
        response => response.type === 'response' && response.command === command
      );
  };

  beforeAll(async () => {
    server = new TSServer(projectPath, { debugLog: false });
    for (const file of Object.values(files)) {
      if (file === files.schema) continue;
      server.sendCommand('open', {
        file,
        fileContent: read(file),
        ...(file.endsWith('.ts') ? { scriptKindName: 'TS' } : {}),
      } satisfies ts.server.protocol.OpenRequestArgs);
    }
  });

  afterAll(() => {
    server.close();
  });

  it('types imports of .graphql files', async () => {
    const diagnostics = await pollDiagnostics(
      server,
      files.index,
      diagnostics => diagnostics.length > 0
    );
    // `damage` is a nullable number, which proves the import is fully typed
    expect(diagnostics).toMatchObject([
      {
        code: 2322,
        text: expect.stringContaining(
          "Type 'number | null | undefined' is not assignable to type 'string'"
        ),
      },
    ]);
  });

  it('validates .graphql files against the schema', async () => {
    const diagnostics = await pollDiagnostics(server, files.invalid);
    expect(diagnostics).toMatchObject([
      {
        code: 52001,
        start: positionOf(files.invalid, 'notAField'),
        text: expect.stringContaining('notAField'),
      },
    ]);
  });

  it('reports no diagnostics for valid .graphql files', async () => {
    const diagnostics = await pollDiagnostics(
      server,
      files.queries,
      () => true
    );
    expect(diagnostics).toEqual([]);
  });

  it('provides schema completions in .graphql files', async () => {
    const response = await request('completionInfo', {
      file: files.queries,
      ...positionOf(files.queries, '      name\n', 6),
    });
    const names = response.body.entries.map((entry: any) => entry.name);
    // Fields that are already selected aren't suggested again
    expect(names).toContain('type');
    expect(names).not.toContain('damage');
  });

  it('provides completions in unclosed documents while typing', async () => {
    const text = read(files.typing);
    const lines = text.split('\n');
    const response = await request('completionInfo', {
      file: files.typing,
      line: lines.length,
      offset: lines[lines.length - 1]!.length + 1,
    });
    const names = response.body.entries.map((entry: any) => entry.name);
    expect(names).toEqual(expect.arrayContaining(['id', 'name', 'attacks']));
  });

  it('provides schema hovers in .graphql files', async () => {
    const response = await request('quickinfo', {
      file: files.queries,
      ...positionOf(files.queries, 'damage', 2),
    });
    expect(response.body.displayString).toContain('Attack.damage: Int');
    expect(response.body.start).toEqual(positionOf(files.queries, 'damage', 2));
  });

  it('goes to fragment definitions in other .graphql files', async () => {
    const response = await request('definitionAndBoundSpan', {
      file: files.queries,
      ...positionOf(files.queries, '...PokemonFields', 5),
    });
    expect(response.body.definitions).toMatchObject([
      {
        file: files.fragments,
        start: positionOf(files.fragments, 'PokemonFields'),
      },
    ]);
  });

  it('goes to definitions in .graphql files from TypeScript', async () => {
    const response = await request('definitionAndBoundSpan', {
      file: files.index,
      ...positionOf(files.index, 'Pokemons, Attacks', 2),
    });
    expect(response.body.definitions).toMatchObject([
      {
        file: files.queries,
        start: positionOf(files.queries, 'Pokemons('),
      },
    ]);
  });

  it('reports syntax errors in .graphql files', async () => {
    server.sendCommand('geterr', { files: [files.broken], delay: 0 });
    await server.waitForResponse(
      e =>
        e.type === 'event' &&
        e.event === 'syntaxDiag' &&
        (e as any).body?.file === files.broken
    );
    const event = server.responses.find(
      e =>
        e.type === 'event' &&
        e.event === 'syntaxDiag' &&
        (e as any).body?.file === files.broken
    ) as any;
    expect(event.body.diagnostics).toMatchObject([
      { code: 52010, text: expect.stringContaining('Syntax Error') },
    ]);
  });

  it('shows fragment types when hovering spreads', async () => {
    const response = await request('quickinfo', {
      file: files.queries,
      ...positionOf(files.queries, '...Attacks', 5),
    });
    expect(response.body.displayString).toContain('const Attacks');
    expect(response.body.start).toEqual(
      positionOf(files.queries, '...Attacks', 3)
    );
  });

  it('goes to schema definitions of fields in .graphql files', async () => {
    const response = await request('definitionAndBoundSpan', {
      file: files.queries,
      ...positionOf(files.queries, 'damage', 2),
    });
    expect(response.body.definitions).toMatchObject([
      {
        file: files.schema,
        start: positionOf(files.schema, 'damage: Int'),
      },
    ]);
  });

  it('finds references of fragments across files', async () => {
    const response = await request('references', {
      file: files.queries,
      ...positionOf(files.queries, 'fragment Attacks', 10),
    });
    const references = response.body.refs.map((ref: any) => ({
      file: ref.file,
      start: ref.start,
    }));
    expect(references).toEqual(
      expect.arrayContaining([
        { file: files.queries, start: positionOf(files.queries, 'Attacks on') },
        {
          file: files.queries,
          start: positionOf(files.queries, 'Attacks\n', 0),
        },
        { file: files.index, start: positionOf(files.index, 'Attacks }') },
      ])
    );
  });

  it('renames fragments across .graphql and TypeScript files', async () => {
    const response = await request('rename', {
      file: files.queries,
      ...positionOf(files.queries, 'fragment Attacks', 10),
    });
    expect(response.body.info.canRename).toBe(true);
    const locations = response.body.locs.flatMap((group: any) =>
      group.locs.map((loc: any) => ({ file: group.file, start: loc.start }))
    );
    expect(locations).toHaveLength(4);
    expect(locations).toEqual(
      expect.arrayContaining([
        { file: files.queries, start: positionOf(files.queries, 'Attacks on') },
        { file: files.queries, start: positionOf(files.queries, 'Attacks\n') },
        { file: files.index, start: positionOf(files.index, 'Attacks }') },
        {
          file: files.index,
          start: positionOf(files.index, 'Attacks, pokemon'),
        },
      ])
    );
  });

  it("doesn't classify .graphql files as TypeScript", async () => {
    const response = await request('encodedSemanticClassifications-full', {
      file: files.queries,
      start: 0,
      length: read(files.queries).length,
      format: '2020',
    });
    expect(response.body.spans).toEqual([]);
  });
});

describe('.graphql files created while the server runs', () => {
  const added = path.join(projectPath, 'added.graphql');
  const importer = path.join(projectPath, 'added.ts');
  const unimported = path.join(projectPath, 'unimported.graphql');
  let server: TSServer;

  const cleanup = () => {
    for (const file of [added, importer, unimported]) {
      fs.rmSync(file, { force: true });
    }
  };

  beforeAll(async () => {
    cleanup();
    fs.writeFileSync(
      importer,
      [
        "import type { ResultOf } from './graphql.js';",
        "import { Added } from './added.graphql';",
        '',
        'declare const result: ResultOf<typeof Added>;',
        'export const id: number = result.pokemon!.id;',
        '',
      ].join('\n')
    );
    server = new TSServer(projectPath, { debugLog: false });
    server.sendCommand('open', {
      file: importer,
      fileContent: read(importer),
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);
    await pollDiagnostics(server, importer, diagnostics =>
      diagnostics.some(diagnostic => diagnostic.code === 2307)
    );
  });

  afterAll(() => {
    server.close();
    cleanup();
  });

  it('adds new .graphql files to the project without opening them', async () => {
    fs.writeFileSync(unimported, 'query Unimported {\n  notAField\n}\n');
    let fileNames: string[] = [];
    for (let attempt = 0; attempt < 40; attempt++) {
      const seen = server.responses.length;
      server.sendCommand('projectInfo', {
        file: importer,
        needFileNameList: true,
      } satisfies ts.server.protocol.ProjectInfoRequestArgs);
      await server.waitForResponse(
        response =>
          response.type === 'response' && response.command === 'projectInfo'
      );
      const response = server.responses
        .slice(seen)
        .find(
          response =>
            response.type === 'response' && response.command === 'projectInfo'
        ) as ts.server.protocol.ProjectInfoResponse;
      fileNames = response.body!.fileNames!;
      if (fileNames.includes(unimported)) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    expect(fileNames).toContain(unimported);
  });

  it('resolves imports of new .graphql files', async () => {
    fs.writeFileSync(
      added,
      'query Added {\n  pokemon(id: "1") {\n    id\n    notAField\n  }\n}\n'
    );
    const diagnostics = await pollDiagnostics(server, importer, diagnostics =>
      diagnostics.some(diagnostic => diagnostic.code === 2322)
    );
    expect(diagnostics).toMatchObject([
      {
        code: 2322,
        text: expect.stringContaining(
          "Type 'string' is not assignable to type 'number'"
        ),
      },
    ]);
  });

  it('validates new .graphql files against the schema', async () => {
    server.sendCommand('open', {
      file: added,
      fileContent: read(added),
    } satisfies ts.server.protocol.OpenRequestArgs);
    const diagnostics = await pollDiagnostics(server, added);
    expect(diagnostics).toMatchObject([
      { code: 52001, start: positionOf(added, 'notAField') },
    ]);
  });
});

describe('.graphql files without the content mapper', () => {
  const projectPath = path.resolve(__dirname, 'fixture-project-tada');
  const schemaFile = path.join(projectPath, 'schema.graphql');
  let server: TSServer;

  beforeAll(() => {
    // Editor extensions load GraphQLSP as a global plugin for the `graphql`
    // language, which handles files outside any configured project
    server = new TSServer(projectPath, {
      args: [
        '--globalPlugins',
        '@0no-co/graphqlsp',
        '--pluginProbeLocations',
        projectPath,
      ],
    });
    server.sendCommand('open', {
      file: schemaFile,
      fileContent: fs.readFileSync(schemaFile, 'utf-8'),
    } satisfies ts.server.protocol.OpenRequestArgs);
  });

  afterAll(() => {
    server.close();
  });

  it("doesn't report TypeScript errors for GraphQL files", async () => {
    server.sendCommand('geterr', { files: [schemaFile], delay: 0 });
    await server.waitForResponse(
      e =>
        e.type === 'event' &&
        e.event === 'semanticDiag' &&
        (e as any).body?.file === schemaFile
    );
    const diagnostics = server.responses
      .filter(
        e =>
          e.type === 'event' &&
          (e.event === 'syntaxDiag' || e.event === 'semanticDiag') &&
          (e as any).body?.file === schemaFile
      )
      .flatMap((e: any) => e.body.diagnostics);
    expect(diagnostics).toEqual([]);
  });
});
