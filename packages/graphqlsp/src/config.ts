import type { SchemaOrigin } from '@gql.tada/internal';

import { ts } from './ts';

export interface Config {
  schema: SchemaOrigin;
  schemas: SchemaOrigin[];
  tadaDisablePreprocessing?: boolean;
  templateIsCallExpression?: boolean;
  shouldCheckForColocatedFragments?: boolean;
  template?: string;
  clientDirectives?: string[];
  trackFieldUsage?: boolean;
  tadaOutputLocation?: string;
  /** Set by tsserver on the synthetic config entries of "global" plugins,
   * i.e. plugins contributed by editor extensions, that received no
   * configuration overrides. */
  global?: boolean;
  /** Set by editor extensions on the configuration they pass through
   * tsserver's `configurePlugin`, which replaces the synthetic entry
   * carrying `global` above. */
  editorContributed?: boolean;
}

/** Names GraphQLSP ships under in tsconfig "plugins" entries. */
const PLUGIN_NAMES = new Set(['@0no-co/graphqlsp', 'gql.tada/ts-plugin']);

const getPackageName = (pluginName: string): string => {
  const parts = pluginName.split('/');
  return pluginName.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
};

/** Checks whether a tsconfig plugin can be resolved from the project's local
 * node_modules tree without loading it. Older GraphQLSP releases don't expose
 * the shared instance marker, so package presence is the only side-effect-free
 * way for an editor-contributed copy to defer to them before they initialize. */
const hasLocalPluginPackage = (
  info: ts.server.PluginCreateInfo,
  pluginName: string
): boolean => {
  const packageName = getPackageName(pluginName);
  let directory = info.project.getCurrentDirectory();

  while (true) {
    const manifest = ts.combinePaths(
      directory,
      'node_modules',
      packageName,
      'package.json'
    );
    if (info.project.fileExists(manifest)) return true;

    const parent = ts.getDirectoryPath(directory);
    if (parent === directory) return false;
    directory = parent;
  }
};

/** Resolves the configuration this instance should run with, or `null` to
 * stay dormant.
 *
 * A project-local instance (configured through a tsconfig "plugins" entry)
 * always runs with its entry as-is. For an editor-contributed ("global")
 * instance the project's configuration wins over editor settings:
 * - a live local instance already handles the project → stay dormant,
 * - an installed older local instance has no marker → stay dormant,
 * - a tsconfig entry whose package is unavailable → adopt its configuration,
 * - editor settings passed through `configurePlugin` → use them,
 * - no configuration anywhere → stay dormant, so unrelated projects don't
 *   get "missing schema" configuration errors. */
export function resolveConfig(
  info: ts.server.PluginCreateInfo,
  logger: (message: string) => void,
  instanceMarker: symbol
): Config | null {
  const config: Config = info.config;
  if (!config.global && !config.editorContributed) return config;

  if ((info.languageService as any)[instanceMarker]) {
    logger('The project already has a GraphQLSP instance; deferring to it');
    return null;
  }

  const plugins = (info.project.getCompilerOptions().plugins || []) as Array<
    ts.PluginImport & Partial<Config>
  >;
  const localEntry = plugins.find(entry => PLUGIN_NAMES.has(entry.name));
  if (localEntry) {
    if (hasLocalPluginPackage(info, localEntry.name)) {
      logger(
        `The project has a local "${localEntry.name}" installation; deferring to it`
      );
      return null;
    }

    logger(
      `Adopting the project's "${localEntry.name}" tsconfig configuration because its local package is unavailable`
    );
    return localEntry as Config;
  }

  if (config.schema !== undefined || config.schemas !== undefined) {
    return config;
  }

  logger('Loaded as a global plugin without configuration; skipping setup');
  return null;
}
