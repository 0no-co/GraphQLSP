import {
  GraphQLSchema,
  buildSchema,
  buildClientSchema,
  getIntrospectionQuery,
  IntrospectionQuery,
  introspectionFromSchema,
} from 'graphql';

import { minifyIntrospectionQuery } from '@urql/introspection';
import fetch from 'node-fetch';
import path from 'path';
import fs from 'fs';

import { Logger } from '../index';

const dtsAnnotationComment = [
  '/** An IntrospectionQuery representation of your schema.',
  ' *',
  ' * @remarks',
  ' * This is an introspection of your schema saved as a file by GraphQLSP.',
  ' * It will automatically be used by `gql.tada` to infer the types of your GraphQL documents.',
  ' * If you need to reuse this data or update your `scalars`, update `tadaOutputLocation` to',
  ' * instead save to a .ts instead of a .d.ts file.',
  ' */',
].join('\n');

const tsAnnotationComment = [
  '/** An IntrospectionQuery representation of your schema.',
  ' *',
  ' * @remarks',
  ' * This is an introspection of your schema saved as a file by GraphQLSP.',
  ' * You may import it to create a `graphql()` tag function with `gql.tada`',
  ' * by importing it and passing it to `initGraphQLTada<>()`.',
  ' *',
  ' * @example',
  ' * ```',
  " * import { initGraphQLTada } from 'gql.tada';",
  " * import { introspection } from './introspection';",
  ' *',
  ' * export const graphql = initGraphQLTada<{',
  ' *   introspection: typeof introspection;',
  ' *   scalars: {',
  ' *     DateTime: string;',
  ' *     Json: any;',
  ' *   };',
  ' * }>();',
  ' * ```',
  ' */',
].join('\n');

async function saveTadaIntrospection(
  root: string,
  schema: GraphQLSchema | IntrospectionQuery,
  tadaOutputLocation: string,
  logger: Logger
) {
  const introspection = !('__schema' in schema)
    ? introspectionFromSchema(schema, { descriptions: false })
    : schema;

  const minified = minifyIntrospectionQuery(introspection, {
    includeDirectives: false,
    includeEnums: true,
    includeInputs: true,
    includeScalars: true,
  });

  const json = JSON.stringify(minified, null, 2);

  let output = path.resolve(path.dirname(root), tadaOutputLocation);
  let stat: fs.Stats;
  let contents = '';

  try {
    stat = await fs.promises.stat(output);
  } catch (error) {
    logger(`Failed to resolve path @ ${output}`);
    return;
  }

  if (stat.isDirectory()) {
    output = path.join(output, 'introspection.d.ts');
  } else if (!stat.isFile()) {
    logger(`No file or directory found on path @ ${output}`);
    return;
  }

  if (/\.d\.ts$/.test(output)) {
    contents = [
      dtsAnnotationComment,
      contents,
      `declare const introspection: ${json};\n`,
      "import * as gqlTada from 'gql.tada';\n",
      "declare module 'gql.tada' {",
      '  interface setupSchema {',
      '    introspection: typeof introspection',
      '  }',
      '}',
    ].join('\n');
  } else if (path.extname(output) === '.ts') {
    contents = [
      tsAnnotationComment,
      `const introspection = ${json} as const;\n`,
      'export { introspection };',
    ].join('\n');
  } else {
    logger(`Unknown file type on path @ ${output}`);
    return;
  }

  await fs.promises.writeFile(output, contents);
  logger(`Introspection saved to path @ ${output}`);
}

export type SchemaOrigin = {
  url: string;
  headers: Record<string, unknown>;
};

export const loadSchema = (
  root: string,
  schema: SchemaOrigin | string,
  tadaOutputLocation: string | undefined,
  logger: Logger
): { current: GraphQLSchema | null; version: number } => {
  const ref: { current: GraphQLSchema | null; version: number } = {
    current: null,
    version: 0,
  };
  let url: URL | undefined;
  let config: { headers: Record<string, unknown> } | undefined;

  try {
    if (typeof schema === 'object') {
      url = new URL(schema.url);
      config = { headers: schema.headers };
    } else {
      url = new URL(schema);
    }
  } catch (e) {}

  if (url) {
    const pollSchema = () => {
      logger(`Fetching introspection from ${url!.toString()}`);
      fetch(url!.toString(), {
        method: 'POST',
        headers: config
          ? {
              ...(config.headers || {}),
              'Content-Type': 'application/json',
            }
          : {
              'Content-Type': 'application/json',
            },
        body: JSON.stringify({
          query: getIntrospectionQuery({
            descriptions: true,
            schemaDescription: false,
            inputValueDeprecation: false,
            directiveIsRepeatable: false,
            specifiedByUrl: false,
          }),
        }),
      })
        .then(response => {
          logger(`Got response ${response.statusText} ${response.status}`);
          if (response.ok) return response.json();
          else return response.text();
        })
        .then(result => {
          // TODO: Prevent logging entire result or disable logging by default
          logger(`Got result ${JSON.stringify(result)}`);
          if (typeof result === 'string') {
            logger(`Got error while fetching introspection ${result}`);
          } else if (result.data) {
            try {
              if (tadaOutputLocation) {
                saveTadaIntrospection(
                  root,
                  result.data as IntrospectionQuery,
                  tadaOutputLocation,
                  logger
                );
              }

              ref.current = buildClientSchema(
                (result as { data: IntrospectionQuery }).data
              );
              ref.version = ref.version + 1;
              logger(`Got schema for ${url!.toString()}`);
            } catch (e: any) {
              logger(`Got schema error for ${e.message}`);
            }
          } else {
            logger(`Got invalid response ${JSON.stringify(result)}`);
          }
        });
    };

    pollSchema();
    setInterval(() => {
      pollSchema();
    }, 1000 * 60);
  } else if (typeof schema === 'string') {
    const isJson = path.extname(schema) === '.json';
    const resolvedPath = path.resolve(path.dirname(root), schema);
    logger(`Getting schema from ${resolvedPath}`);

    async function readSchema() {
      const contents = fs.readFileSync(resolvedPath, 'utf-8');

      const schemaOrIntrospection = isJson
        ? (JSON.parse(contents) as IntrospectionQuery)
        : buildSchema(contents);

      ref.version = ref.version + 1;
      ref.current =
        '__schema' in schemaOrIntrospection
          ? buildClientSchema(schemaOrIntrospection)
          : schemaOrIntrospection;

      if (tadaOutputLocation) {
        saveTadaIntrospection(
          root,
          schemaOrIntrospection,
          tadaOutputLocation,
          logger
        );
      }
    }

    readSchema();
    fs.watchFile(resolvedPath, () => {
      readSchema();
    });

    logger(`Got schema and initialized watcher for ${schema}`);
  }

  return ref;
};
