import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const PLUGIN_NAMES = new Set([
  '@0no-co/graphqlsp',
  'gql.tada/ts-plugin',
  'gql.tada/lsp',
]);

export interface PluginConfigEntry {
  /** The GraphQLSP plugin entry from `compilerOptions.plugins`. */
  config: Record<string, any>;
  /** The `tsconfig.json` declaring the plugin entry, which may be an extended config. */
  configPath: string;
}

const resolveExtends = (specifier: string, fromConfig: string) => {
  if (specifier.startsWith('.') || path.isAbsolute(specifier)) {
    const resolved = path.resolve(path.dirname(fromConfig), specifier);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile())
      return resolved;
    return fs.existsSync(`${resolved}.json`) ? `${resolved}.json` : null;
  }
  const require = createRequire(fromConfig);
  for (const candidate of [
    specifier,
    `${specifier}/tsconfig.json`,
    `${specifier}.json`,
  ]) {
    try {
      return require.resolve(candidate);
    } catch (_error) {}
  }
  return null;
};

/** Reads a `tsconfig.json`'s raw contents, e.g. with `ts.readConfigFile`. */
export type ReadConfigFile = (
  configPath: string
) => { config?: any } | undefined;

/** Finds the GraphQLSP plugin entry of a `tsconfig.json`, following `extends`.
 *
 * @remarks
 * TypeScript 7 drops plugin options from parsed compiler options, so the raw
 * configs are read (e.g. with the TypeScript 7.1 API's `readConfigFile`,
 * which handles tsconfig's JSONC dialect), and `extends` is followed like
 * `@gql.tada/internal` does. This also tells us which config declares the
 * plugin entry, which relative schema paths resolve against.
 */
export const readPluginConfig = (
  readConfigFile: ReadConfigFile,
  configPath: string,
  seen = new Set<string>()
): PluginConfigEntry | null => {
  if (seen.has(configPath)) return null;
  seen.add(configPath);

  let tsconfig: any;
  try {
    const result = readConfigFile(configPath);
    tsconfig = result && result.config;
  } catch (_error) {
    return null;
  }
  if (!tsconfig) return null;

  const plugins = tsconfig.compilerOptions && tsconfig.compilerOptions.plugins;
  const plugin =
    Array.isArray(plugins) &&
    plugins.find(plugin => plugin && PLUGIN_NAMES.has(plugin.name));
  if (plugin) return { config: plugin, configPath };

  const extendsList: unknown[] = Array.isArray(tsconfig.extends)
    ? // Later entries override earlier ones, so the last one wins
      [...tsconfig.extends].reverse()
    : tsconfig.extends
      ? [tsconfig.extends]
      : [];
  for (const specifier of extendsList) {
    if (typeof specifier !== 'string') continue;
    const resolved = resolveExtends(specifier, configPath);
    const found = resolved && readPluginConfig(readConfigFile, resolved, seen);
    if (found) return found;
  }
  return null;
};
