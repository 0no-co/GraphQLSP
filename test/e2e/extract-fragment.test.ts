import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TSServer } from './server';
import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';
import ts from 'typescript/lib/tsserverlibrary';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const projectPath = path.resolve(__dirname, 'fixture-project-tada');

const fixtureContent = fs.readFileSync(
  path.join(projectPath, 'fixtures/extract-fragment.ts'),
  'utf-8'
);

const indexOf = (search: string): number => {
  const index = fixtureContent.indexOf(search);
  if (index === -1) throw new Error(`Could not find ${search} in fixture`);
  return index;
};

const toLocation = (index: number): ts.server.protocol.Location => {
  const before = fixtureContent.slice(0, index);
  return {
    line: before.split('\n').length,
    offset: index - before.lastIndexOf('\n'),
  };
};

const toRangeArgs = (
  start: number,
  end: number
): Omit<ts.server.protocol.FileRangeRequestArgs, 'file'> => {
  const startLocation = toLocation(start);
  const endLocation = toLocation(end);
  return {
    startLine: startLocation.line,
    startOffset: startLocation.offset,
    endLine: endLocation.line,
    endOffset: endLocation.offset,
  };
};

const applyEdits = (
  content: string,
  textChanges: readonly ts.server.protocol.CodeEdit[]
): string => {
  const lineStarts = [0];
  for (let i = 0; i < content.length; i++)
    if (content[i] === '\n') lineStarts.push(i + 1);
  const toPosition = (location: ts.server.protocol.Location): number =>
    lineStarts[location.line - 1]! + location.offset - 1;

  const sorted = [...textChanges].sort(
    (a, b) => toPosition(b.start) - toPosition(a.start)
  );
  for (const change of sorted) {
    content =
      content.slice(0, toPosition(change.start)) +
      change.newText +
      content.slice(toPosition(change.end));
  }
  return content;
};

// A selection spanning the complete `id`, `name` and `fleeRate` fields of
// the `Pokemons` query, including leading and trailing whitespace
const fieldRunAnchor = 'id\n      name\n      fleeRate';
const validSelection = {
  start: indexOf(fieldRunAnchor) - 6,
  end: indexOf(fieldRunAnchor) + fieldRunAnchor.length + 1,
};

