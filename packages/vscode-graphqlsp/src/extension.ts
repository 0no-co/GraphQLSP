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

const getPluginConfiguration = (): Record<string, unknown> => {
  const settings = vscode.workspace.getConfiguration(configurationSection);
  // The marker tells the plugin this configuration comes from an editor
  // extension, so it can give a project's own tsconfig "plugins" entry
  // precedence over these settings
  const configuration: Record<string, unknown> = { editorContributed: true };
  for (const key of pluginSettings) {
    const value = settings.get(key);
    if (value !== null && value !== undefined) {
      configuration[key] = value;
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
    api.configurePlugin(pluginName, getPluginConfiguration());
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
