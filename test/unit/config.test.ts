import { describe, expect, it } from 'vitest';
import ts from 'typescript/lib/tsserverlibrary';

import { resolveConfig } from '../../packages/graphqlsp/src/config';
import { init } from '../../packages/graphqlsp/src/ts';

init({ typescript: ts });

const instanceMarker = Symbol.for('@0no-co/graphqlsp');

const createInfo = ({
  config,
  plugins = [],
  manifests = [],
  marked = false,
}: {
  config: Record<string, unknown>;
  plugins?: Array<Record<string, unknown> & { name: string }>;
  manifests?: string[];
  marked?: boolean;
}) => {
  const languageService = {} as ts.LanguageService;
  if (marked) (languageService as any)[instanceMarker] = true;

  const manifestSet = new Set(manifests);
  return {
    languageService,
    config,
    project: {
      getCompilerOptions: () => ({ plugins }),
      getCurrentDirectory: () => '/workspace/packages/app',
      fileExists: (fileName: string) => manifestSet.has(fileName),
    },
  } as unknown as ts.server.PluginCreateInfo;
};

const resolve = (info: ts.server.PluginCreateInfo) => {
  const logs: string[] = [];
  const config = resolveConfig(
    info,
    message => logs.push(message),
    instanceMarker
  );
  return { config, logs };
};

describe('editor-contributed plugin configuration', () => {
  it('leaves project-local plugin instances active', () => {
    const localConfig = { schema: './schema.graphql' };
    const { config } = resolve(createInfo({ config: localConfig }));

    expect(config).toBe(localConfig);
  });

  it('defers when a marked GraphQLSP instance is already active', () => {
    const { config, logs } = resolve(
      createInfo({ config: { global: true }, marked: true })
    );

    expect(config).toBeNull();
    expect(logs).toEqual([
      'The project already has a GraphQLSP instance; deferring to it',
    ]);
  });

  it.each([
    [
      '@0no-co/graphqlsp',
      '/workspace/node_modules/@0no-co/graphqlsp/package.json',
    ],
    ['gql.tada/ts-plugin', '/workspace/node_modules/gql.tada/package.json'],
  ])('defers to an installed older local %s plugin', (name, manifest) => {
    const localEntry = { name, schema: './local.graphql' };
    const { config, logs } = resolve(
      createInfo({
        config: { editorContributed: true, schema: './editor.graphql' },
        plugins: [localEntry],
        manifests: [manifest],
      })
    );

    expect(config).toBeNull();
    expect(logs).toEqual([
      `The project has a local "${name}" installation; deferring to it`,
    ]);
  });

  it('adopts tsconfig settings when the local plugin package is unavailable', () => {
    const localEntry = {
      name: '@0no-co/graphqlsp',
      schema: './local.graphql',
    };
    const { config, logs } = resolve(
      createInfo({
        config: { global: true },
        plugins: [localEntry],
      })
    );

    expect(config).toBe(localEntry);
    expect(logs).toEqual([
      'Adopting the project\'s "@0no-co/graphqlsp" tsconfig configuration because its local package is unavailable',
    ]);
  });

  it('uses editor settings when no project-local plugin is configured', () => {
    const editorConfig = {
      editorContributed: true,
      schema: './editor.graphql',
    };
    const { config } = resolve(createInfo({ config: editorConfig }));

    expect(config).toBe(editorConfig);
  });

  it('stays dormant when neither project nor editor provides a schema', () => {
    const { config, logs } = resolve(createInfo({ config: { global: true } }));

    expect(config).toBeNull();
    expect(logs).toEqual([
      'Loaded as a global plugin without configuration; skipping setup',
    ]);
  });
});
