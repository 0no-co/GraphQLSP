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
import { generateBaseTypes } from './generateTypes';

export const loadSchema = (
  root: string,
  schema: string,
  logger: Logger,
  baseTypesPath: string,
  scalars: Record<string, unknown>
): { current: GraphQLSchema | null } => {
  const ref: { current: GraphQLSchema | null } = { current: null };
  let url: URL | undefined;

  try {
    url = new URL(schema);
  } catch (e) {}

  if (url) {
    logger(`Fetching introspection from ${url.toString()}`);
    fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: getIntrospectionQuery({
          descriptions: true,
          schemaDescription: true,
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
        if (typeof result === 'string') {
          logger(`Got error while fetching introspection ${result}`);
        } else {
          try {
            ref.current = buildClientSchema(
              (result as { data: IntrospectionQuery }).data
            );
            logger(`Got schema for ${url!.toString()}`);
            generateBaseTypes(ref.current, baseTypesPath, scalars);
          } catch (e: any) {
            logger(`Got schema error for ${e.message}`);
          }
        }
      });
  } else {
    const isJson = schema.endsWith('json');
    const resolvedPath = path.resolve(path.dirname(root), schema);
    logger(`Getting schema from ${resolvedPath}`);
    const contents = fs.readFileSync(resolvedPath, 'utf-8');

    fs.watchFile(resolvedPath, () => {
      const contents = fs.readFileSync(resolvedPath, 'utf-8');
      ref.current = isJson
        ? buildClientSchema(JSON.parse(contents))
        : buildSchema(contents);
      generateBaseTypes(ref.current, baseTypesPath, scalars);
    });

    ref.current = isJson
      ? buildClientSchema(JSON.parse(contents))
      : buildSchema(contents);
    generateBaseTypes(ref.current, baseTypesPath, scalars);
    logger(`Got schema and initialized watcher for ${schema}`);
  }

  return ref;
};
