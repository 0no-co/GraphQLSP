import type { Stats, PathLike } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'path';

import type { IntrospectionQuery } from 'graphql';

import {
  type GraphQLSPConfig,
  type SchemaLoaderResult,
  type SchemaRef as InternalSchemaRef,
  type SingleSchemaInput,
  getURLConfig,
  loadRef,
  minifyIntrospection,
  outputIntrospectionFile,
  extractIntrospectionHeader,
  parseConfig,
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

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : `${error}`;

async function saveTadaIntrospection(
  introspection: IntrospectionQuery,
  tadaOutputLocation: string,
  disablePreprocessing: boolean,
  errors: SchemaErrors,
  outputLocations: Map<string, number>,
  logger: Logger
) {
  try {
    let output = tadaOutputLocation;
    if (await statFile(output, stat => stat.isDirectory())) {
      output = path.join(output, 'introspection.d.ts');
    } else if (!(await statFile(output, p => !!p))) {
      await fs.mkdir(path.dirname(output), { recursive: true });
      if (await statFile(output, stat => stat.isDirectory())) {
        output = path.join(output, 'introspection.d.ts');
      }
    }

    const existing = await fs.readFile(output, 'utf8').catch(() => undefined);
    const minified = minifyIntrospection(introspection);
    const contents = outputIntrospectionFile(minified, {
      fileType: tadaOutputLocation,
      shouldPreprocess: !disablePreprocessing,
      preamble: existing
        ? extractIntrospectionHeader(existing) || undefined
        : undefined,
    });

    await swapWrite(output, contents);
    errors.write.delete(tadaOutputLocation);
    outputLocations.set(output, Date.now());
    logger(`Introspection saved to path @ ${output}`);
  } catch (error) {
    errors.write.set(
      tadaOutputLocation,
      `Failed to write the typings file to "${tadaOutputLocation}": ${toErrorMessage(
        error
      )}`
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
  /** Schemas that failed to (re)load, e.g. a missing file, invalid SDL, or an
   * unreachable URL; keyed by schema name (`null` for single-schema setups
   * and failures that can't be attributed to a single schema). */
  load: Map<string | null, string>;
  /** Typings (tada output) files that failed to be written, keyed by their resolved output path. */
  write: Map<string, string>;
}

export interface SchemaRef {
  current: SchemaLoaderResult | null;
  multi: { [name: string]: SchemaLoaderResult | null };
  version: number;
  readonly errors: SchemaErrors;
  /** Typings output paths successfully written this session, mapped to their last write time. */
  readonly outputLocations: ReadonlyMap<string, number>;
  /** Best-effort detection of schema file changes that the file watcher
   * missed; throttled internally, so it's safe to call often. */
  checkStale(): void;
}

// `onError` on autoupdate and `reload` on load ship with newer
// @gql.tada/internal versions; older versions simply ignore both
type AutoupdateWithErrors = (
  config: { rootPath?: string },
  onUpdate: (
    ref: InternalSchemaRef<SchemaLoaderResult | null>,
    input: SingleSchemaInput
  ) => void,
  onError?: (error: Error, input?: SingleSchemaInput) => void
) => () => void;
type LoadWithReload = (config: {
  rootPath?: string;
  reload?: boolean;
}) => Promise<unknown>;

const EMPTY_MULTI: { [name: string]: SchemaLoaderResult | null } = {};
const STALE_CHECK_INTERVAL = 5_000;

export const loadSchema = (
  // TODO: abstract info away
  info: ts.server.PluginCreateInfo,
  logger: Logger
): SchemaRef => {
  const errors: SchemaErrors = {
    config: null,
    load: new Map(),
    write: new Map(),
  };
  const outputLocations = new Map<string, number>();

  let inner: InternalSchemaRef<SchemaLoaderResult | null> | null = null;
  let detectStaleSchemas: (() => void) | null = null;
  let lastStaleCheck = 0;

  const ref: SchemaRef = {
    errors,
    outputLocations,
    get current() {
      return inner && inner.current;
    },
    get multi() {
      return inner ? inner.multi : EMPTY_MULTI;
    },
    get version() {
      return inner ? inner.version : 0;
    },
    checkStale() {
      const now = Date.now();
      if (!detectStaleSchemas || now - lastStaleCheck < STALE_CHECK_INTERVAL)
        return;
      lastStaleCheck = now;
      detectStaleSchemas();
    },
  };

  (async () => {
    const projectName = info.project.getProjectName();
    const rootPath =
      (await resolveTypeScriptRootDir(projectName)) ||
      path.dirname(projectName);

    logger('Got root-directory to resolve schema from: ' + rootPath);

    let config: GraphQLSPConfig;
    try {
      config = parseConfig(info.config, rootPath);
    } catch (error) {
      errors.config = `${toErrorMessage(
        error
      )}. Update the GraphQLSP plugin's entry in "compilerOptions.plugins" in your tsconfig.json.`;
      logger(`Found invalid configuration: ${error}`);
      return;
    }

    const tadaDisablePreprocessing =
      info.config.tadaDisablePreprocessing ?? false;

    logger('Resolving schema from "schema" config: ' + JSON.stringify(config));
    inner = loadRef(config);

    const setLoadError = (name: string | null | undefined, error: unknown) => {
      errors.load.set(
        name || null,
        `Failed to load the GraphQL schema${
          name ? ` "${name}"` : ''
        }: ${toErrorMessage(error)}`
      );
    };

    const persistSchema = (value: SchemaLoaderResult | null | undefined) => {
      if (value && value.tadaOutputLocation) {
        saveTadaIntrospection(
          value.introspection,
          path.resolve(rootPath, value.tadaOutputLocation),
          tadaDisablePreprocessing,
          errors,
          outputLocations,
          logger
        );
      }
    };

    const persistAll = () => {
      if (inner!.current) persistSchema(inner!.current);
      for (const name in inner!.multi) persistSchema(inner!.multi[name]);
    };

    // Mtimes of file-based schemas, as of the last (attempted) load. When a
    // file is newer than its recorded mtime without the watcher having
    // reloaded it, a watch event was missed and a reload is forced
    const schemaFilePaths = ('schemas' in config ? config.schemas : [config])
      .map(input => input.schema)
      .filter(
        (origin): origin is string =>
          typeof origin === 'string' && !getURLConfig(origin)
      )
      .map(origin => path.resolve(rootPath, origin));
    const schemaFileMtimes = new Map<string, number>();
    const recordMtimes = async () => {
      await Promise.all(
        schemaFilePaths.map(async file => {
          try {
            schemaFileMtimes.set(file, (await fs.stat(file)).mtimeMs);
          } catch (_error) {}
        })
      );
    };

    // Re-checks all loaders before clearing load errors; this returns cached
    // results for healthy loaders and only retries failed ones, so e.g. one
    // schema updating in a multi-schema setup doesn't clear another schema's
    // error, and a recovered schema clears its own
    const revalidate = (reload?: boolean) =>
      (inner!.load as LoadWithReload)({ rootPath, reload })
        .then(() => {
          errors.load.clear();
        })
        .catch(error => {
          errors.load.clear();
          setLoadError(null, error);
        })
        .then(recordMtimes);

    detectStaleSchemas = () => {
      (async () => {
        let stale = false;
        for (const file of schemaFilePaths) {
          try {
            const lastMtime = schemaFileMtimes.get(file);
            const mtime = (await fs.stat(file)).mtimeMs;
            if (lastMtime !== undefined && mtime > lastMtime) stale = true;
          } catch (_error) {}
        }
        if (!stale) return;
        logger('Schema files changed without watcher events; reloading...');
        await revalidate(true);
        persistAll();
      })().catch(error => {
        logger(`Failed to check schemas for staleness: ${error}`);
      });
    };

    try {
      logger(`Loading schema...`);
      await inner.load({ rootPath });
      errors.load.clear();
    } catch (error) {
      setLoadError(null, error);
      logger(`Failed to load schema: ${error}`);
    }

    await recordMtimes();
    persistAll();

    (inner.autoupdate as AutoupdateWithErrors)(
      { rootPath },
      (schemaRef, value) => {
        revalidate();
        if (!value) return;

        const found = value.name
          ? schemaRef.multi[value.name]
          : schemaRef.current;
        if (found) persistSchema(found);
      },
      (error, input) => {
        // Reload failures while watching and retries of failed initial loads,
        // attributed per schema (@gql.tada/internal versions without support
        // for this callback never call it)
        errors.load.delete(null);
        setLoadError(input && input.name, error);
        recordMtimes();
        logger(
          `Failed to load schema${
            input && input.name ? ` "${input.name}"` : ''
          } while watching: ${error}`
        );
      }
    );
  })().catch(error => {
    // Failures ahead of schema loading itself, e.g. tsconfig root resolution
    // or invalid schema origins re-throwing during watcher setup, would
    // otherwise escape as an unhandled rejection with the error state unset
    setUnattributedError(errors, error);
    logger(`Unexpected error while loading schema: ${error}`);
  });

  return ref;
};

function setUnattributedError(errors: SchemaErrors, error: unknown) {
  errors.load.set(
    null,
    `Failed to load the GraphQL schema: ${toErrorMessage(error)}`
  );
}
