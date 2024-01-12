import {
  GraphQLSchema,
  buildSchema,
  buildClientSchema,
  getIntrospectionQuery,
  IntrospectionQuery,
} from 'graphql';
import fetch from 'node-fetch';
import path from 'path';
import fs from 'fs';

import { Logger } from '../index';

export type SchemaOrigin = {
  url: string;
  headers: Record<string, unknown>;
};

export const loadSchema = (
  root: string,
  schema: SchemaOrigin | string,
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
          logger(`Got result ${JSON.stringify(result)}`);
          if (typeof result === 'string') {
            logger(`Got error while fetching introspection ${result}`);
          } else if (result.data) {
            try {
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
    const isJson = schema.endsWith('json');
    const resolvedPath = path.resolve(path.dirname(root), schema);
    logger(`Getting schema from ${resolvedPath}`);
    const contents = fs.readFileSync(resolvedPath, 'utf-8');

    fs.watchFile(resolvedPath, () => {
      const contents = fs.readFileSync(resolvedPath, 'utf-8');
      ref.current = isJson
        ? buildClientSchema(JSON.parse(contents))
        : buildSchema(contents);
      ref.version = ref.version + 1;
    });

    ref.current = isJson
      ? buildClientSchema(JSON.parse(contents))
      : buildSchema(contents);
    ref.version = ref.version + 1;

    logger(`Got schema and initialized watcher for ${schema}`);
  }

  return ref;
};
