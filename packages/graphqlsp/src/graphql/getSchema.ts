import {
  GraphQLSchema,
  buildSchema,
  buildClientSchema,
  getIntrospectionQuery,
  IntrospectionQuery,
  introspectionFromSchema,
} from 'graphql';
import path from 'path';
import JSON5 from 'json5';
import fetch from 'node-fetch';
import fs from 'fs';
import type { TsConfigJson } from 'type-fest';
import {
  resolveTypeScriptRootDir,
  minifyIntrospection,
  outputIntrospectionFile,
} from '@gql.tada/internal';

import { ts } from '../ts';
import { Logger } from '../index';

async function saveTadaIntrospection(
  root: string,
  schema: GraphQLSchema | IntrospectionQuery,
  tadaOutputLocation: string,
  shouldPreprocess: boolean,
  logger: Logger
) {
  const introspection = !('__schema' in schema)
    ? introspectionFromSchema(schema, { descriptions: false })
    : schema;

  const minified = minifyIntrospection(introspection, {
    includeDirectives: false,
    includeEnums: true,
    includeInputs: true,
    includeScalars: true,
  });

  const contents = await outputIntrospectionFile(introspection, {
    fileType: tadaOutputLocation,
    shouldPreprocess,
  });
  const json = JSON.stringify(minified, null, 2);

  let output = path.resolve(root, tadaOutputLocation);
  let stat: fs.Stats | undefined;

  try {
    stat = await fs.promises.stat(output);
  } catch (error) {
    logger(`Failed to resolve path @ ${output}`);
  }

  if (!stat) {
    try {
      stat = await fs.promises.stat(path.dirname(output));
      if (!stat.isDirectory()) {
        logger(`Output file is not inside a directory @ ${output}`);
        return;
      }
    } catch (error) {
      logger(`Directory does not exist @ ${output}`);
      return;
    }
  } else if (stat.isDirectory()) {
    output = path.join(output, 'introspection.d.ts');
  } else if (!stat.isFile()) {
    logger(`No file or directory found on path @ ${output}`);
    return;
  }

  await fs.promises.writeFile(output, contents);
  logger(`Introspection saved to path @ ${output}`);
}

export type SchemaOrigin = {
  url: string;
  headers: Record<string, unknown>;
};

const getRootDir = (
  info: ts.server.PluginCreateInfo,
  tsconfigPath: string
): string | undefined => {
  const tsconfigContents = info.project.readFile(tsconfigPath);
  const parsed = JSON5.parse<TsConfigJson>(tsconfigContents!);

  if (
    parsed.compilerOptions?.plugins?.find(x => x.name === '@0no-co/graphqlsp')
  ) {
    return path.dirname(tsconfigPath);
  } else if (Array.isArray(parsed.extends)) {
    return parsed.extends.find(p => {
      const resolved = path.resolve(path.dirname(tsconfigPath), p);
      return getRootDir(info, resolved);
    });
  } else if (parsed.extends) {
    const resolved = path.resolve(path.dirname(tsconfigPath), parsed.extends);
    return getRootDir(info, resolved);
  }
};

export const loadSchema = (
  info: ts.server.PluginCreateInfo,
  schema: SchemaOrigin | string,
  tadaOutputLocation: string | undefined,
  logger: Logger
): { current: GraphQLSchema | null; version: number } => {
  const root =
    resolveTypeScriptRootDir(
      info.project.readFile,
      info.project.getProjectName()
    ) || path.dirname(info.project.getProjectName());
  logger('Got root-directory to resolve schema from: ' + root);
  const ref: {
    current: GraphQLSchema | null;
    version: number;
    prev: string | null;
  } = {
    current: null,
    version: 0,
    prev: null,
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
          if (typeof result === 'string') {
            logger(`Got error while fetching introspection ${result}`);
          } else if (result.data) {
            const introspection = (result as { data: IntrospectionQuery }).data;
            const currentStringified = JSON.stringify(introspection);
            if (ref.prev && ref.prev === currentStringified) {
              return;
            }

            ref.prev = currentStringified;
            try {
              if (tadaOutputLocation) {
                saveTadaIntrospection(
                  root,
                  introspection,
                  tadaOutputLocation,
                  info.config.preProcess || false,
                  logger
                );
              }

              ref.current = buildClientSchema(introspection);
              ref.version = ref.version + 1;
              logger(`Got schema for ${url!.toString()}`);
            } catch (e: any) {
              logger(`Got schema error for ${e.message}`);
            }
          } else {
            logger(`Got invalid response ${JSON.stringify(result)}`);
          }
        });

      setTimeout(() => {
        pollSchema();
      }, 1000 * 60);
    };

    pollSchema();
  } else if (typeof schema === 'string') {
    const isJson = path.extname(schema) === '.json';
    const resolvedPath = path.resolve(root, schema);
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
          info.config.preProcess || false,
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
