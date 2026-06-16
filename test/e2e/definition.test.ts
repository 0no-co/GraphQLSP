import { expect, afterAll, beforeAll, it, describe } from 'vitest';
import { TSServer } from './server';
import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';
import ts from 'typescript/lib/tsserverlibrary';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const projectPath = path.resolve(__dirname, 'fixture-project-tada');
const outfile = path.join(projectPath, 'definition.ts');
const fixture = fs.readFileSync(
  path.join(projectPath, 'fixtures/definition.ts'),
  'utf-8'
);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const positionAt = (text: string, index: number) => {
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  const lastNewline = before.lastIndexOf('\n');
  return { line, offset: index - lastNewline };
};

const requestDefinition = async (
  server: TSServer,
  position: { line: number; offset: number }
) => {
  server.send({
    type: 'request',
    command: 'definition',
    arguments: {
      file: outfile,
      line: position.line,
      offset: position.offset,
    },
  });

  await server.waitForResponse(
    response =>
      response.type === 'response' && response.command === 'definition'
  );

  return server.responses
    .slice()
    .reverse()
    .find(
      response =>
        response.type === 'response' && response.command === 'definition'
    ) as ts.server.protocol.Response;
};

const waitForDefinition = async (
  server: TSServer,
  position: { line: number; offset: number },
  predicate: (definition: any) => boolean
) => {
  let lastResponse: ts.server.protocol.Response | undefined;
  for (let attempt = 0; attempt < 20; attempt++) {
    lastResponse = await requestDefinition(server, position);
    const definitions = (lastResponse.body || []) as any[];
    const definition = definitions.find(predicate);
    if (definition) return definition;
    await sleep(250);
  }

  throw new Error(
    `Expected definition was not found. Last response: ${JSON.stringify(
      lastResponse?.body,
      null,
      2
    )}`
  );
};

describe('go-to-definition', () => {
  let server: TSServer;

  beforeAll(async () => {
    server = new TSServer(projectPath, { debugLog: false });

    server.sendCommand('open', {
      file: outfile,
      fileContent: '// empty',
      scriptKindName: 'TS',
    } satisfies ts.server.protocol.OpenRequestArgs);

    server.sendCommand('updateOpen', {
      openFiles: [{ file: outfile, fileContent: fixture }],
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
    server.close();
  });

  it('remaps gql.tada turbo-cache result fields to the source GraphQL document', async () => {
    const position = positionAt(
      fixture,
      fixture.indexOf('data.pokemon') + 'data.'.length
    );

    const definition = await waitForDefinition(
      server,
      position,
      definition => path.normalize(definition.file) === outfile
    );

    expect(path.normalize(definition.file)).toBe(outfile);
    expect(definition.start).toEqual({ line: 5, offset: 5 });
  }, 30000);

  it('maps GraphQL document fields to their schema definitions', async () => {
    const schemaFile = path.join(projectPath, 'schema.graphql');
    const position = positionAt(fixture, fixture.indexOf('      name') + 6);

    const definition = await waitForDefinition(
      server,
      position,
      definition => path.normalize(definition.file) === schemaFile
    );

    expect(path.normalize(definition.file)).toBe(schemaFile);
    expect(definition.start).toEqual({ line: 48, offset: 3 });
  }, 30000);
});