describe('Extract to fragment refactor', () => {
  const outfile = path.join(projectPath, 'extract-fragment.ts');

  let server: TSServer;

  const getApplicableRefactors = async (range: {
    start: number;
    end: number;
  }): Promise<ts.server.protocol.ApplicableRefactorInfo[]> => {
    server.send({
      type: 'request',
      command: 'getApplicableRefactors',
      arguments: { file: outfile, ...toRangeArgs(range.start, range.end) },
    });
    await server.waitForResponse(
      response =>
        response.type === 'response' &&
        response.command === 'getApplicableRefactors'
    );
    const response = [...server.responses]
      .reverse()
      .find(
        resp =>
          resp.type === 'response' && resp.command === 'getApplicableRefactors'
      ) as ts.server.protocol.GetApplicableRefactorsResponse;
    return response.body || [];
  };

  const getExtractFragmentAction = (
    refactors: ts.server.protocol.ApplicableRefactorInfo[]
  ) =>
    refactors
      .find(refactor => refactor.name === 'GraphQL')
      ?.actions.find(action => action.name === 'Extract to fragment');

  const getEditsForExtractFragment = async (range: {
    start: number;
    end: number;
  }): Promise<ts.server.protocol.RefactorEditInfo> => {
    server.send({
      type: 'request',
      command: 'getEditsForRefactor',
      arguments: {
        file: outfile,
        ...toRangeArgs(range.start, range.end),
        refactor: 'GraphQL',
        action: 'Extract to fragment',
      },
    });
    await server.waitForResponse(
      response =>
        response.type === 'response' &&
        response.command === 'getEditsForRefactor'
    );
    const response = [...server.responses]
      .reverse()
      .find(
        resp =>
          resp.type === 'response' && resp.command === 'getEditsForRefactor'
      ) as ts.server.protocol.GetEditsForRefactorResponse;
    return response.body!;
  };

  beforeAll(async () => {
    server = new TSServer(projectPath, { debugLog: false });

    server.sendCommand('open', {
      file: outfile,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);

    server.sendCommand('updateOpen', {
      openFiles: [{ file: outfile, fileContent: fixtureContent }],
    } satisfies ts.server.protocol.UpdateOpenRequestArgs);

    server.sendCommand('saveto', {
      file: outfile,
      tmpfile: outfile,
    } satisfies ts.server.protocol.SavetoRequestArgs);

    // The schema is loaded asynchronously and the refactor is only offered
    // once it is; poll a known-good selection until it becomes available
    for (let attempt = 0; attempt < 60; attempt++) {
      if (
        getExtractFragmentAction(await getApplicableRefactors(validSelection))
      )
        return;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error(
      'The "Extract to fragment" refactor never became available.'
    );
  }, 45000);

  afterAll(() => {
    try {
      fs.unlinkSync(outfile);
    } catch {}
    server.close();
  });

  it('offers the refactor for a selection covering complete sibling fields', async () => {
    const action = getExtractFragmentAction(
      await getApplicableRefactors(validSelection)
    );
    expect(action).toBeDefined();
    expect(action).toMatchInlineSnapshot(`
      {
        "description": "Extract the selected fields into a new co-located fragment.",
        "name": "Extract to fragment",
      }
    `);
  }, 30000);

  it('does not offer the refactor for a selection ending inside a field', async () => {
    // From the start of `id` to the middle of `name`
    const refactors = await getApplicableRefactors({
      start: indexOf(fieldRunAnchor),
      end: indexOf(fieldRunAnchor) + 'id\n      na'.length,
    });
    expect(getExtractFragmentAction(refactors)).toBeUndefined();
  }, 30000);

  it('does not offer the refactor for a selection crossing a selection set boundary', async () => {
    // From `fast {` to the end of `damage`, i.e. not covering `fast`'s
    // closing brace
    const refactors = await getApplicableRefactors({
      start: indexOf('fast {'),
      end: indexOf('damage') + 'damage'.length,
    });
    expect(getExtractFragmentAction(refactors)).toBeUndefined();
  }, 30000);

  it('does not offer the refactor for a collapsed selection', async () => {
    const refactors = await getApplicableRefactors({
      start: indexOf(fieldRunAnchor),
      end: indexOf(fieldRunAnchor),
    });
    expect(getExtractFragmentAction(refactors)).toBeUndefined();
  }, 30000);

  it('extracts selected fields into a new fragment appended to the fragment array', async () => {
    const editInfo = await getEditsForExtractFragment(validSelection);
    expect(editInfo.edits).toHaveLength(1);
    expect(editInfo.edits[0]!.fileName).toBe(outfile);

    const result = applyEdits(fixtureContent, editInfo.edits[0]!.textChanges);
    expect(result).toMatchInlineSnapshot(`
      "import { graphql } from './graphql';

      // prettier-ignore
      const existingFields = graphql(\`
        fragment PokemonFields on Pokemon {
          maxCP
          maxHP
        }
      \`);

      const pokemonFields2 = graphql(\`
        fragment PokemonFields2 on Pokemon {
          id
          name
          fleeRate
        }
      \`);

      // prettier-ignore
      const pokemonsQuery = graphql(\`
        query Pokemons($limit: Int!) {
          pokemons(limit: $limit) {
            ...PokemonFields2
            attacks {
              fast {
                name
                damage
              }
            }
            __typename
            ...PokemonFields
          }
        }
      \`, [existingFields, pokemonFields2]);

      // prettier-ignore
      const pokemonQuery = graphql(\`
        query Pokemon($id: ID!) {
          pokemon(id: $id) {
            id
            name
            evolutions {
              id
              name
            }
          }
        }
      \`);

      const stringQuery = graphql(
        'query StringQuery { pokemon(id: "foo, bar  baz") { id name } }'
      );

      console.log(existingFields, pokemonsQuery, pokemonQuery, stringQuery);
      "
    `);
  }, 30000);

  it('extracts a field with a nested selection set at the end of a run', async () => {
    // From `attacks` to the end of `__typename`, covering the complete
    // nested selection set of `attacks`
    const editInfo = await getEditsForExtractFragment({
      start: indexOf('attacks {'),
      end: indexOf('__typename') + '__typename'.length,
    });

    const result = applyEdits(fixtureContent, editInfo.edits[0]!.textChanges);
    expect(result).toMatchInlineSnapshot(`
      "import { graphql } from './graphql';

      // prettier-ignore
      const existingFields = graphql(\`
        fragment PokemonFields on Pokemon {
          maxCP
          maxHP
        }
      \`);

      const pokemonFields2 = graphql(\`
        fragment PokemonFields2 on Pokemon {
          attacks {
            fast {
              name
              damage
            }
          }
          __typename
        }
      \`);

      // prettier-ignore
      const pokemonsQuery = graphql(\`
        query Pokemons($limit: Int!) {
          pokemons(limit: $limit) {
            id
            name
            fleeRate
            ...PokemonFields2
            ...PokemonFields
          }
        }
      \`, [existingFields, pokemonFields2]);

      // prettier-ignore
      const pokemonQuery = graphql(\`
        query Pokemon($id: ID!) {
          pokemon(id: $id) {
            id
            name
            evolutions {
              id
              name
            }
          }
        }
      \`);

      const stringQuery = graphql(
        'query StringQuery { pokemon(id: "foo, bar  baz") { id name } }'
      );

      console.log(existingFields, pokemonsQuery, pokemonQuery, stringQuery);
      "
    `);
  }, 30000);

  it('preserves GraphQL string values in regular string literals', async () => {
    const anchor = 'pokemon(id: "foo, bar  baz") { id name }';
    const editInfo = await getEditsForExtractFragment({
      start: indexOf(anchor),
      end: indexOf(anchor) + anchor.length,
    });

    const result = applyEdits(fixtureContent, editInfo.edits[0]!.textChanges);
    expect(result).toContain(
      'fragment QueryFields on Query { pokemon(id: "foo, bar  baz") { id name } }'
    );
    expect(result).toContain(
      "'query StringQuery { ...QueryFields }', [queryFields]"
    );
    expect(result).not.toContain('pokemon(id: "foo bar baz")');
  }, 30000);

  it('adds a fragment array to a call that has none', async () => {
    const anchor = 'evolutions {\n        id\n        name\n      }';
    const editInfo = await getEditsForExtractFragment({
      start: indexOf(anchor),
      end: indexOf(anchor) + anchor.length,
    });

    const result = applyEdits(fixtureContent, editInfo.edits[0]!.textChanges);
    expect(result).toMatchInlineSnapshot(`
      "import { graphql } from './graphql';

      // prettier-ignore
      const existingFields = graphql(\`
        fragment PokemonFields on Pokemon {
          maxCP
          maxHP
        }
      \`);

      // prettier-ignore
      const pokemonsQuery = graphql(\`
        query Pokemons($limit: Int!) {
          pokemons(limit: $limit) {
            id
            name
            fleeRate
            attacks {
              fast {
                name
                damage
              }
            }
            __typename
            ...PokemonFields
          }
        }
      \`, [existingFields]);

      const pokemonFields2 = graphql(\`
        fragment PokemonFields2 on Pokemon {
          evolutions {
            id
            name
          }
        }
      \`);

      // prettier-ignore
      const pokemonQuery = graphql(\`
        query Pokemon($id: ID!) {
          pokemon(id: $id) {
            id
            name
            ...PokemonFields2
          }
        }
      \`, [pokemonFields2]);

      const stringQuery = graphql(
        'query StringQuery { pokemon(id: "foo, bar  baz") { id name } }'
      );

      console.log(existingFields, pokemonsQuery, pokemonQuery, stringQuery);
      "
    `);
  }, 30000);
});
