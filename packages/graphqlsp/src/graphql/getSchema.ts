import type { Stats, PathLike } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'path';

import type { IntrospectionQuery } from 'graphql';

import {
  type SchemaLoaderResult,
  type SchemaRef as _SchemaRef,
  type GraphQLSPConfig,
  loadRef,
  minifyIntrospection,
  outputIntrospectionFile,
  resolveTypeScriptRootDir,
} from '@gql.tada/internal';

import { ts } from '../ts';
import { Logger } from '../index';

const statFile = (
  file: PathLike,
  predicate: (stat: Stats) => boolean
): Promise<boolean> => {
  return fs
    .stat(file)
    .then(predicate)
    .catch(() => false);
};

const touchFile = async (file: PathLike): Promise<void> => {
  try {
    const now = new Date();
    await fs.utimes(file, now, now);
  } catch (_error) {}
};

/** Writes a file to a swapfile then moves it into place to prevent excess change events. */
export const swapWrite = async (
  target: PathLike,
  contents: string
): Promise<void> => {
  if (!(await statFile(target, stat => stat.isFile()))) {
    // If the file doesn't exist, we can write directly, and not
    // try-catch so the error falls through
    await fs.writeFile(target, contents);
  } else {
    // If the file exists, we write to a swap-file, then rename (i.e. move)
    // the file into place. No try-catch around `writeFile` for proper
    // directory/permission errors
    const tempTarget = target + '.tmp';
    await fs.writeFile(tempTarget, contents);
    try {
      await fs.rename(tempTarget, target);
    } catch (error) {
      await fs.unlink(tempTarget);
      throw error;
    } finally {
      // When we move the file into place, we also update its access and
      // modification time manually, in case the rename doesn't trigger
      // a change event
      await touchFile(target);
    }
  }
};

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
  console.log('OUTPUT');
  if (await statFile(output, stat => stat.isDirectory())) {
    output = path.join(output, 'introspection.d.ts');
  } else if (!(await statFile(output, p => !!p))) {
    console.log('MAKING DIRECTORY', output);
    await fs.mkdir(path.dirname(output), { recursive: true });
    if (await statFile(output, stat => stat.isDirectory())) {
      output = path.join(output, 'introspection.d.ts');
    }
  }

  try {
    await swapWrite(output, contents);
    logger(`Introspection saved to path @ ${output}`);
  } catch (error) {
    logger(`Failed to write introspection @ ${error}`);
  }
}

export type SchemaRef = _SchemaRef<SchemaLoaderResult | null>;

export const loadSchema = (
  // TODO: abstract info away
  info: ts.server.PluginCreateInfo,
  origin: GraphQLSPConfig,
  logger: Logger
): _SchemaRef<SchemaLoaderResult | null> => {
  const ref = loadRef(origin);

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
    logger('Resolving schema from "schema" config: ' + JSON.stringify(origin));

    try {
      logger(`Loading schema...`);
      await ref.load({ rootPath });
    } catch (error) {
      logger(`Failed to load schema: ${error}`);
    }

    if (ref.current) {
      if (ref.current && ref.current.tadaOutputLocation !== undefined) {
        saveTadaIntrospection(
          ref.current.introspection,
          tadaOutputLocation,
          tadaDisablePreprocessing,
          logger
        );
      }
    } else if (ref.multi) {
      Object.values(ref.multi).forEach(value => {
        if (!value) return;

        if (value.tadaOutputLocation) {
          saveTadaIntrospection(
            value.introspection,
            path.resolve(rootPath, value.tadaOutputLocation),
            tadaDisablePreprocessing,
            logger
          );
        }
      });
    }

    ref.autoupdate({ rootPath }, (schemaRef, value) => {
      if (!value) return;

      if (value.tadaOutputLocation) {
        const found = schemaRef.multi
          ? schemaRef.multi[value.name as string]
          : schemaRef.current;
        if (!found) return;
        saveTadaIntrospection(
          found.introspection,
          path.resolve(rootPath, value.tadaOutputLocation),
          tadaDisablePreprocessing,
          logger
        );
      }
    });
  })();

  return ref as any;
};
