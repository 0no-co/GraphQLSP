// A minimal TypeScript 7.1 content mapper for tests, which maps each `.graphql`
// file to a module exporting its operation through an aliased `graphql()`,
// like @gql.tada/content-mapper does. Documents are emitted as string literals
// with escape sequences, which persisted hashes have to be computed without.
let buffer = Buffer.alloc(0);

const send = message => {
  const json = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }));
  process.stdout.write(`Content-Length: ${json.length}\r\n\r\n`);
  process.stdout.write(json);
};

const transform = ({ content }) => {
  const match =
    /(?:query|mutation|subscription)\s+([_A-Za-z][_0-9A-Za-z]*)/.exec(content);
  const name = match ? match[1] : 'Document';
  return {
    text:
      'import { graphql as $graphql } from "./graphql.js";\n' +
      `export const ${name} = $graphql(${JSON.stringify(content)});\n`,
    extension: '.ts',
    mappings: [],
  };
};

const handlers = {
  initialize: () => ({
    protocolVersion: 1,
    positionEncoding: 'utf-16',
    diagnosticSource: 'test-mapper',
  }),
  openProject: () => ({}),
  closeProject: () => null,
  transform,
};

process.stdin.on('data', chunk => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const length = Number(
      /Content-Length: (\d+)/i.exec(buffer.subarray(0, headerEnd).toString())[1]
    );
    if (buffer.length < headerEnd + 4 + length) return;
    const message = JSON.parse(
      buffer.subarray(headerEnd + 4, headerEnd + 4 + length).toString()
    );
    buffer = buffer.subarray(headerEnd + 4 + length);
    if (message.id === undefined) continue;
    const handler = handlers[message.method];
    if (handler) {
      send({ id: message.id, result: handler(message.params) });
    } else {
      send({
        id: message.id,
        error: { code: -32601, message: `Unknown method ${message.method}` },
      });
    }
  }
});
