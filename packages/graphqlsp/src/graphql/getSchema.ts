import path from 'path';
import fs from 'fs';

import type { GraphQLSchema, IntrospectionQuery } from 'graphql';

import {
  type SchemaOrigin,
  load,
  resolveTypeScriptRootDir,
  minifyIntrospection,
  outputIntrospectionFile,
} from '@gql.tada/internal';

import { ts } from '../ts';
import { Logger } from '../index';

async function saveTadaIntrospection(
  introspection: IntrospectionQuery,
  tadaOutputLocation: string,
  disablePreprocessing: boolean,
  logger: Logger
) {
  const minified = minifyIntrospection(introspection);
  const contents = outputIntrospectionFile(minified, {
    fileType: tadaOutputLocation,
    shouldPreprocess: !disablePreprocessing,
  });

  let output = tadaOutputLocation;
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

export interface SchemaRef {
  current: GraphQLSchema | null;
  version: number;
}

export const loadSchema = (
  // TODO: abstract info away
  info: ts.server.PluginCreateInfo,
  origin: SchemaOrigin,
  logger: Logger
): SchemaRef => {
  const ref: SchemaRef = {
    current: null,
    version: 0,
  };

  (async () => {
    const rootPath =
      (await resolveTypeScriptRootDir(info.project.getProjectName())) ||
      path.dirname(info.project.getProjectName());
    const tadaDisablePreprocessing =
      info.config.tadaDisablePreprocessing ?? false;
    const tadaOutputLocation =
      info.config.tadaOutputLocation &&
      path.resolve(rootPath, info.config.tadaOutputLocation);

    logger('Got root-directory to resolve schema from: ' + rootPath);

    const loader = load({ origin, rootPath });
    let loaderResult = await loader.load();
    if (loaderResult) {
      ref.current = loaderResult && loaderResult.schema;
      ref.version++;
      if (tadaOutputLocation) {
        saveTadaIntrospection(
          loaderResult.introspection,
          tadaOutputLocation,
          tadaDisablePreprocessing,
          logger
        );
      }
    }

    loader.notifyOnUpdate(result => {
      logger(`Got schema for origin "${origin}"`);
      ref.current = (loaderResult = result).schema;
      ref.version++;
      if (tadaOutputLocation) {
        saveTadaIntrospection(
          loaderResult.introspection,
          tadaOutputLocation,
          tadaDisablePreprocessing,
          logger
        );
      }
    });
  })();

  return ref;
};
