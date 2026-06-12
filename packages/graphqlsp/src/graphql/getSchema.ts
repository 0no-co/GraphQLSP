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
  errors: SchemaErrors,
  logger: Logger
) {
  try {
    const minified = minifyIntrospection(introspection);
    const contents = outputIntrospectionFile(minified, {
      fileType: tadaOutputLocation,
      shouldPreprocess: !disablePreprocessing,
    });

    let output = tadaOutputLocation;
    if (await statFile(output, stat => stat.isDirectory())) {
      output = path.join(output, 'introspection.d.ts');
    } else if (!(await statFile(output, p => !!p))) {
      await fs.mkdir(path.dirname(output), { recursive: true });
      if (await statFile(output, stat => stat.isDirectory())) {
        output = path.join(output, 'introspection.d.ts');
      }
    }

    await swapWrite(output, contents);
    errors.write.delete(tadaOutputLocation);
    logger(`Introspection saved to path @ ${output}`);
  } catch (error) {
    errors.write.set(
      tadaOutputLocation,
      `Failed to write the typings file to "${tadaOutputLocation}": ${
        error instanceof Error ? error.message : error
      }`
    );
    logger(`Failed to write introspection @ ${error}`);
  }
}

/** Mutable record of configuration and loading failures.
 *
 * These are surfaced as editor diagnostics on files containing GraphQL
 * documents, so a misconfigured plugin doesn't fail silently with its
 * errors only visible in the tsserver log. */
export interface SchemaErrors {
  /** The plugin configuration itself is invalid, e.g. the "schema" option is missing. */
  config: string | null;
  /** Loading the schema failed, e.g. a missing file, invalid SDL, or an unreachable URL. */
  load: string | null;
  /** Writing a tada output (typings) file failed, keyed by configured output location. */
  write: Map<string, string>;
}

export type SchemaRef = _SchemaRef<SchemaLoaderResult | null> & {
  errors: SchemaErrors;
};

/** Creates an inert ref for when the plugin configuration is too broken to load a schema at all. */
export const createErrorRef = (configError: string): SchemaRef => {
  const ref: SchemaRef = {
    version: 0,
    current: null,
    multi: {},
    autoupdate: () => () => {
      /*noop*/
    },
    load: () => Promise.resolve(ref as any),
    errors: { config: configError, load: null, write: new Map() },
  };
  return ref;
};

export const loadSchema = (
  // TODO: abstract info away
  info: ts.server.PluginCreateInfo,
  origin: GraphQLSPConfig,
  logger: Logger
): SchemaRef => {
  const errors: SchemaErrors = { config: null, load: null, write: new Map() };
  const ref = Object.assign(loadRef(origin), { errors });

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
      errors.load = null;
    } catch (error) {
      errors.load = `Failed to load the GraphQL schema: ${
        error instanceof Error ? error.message : error
      }`;
      logger(`Failed to load schema: ${error}`);
    }

    if (ref.current) {
      if (ref.current && ref.current.tadaOutputLocation !== undefined) {
        saveTadaIntrospection(
          ref.current.introspection,
          tadaOutputLocation,
          tadaDisablePreprocessing,
          errors,
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
            errors,
            logger
          );
        }
      });
    }

    ref.autoupdate({ rootPath }, (schemaRef, value) => {
      // The autoupdate callback only fires for successful (re)loads, so a
      // previously failing schema has recovered, e.g. after fixing a broken
      // schema file
      errors.load = null;
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
          errors,
          logger
        );
      }
    });
  })();

  return ref;
};
