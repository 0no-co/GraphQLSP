import { Buffer } from 'node:buffer';
import type { Stats, PathLike } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'path';

import type { GraphQLSchema, IntrospectionQuery } from 'graphql';

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
import type { GraphQLSPHost } from '../host';
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

let swapFileCounter = 0;

const getSwapFilePath = (target: PathLike): PathLike => {
  const suffix = `.${process.pid}.${swapFileCounter++}.tmp`;
  if (typeof target === 'string') return target + suffix;
  if (Buffer.isBuffer(target))
    return Buffer.concat([target, Buffer.from(suffix)]);

  const tempTarget = new URL(target);
  tempTarget.pathname += suffix;
  return tempTarget;
};

/** Writes changed contents to a swapfile then moves it into place. */
export const swapWrite = async (
  target: PathLike,
  contents: string
): Promise<void> => {
  const existing = await fs.readFile(target).catch(() => undefined);
  if (existing?.equals(Buffer.from(contents))) return;

  // We write to a swap-file, then rename (i.e. move) the file into place.
  // No try-catch around `writeFile` for proper directory/permission errors.
  // The swap-file's name must be unique per process and call. Multiple
  // plugin instances may target the same output file (e.g. several TS
  // projects in a monorepo sharing one `tadaOutputLocation`), and a
  // shared swap-file name would let one instance rename the file away
  // while another still expects it, while direct writes to the target
  // could interleave
  const tempTarget = getSwapFilePath(target);
  await fs.writeFile(tempTarget, contents);
  try {
    // Windows can briefly lock the destination while another instance touches
    // or reads its typings. Retry the atomic replacement; never delete it first.
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(tempTarget, target);
        break;
      } catch (error) {
        if (
          process.platform !== 'win32' ||
          attempt >= 20 ||
          !['EPERM', 'EACCES', 'EBUSY'].includes(
            (error as NodeJS.ErrnoException).code || ''
          )
        )
          throw error;
        await new Promise(resolve => setTimeout(resolve, 5 * (attempt + 1)));
      }
    }
  } catch (error) {
    // Clean-up is best-effort and must not mask the rename error
    await fs.unlink(tempTarget).catch(() => {});
    throw error;
  } finally {
    // When we move the file into place, we also update its access and
    // modification time manually, in case the rename doesn't trigger
    // a change event
    await touchFile(target);
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
  /** File-based schema origins, keyed by schema name (`null` for single-schema setups). */
  readonly sourceLocations: ReadonlyMap<string | null, string>;
  /** gql.tada turbo cache files, keyed by schema name (`null` for single-schema setups). */
  readonly turboLocations: ReadonlyMap<string | null, string>;
  /** Best-effort detection of schema file changes that the file watcher
   * missed; throttled internally, so it's safe to call often. */
  checkStale(force?: boolean): void;
  /** Settles once the initial schema load has finished, successfully or not;
   * failures are reported through `errors` instead. */
  readonly ready: Promise<void>;
}

export interface LoadSchemaOptions {
  /** Directory relative schema paths resolve against. Defaults to the
   * `tsconfig.json` root directory of the project. */
  rootPath?: string;
  /** Whether to keep watching schemas for changes after the initial load.
   * @defaultValue `true` */
  watch?: boolean;
  /** Whether to write gql.tada typings (`tadaOutputLocation`) files.
   * @defaultValue `true` */
  persist?: boolean;
  /** Called after schemas were reloaded, e.g. once their files changed. */
  onChange?: () => void;
}

