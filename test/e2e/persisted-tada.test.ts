import { parse, print } from '@0no-co/graphql.web';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TSServer } from './server';
import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';
import ts from 'typescript/lib/tsserverlibrary';
import { createHash } from 'node:crypto';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const projectPath = path.resolve(__dirname, 'fixture-project-tada');

// `MISSMATCH_HASH_TO_DOCUMENT` from packages/graphqlsp/src/diagnostics.ts
const MISSMATCH_HASH_TO_DOCUMENT = 520103;

describe('Persisted operation hash + tada', () => {
  const outfile = path.join(projectPath, 'persisted-nested-fragments.ts');

  let server: TSServer;
  beforeAll(() => {
    server = new TSServer(projectPath, { debugLog: false });

    server.sendCommand('open', {
      file: outfile,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);

    server.sendCommand('updateOpen', {
      openFiles: [
        {
          file: outfile,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/persisted-nested-fragments.ts'),
            'utf-8'
          ),
        },
      ],
    } satisfies ts.server.protocol.UpdateOpenRequestArgs);

    server.sendCommand('saveto', {
      file: outfile,
      tmpfile: outfile,
    } satisfies ts.server.protocol.SavetoRequestArgs);
  });

  afterAll(() => {
    try {
      fs.unlinkSync(outfile);
    } catch {}
  });

  it('reports a hash mismatch when a fragment referenced via nested property access (Component.fragments.<name>) is included in the document', async () => {
    await server.waitForResponse(
      e => e.type === 'event' && e.event === 'semanticDiag'
    );
    const responses = server.responses.filter(
      resp =>
        resp.type === 'event' &&
        resp.event === 'semanticDiag' &&
        resp.body?.file === outfile
    );
    const lastDiagnostics: any[] =
      responses[responses.length - 1]?.body?.diagnostics ?? [];

    const hashMismatch = lastDiagnostics.find(
      d => d.code === MISSMATCH_HASH_TO_DOCUMENT
    );
    expect(
      hashMismatch,
      `expected hash-mismatch diagnostic, got: ${JSON.stringify(
        lastDiagnostics,
        null,
        2
      )}`
    ).toBeDefined();
    expect(hashMismatch).toMatchInlineSnapshot(`
      {
        "category": "warning",
        "code": 520103,
        "end": {
          "line": 33,
          "offset": 44,
        },
        "start": {
          "line": 33,
          "offset": 19,
        },
        "text": "The persisted document's hash is outdated",
      }
    `);

    // Also verify the "Insert document-id" refactor proposes the
    // correct hash — i.e. the digest of the query *with* the fragment.
    // If the bug regresses, the proposed hash flips to the query-only
    // value below.
    server.send({
      type: 'request',
      command: 'getEditsForRefactor',
      arguments: {
        file: outfile,
        startLine: 33,
        startOffset: 9,
        endLine: 33,
        endOffset: 9,
        refactor: 'GraphQL',
        action: 'Insert document-id',
      },
    });
    await server.waitForResponse(
      response =>
        response.type === 'response' &&
        response.command === 'getEditsForRefactor'
    );
    const refactorResponse = server.responses
      .reverse()
      .find(
        resp =>
          resp.type === 'response' && resp.command === 'getEditsForRefactor'
      );
    const replacement: string =
      refactorResponse!.body!.edits![0]!.textChanges![0]!.newText!.replaceAll(
        /"/g,
        ''
      );
    expect(replacement).toMatchInlineSnapshot(
      '"sha256:2cb43b8f11334b38ac959dd27b697b6a66d9cf0891929f138b2148c6c7ff33ca"'
    );

    const expectedHashedContent = print(
      parse(`
    query GetPokemonNested {
      pokemon(id: "x") {
        ...PokemonAttacks
      }
    }
    fragment PokemonAttacks on Pokemon {
      attacks {
        fast {
          name
          damage
        }
      }
    }
    `)
    );

    expect(replacement).toEqual(
      'sha256:' +
        createHash('sha256').update(expectedHashedContent).digest('hex')
    );
  }, 30000);
});
