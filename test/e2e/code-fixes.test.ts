import { expect, afterAll, beforeAll, it, describe } from 'vitest';
import { TSServer } from './server';
import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';
import ts from 'typescript/lib/tsserverlibrary';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const projectPath = path.resolve(__dirname, 'fixture-project-code-fixes');
describe('Code fixes', () => {
  const outfileDidYouMean = path.join(projectPath, 'did-you-mean.ts');
  const outfileDeprecated = path.join(projectPath, 'deprecated.ts');

  let server: TSServer;

  const isCodeFixResponse = (response: any) =>
    response.type === 'response' && response.command === 'getCodeFixes';

  const requestCodeFixes = async (
    args: ts.server.protocol.CodeFixRequestArgs
  ): Promise<any> => {
    const seen = server.responses.filter(isCodeFixResponse).length;
    server.sendCommand('getCodeFixes', args);
    await server.waitForResponse(
      response =>
        isCodeFixResponse(response) &&
        server.responses.filter(isCodeFixResponse).length > seen
    );
    const responses = server.responses.filter(isCodeFixResponse);
    const body = responses[responses.length - 1].body || [];
    // Snapshots have to stay machine-independent
    return body.map((fix: any) => ({
      ...fix,
      changes: fix.changes.map((change: any) => ({
        ...change,
        fileName: path.relative(projectPath, change.fileName),
      })),
    }));
  };

  beforeAll(async () => {
    server = new TSServer(projectPath, { debugLog: false });

    server.sendCommand('open', {
      file: outfileDidYouMean,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);
    server.sendCommand('open', {
      file: outfileDeprecated,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);

    server.sendCommand('updateOpen', {
      openFiles: [
        {
          file: outfileDidYouMean,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/did-you-mean.ts'),
            'utf-8'
          ),
        },
        {
          file: outfileDeprecated,
          fileContent: fs.readFileSync(
            path.join(projectPath, 'fixtures/deprecated.ts'),
            'utf-8'
          ),
        },
      ],
    } satisfies ts.server.protocol.UpdateOpenRequestArgs);

    server.sendCommand('saveto', {
      file: outfileDidYouMean,
      tmpfile: outfileDidYouMean,
    } satisfies ts.server.protocol.SavetoRequestArgs);
    server.sendCommand('saveto', {
      file: outfileDeprecated,
      tmpfile: outfileDeprecated,
    } satisfies ts.server.protocol.SavetoRequestArgs);
  });

  afterAll(() => {
    try {
      fs.unlinkSync(outfileDidYouMean);
      fs.unlinkSync(outfileDeprecated);
    } catch {}
    server.close();
  });

  it('advertises GraphQL diagnostics as supporting code fixes', async () => {
    await server.waitForResponse(
      e =>
        e.type === 'event' &&
        e.event === 'semanticDiag' &&
        e.body?.file === outfileDidYouMean,
      true
    );

    server.sendCommand('getSupportedCodeFixes');
    await server.waitForResponse(
      response =>
        response.type === 'response' &&
        response.command === 'getSupportedCodeFixes'
    );
    const response = [...server.responses]
      .reverse()
      .find(
        response =>
          response.type === 'response' &&
          response.command === 'getSupportedCodeFixes'
      ) as ts.server.protocol.Response;

    expect(response.body).toEqual(
      expect.arrayContaining(['52001', '52004', '52005'])
    );
  }, 30000);

  it('gives quick fixes for "Did you mean" suggestions', async () => {
    await server.waitForResponse(
      e =>
        e.type === 'event' &&
        e.event === 'semanticDiag' &&
        e.body?.file === outfileDidYouMean,
      true
    );

    const diagnostics = server.responses.filter(
      resp =>
        resp.type === 'event' &&
        resp.event === 'semanticDiag' &&
        resp.body?.file === outfileDidYouMean
    );
    expect(diagnostics[0].body.diagnostics.filter((x: any) => x.code === 52001))
      .toMatchInlineSnapshot(`
        [
          {
            "category": "error",
            "code": 52001,
            "end": {
              "line": 9,
              "offset": 1,
            },
            "start": {
              "line": 8,
              "offset": 7,
            },
            "text": "Cannot query field "nam" on type "Pokemon". Did you mean "name"?",
          },
          {
            "category": "error",
            "code": 52001,
            "end": {
              "line": 16,
              "offset": 12,
            },
            "start": {
              "line": 16,
              "offset": 5,
            },
            "text": "Cannot query field "pokemo" on type "Query". Did you mean "pokemon" or "pokemons"?",
          },
        ]
      `);

    const fixes = await requestCodeFixes({
      file: outfileDidYouMean,
      startLine: 8,
      startOffset: 7,
      endLine: 8,
      endOffset: 10,
      errorCodes: [52001],
    });

    expect(fixes).toMatchInlineSnapshot(`
      [
        {
          "changes": [
            {
              "fileName": "did-you-mean.ts",
              "textChanges": [
                {
                  "end": {
                    "line": 8,
                    "offset": 10,
                  },
                  "newText": "name",
                  "start": {
                    "line": 8,
                    "offset": 7,
                  },
                },
              ],
            },
          ],
          "description": "Change 'nam' to 'name'",
          "fixName": "graphqlDidYouMean",
        },
      ]
    `);
  }, 30000);

  it('gives one quick fix per "Did you mean" suggestion', async () => {
    await server.waitForResponse(
      e =>
        e.type === 'event' &&
        e.event === 'semanticDiag' &&
        e.body?.file === outfileDidYouMean,
      true
    );

    const fixes = await requestCodeFixes({
      file: outfileDidYouMean,
      startLine: 16,
      startOffset: 5,
      endLine: 16,
      endOffset: 11,
      errorCodes: [52001],
    });

    expect(fixes).toMatchInlineSnapshot(`
      [
        {
          "changes": [
            {
              "fileName": "did-you-mean.ts",
              "textChanges": [
                {
                  "end": {
                    "line": 16,
                    "offset": 11,
                  },
                  "newText": "pokemon",
                  "start": {
                    "line": 16,
                    "offset": 5,
                  },
                },
              ],
            },
          ],
          "description": "Change 'pokemo' to 'pokemon'",
          "fixName": "graphqlDidYouMean",
        },
        {
          "changes": [
            {
              "fileName": "did-you-mean.ts",
              "textChanges": [
                {
                  "end": {
                    "line": 16,
                    "offset": 11,
                  },
                  "newText": "pokemons",
                  "start": {
                    "line": 16,
                    "offset": 5,
                  },
                },
              ],
            },
          ],
          "description": "Change 'pokemo' to 'pokemons'",
          "fixName": "graphqlDidYouMean",
        },
      ]
    `);
  }, 30000);

  it('gives a quick fix replacing a deprecated field when the reason names a replacement', async () => {
    await server.waitForResponse(
      e =>
        e.type === 'event' &&
        e.event === 'semanticDiag' &&
        e.body?.file === outfileDeprecated,
      true
    );

    const diagnostics = server.responses.filter(
      resp =>
        resp.type === 'event' &&
        resp.event === 'semanticDiag' &&
        resp.body?.file === outfileDeprecated
    );
    expect(diagnostics[0].body.diagnostics.filter((x: any) => x.code === 52004))
      .toMatchInlineSnapshot(`
      [
        {
          "category": "warning",
          "code": 52004,
          "end": {
            "line": 9,
            "offset": 1,
          },
          "start": {
            "line": 8,
            "offset": 7,
          },
          "text": "The field Pokemon.nickname is deprecated. Use \`name\` instead",
        },
        {
          "category": "warning",
          "code": 52004,
          "end": {
            "line": 10,
            "offset": 1,
          },
          "start": {
            "line": 9,
            "offset": 7,
          },
          "text": "The field Pokemon.level is deprecated. This field is replaced by \`power\`",
        },
        {
          "category": "warning",
          "code": 52004,
          "end": {
            "line": 11,
            "offset": 1,
          },
          "start": {
            "line": 10,
            "offset": 7,
          },
          "text": "The field Pokemon.fleeRate is deprecated. No longer supported",
        },
      ]
    `);

    // "Use `name` instead"
    const backtickedUse = await requestCodeFixes({
      file: outfileDeprecated,
      startLine: 8,
      startOffset: 7,
      endLine: 8,
      endOffset: 15,
      errorCodes: [52004],
    });
    expect(backtickedUse).toMatchInlineSnapshot(`
      [
        {
          "changes": [
            {
              "fileName": "deprecated.ts",
              "textChanges": [
                {
                  "end": {
                    "line": 8,
                    "offset": 15,
                  },
                  "newText": "name",
                  "start": {
                    "line": 8,
                    "offset": 7,
                  },
                },
              ],
            },
          ],
          "description": "Replace deprecated field 'nickname' with 'name'",
          "fixName": "graphqlReplaceDeprecatedField",
        },
      ]
    `);

    // "This field is replaced by `power`"
    const replacedBy = await requestCodeFixes({
      file: outfileDeprecated,
      startLine: 9,
      startOffset: 7,
      endLine: 9,
      endOffset: 12,
      errorCodes: [52004],
    });
    expect(replacedBy).toMatchInlineSnapshot(`
      [
        {
          "changes": [
            {
              "fileName": "deprecated.ts",
              "textChanges": [
                {
                  "end": {
                    "line": 9,
                    "offset": 12,
                  },
                  "newText": "power",
                  "start": {
                    "line": 9,
                    "offset": 7,
                  },
                },
              ],
            },
          ],
          "description": "Replace deprecated field 'level' with 'power'",
          "fixName": "graphqlReplaceDeprecatedField",
        },
      ]
    `);
  }, 30000);

  it('gives no quick fix when a deprecation reason has no replacement', async () => {
    await server.waitForResponse(
      e =>
        e.type === 'event' &&
        e.event === 'semanticDiag' &&
        e.body?.file === outfileDeprecated,
      true
    );

    // "No longer supported"
    const fixes = await requestCodeFixes({
      file: outfileDeprecated,
      startLine: 10,
      startOffset: 7,
      endLine: 10,
      endOffset: 15,
      errorCodes: [52004],
    });
    expect(fixes).toEqual([]);
  }, 30000);
});