/** Falls back to the `current` schema for single-schema setups or unnamed documents. */
export const getSchemaForName = (
  schema: SchemaRef,
  schemaName: string | null
): GraphQLSchema | undefined =>
  schemaName && schema.multi[schemaName]
    ? schema.multi[schemaName]?.schema
    : schema.current?.schema;

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
  info: GraphQLSPHost,
  logger: Logger,
  options: LoadSchemaOptions = {}
): SchemaRef => {
  const errors: SchemaErrors = {
    config: null,
    load: new Map(),
    write: new Map(),
  };
  const outputLocations = new Map<string, number>();
  const sourceLocations = new Map<string | null, string>();
  const turboLocations = new Map<string | null, string>();

  let inner: InternalSchemaRef<SchemaLoaderResult | null> | null = null;
  let detectStaleSchemas: (() => void) | null = null;
  let lastStaleCheck = 0;
  let revision = 0;

  let ready: Promise<void> = Promise.resolve();
  const ref: SchemaRef = {
    get ready() {
      return ready;
    },
    errors,
    outputLocations,
    sourceLocations,
    turboLocations,
    get current() {
      return inner && inner.current;
    },
    get multi() {
      return inner ? inner.multi : EMPTY_MULTI;
    },
    get version() {
      return (inner ? inner.version : 0) + revision;
    },
    checkStale(force = false) {
      const now = Date.now();
      if (
        !detectStaleSchemas ||
        (!force && now - lastStaleCheck < STALE_CHECK_INTERVAL)
      )
        return;
      lastStaleCheck = now;
      detectStaleSchemas();
    },
  };

  ready = (async () => {
    const projectName = info.project.getProjectName();
    const rootPath =
      options.rootPath ||
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

    sourceLocations.clear();
    turboLocations.clear();
    const rememberLocations = (
      name: string | null,
      input: SingleSchemaInput
    ) => {
      if (typeof input.schema === 'string' && !getURLConfig(input.schema)) {
        sourceLocations.set(name, path.resolve(rootPath, input.schema));
      }
      if (input.tadaTurboLocation) {
        turboLocations.set(
          name,
          path.resolve(rootPath, input.tadaTurboLocation)
        );
      }
    };
    if ('schemas' in config) {
      for (const input of config.schemas) rememberLocations(input.name, input);
    } else {
      rememberLocations(null, config);
    }

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
      if (options.persist === false) return;
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
    const schemaFileMtimes = new Map<string, number | null>();
    const recordMtimes = async () => {
      await Promise.all(
        schemaFilePaths.map(async file => {
          try {
            schemaFileMtimes.set(file, (await fs.stat(file)).mtimeMs);
          } catch (_error) {
            schemaFileMtimes.set(file, null);
          }
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

    let reloading: Promise<void> | undefined;
    let reloadQueued = false;
    detectStaleSchemas = () => {
      if (reloading) {
        reloadQueued = true;
        return;
      }
      reloading = (async () => {
        const changed = new Set<string>();
        const observed = new Map<string, number | null>();
        for (const file of schemaFilePaths) {
          let mtime: number | null = null;
          try {
            mtime = (await fs.stat(file)).mtimeMs;
          } catch (_error) {}
          observed.set(file, mtime);
          if (mtime !== schemaFileMtimes.get(file)) changed.add(file);
        }
        if (!changed.size) return;
        revision++;
        logger('Schema files changed without watcher events; reloading...');
        // A failed reload must not leave the previous schema active. Healthy
        // schemas in a multi-schema configuration remain available.
        for (const [name, file] of sourceLocations) {
          if (!changed.has(file)) continue;
          if (name) inner!.multi[name] = null;
          else inner!.current = null;
        }
        await revalidate(true);
        // Preserve the pre-read state so a concurrent file change is not lost.
        for (const [file, mtime] of observed) schemaFileMtimes.set(file, mtime);
        persistAll();
        if (options.onChange) options.onChange();
      })()
        .catch(error => {
          logger(`Failed to check schemas for staleness: ${error}`);
        })
        .finally(() => {
          reloading = undefined;
          if (reloadQueued) {
            reloadQueued = false;
            detectStaleSchemas?.();
          }
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

    if (options.watch === false) return;

    (inner.autoupdate as AutoupdateWithErrors)(
      { rootPath },
      (schemaRef, value) => {
        revalidate().then(() => {
          if (options.onChange) options.onChange();
        });
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
