import * as vscode from 'vscode';

/** Must match the `typescriptServerPlugins` contribution in package.json. */
const pluginName = '@0no-co/graphqlsp';
const configurationSection = 'graphqlsp';

/** Settings forwarded verbatim to the tsserver plugin's configuration. */
const pluginSettings = [
  'schema',
  'schemas',
  'template',
  'templateIsCallExpression',
  'shouldCheckForColocatedFragments',
  'trackFieldUsage',
  'clientDirectives',
  'tadaOutputLocation',
  'tadaDisablePreprocessing',
] as const;

interface TypeScriptLanguageFeaturesApi {
  configurePlugin(pluginId: string, configuration: unknown): void;
}

interface TypeScriptLanguageFeaturesExports {
  getAPI(version: 0): TypeScriptLanguageFeaturesApi | undefined;
}

const getPluginConfiguration = (): Record<string, unknown> | undefined => {
  const settings = vscode.workspace.getConfiguration(configurationSection);
  let configuration: Record<string, unknown> | undefined;
  for (const key of pluginSettings) {
    const value = settings.get(key);
    if (value !== null && value !== undefined) {
      (configuration || (configuration = {}))[key] = value;
    }
  }
  return configuration;
};

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const tsExtension =
    vscode.extensions.getExtension<TypeScriptLanguageFeaturesExports>(
      'vscode.typescript-language-features'
    );
  if (!tsExtension) return;

  const api = (await tsExtension.activate()).getAPI(0);
  if (!api) return;

  const synchronize = () => {
    const configuration = getPluginConfiguration();
    // Without any editor settings the plugin is configured through the
    // project's tsconfig instead. Sending an empty configuration would
    // replace tsserver's `global: true` marker on the plugin's config
    // entry, which the plugin relies on to stay dormant in projects that
    // never set up GraphQLSP.
    if (configuration) api.configurePlugin(pluginName, configuration);
  };

  synchronize();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async event => {
      if (!event.affectsConfiguration(configurationSection)) return;
      synchronize();
      // The plugin reads its configuration once per project, so changes
      // only take effect after the TypeScript server restarts
      const selection = await vscode.window.showInformationMessage(
        'GraphQLSP settings changed. Restart the TypeScript server to apply them?',
        'Restart TS Server'
      );
      if (selection === 'Restart TS Server') {
        await vscode.commands.executeCommand('typescript.restartTsServer');
      }
    })
  );
}

export function deactivate(): void {}
