import * as vscode from 'vscode';

import { getGraphQLDocumentSymbols } from './documentSymbols';

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
  const registerDocumentSymbols = () =>
    vscode.languages.registerDocumentSymbolProvider(
      [
        { language: 'javascript' },
        { language: 'javascriptreact' },
        { language: 'typescript' },
        { language: 'typescriptreact' },
      ],
      {
        provideDocumentSymbols(document, token) {
          if (token.isCancellationRequested) return [];
          const template = vscode.workspace
            .getConfiguration(configurationSection, document.uri)
            .get<string>('template');

          return getGraphQLDocumentSymbols(document.getText(), template).map(
            symbol =>
              new vscode.DocumentSymbol(
                symbol.name,
                'GraphQL',
                symbol.type === 'fragment'
                  ? vscode.SymbolKind.Struct
                  : vscode.SymbolKind.Function,
                new vscode.Range(
                  document.positionAt(symbol.range.start),
                  document.positionAt(symbol.range.end)
                ),
                new vscode.Range(
                  document.positionAt(symbol.selectionRange.start),
                  document.positionAt(symbol.selectionRange.end)
                )
              )
          );
        },
      }
    );

  let documentSymbolRegistration = registerDocumentSymbols();
  context.subscriptions.push({
    dispose: () => documentSymbolRegistration.dispose(),
  });

  const tsExtension =
    vscode.extensions.getExtension<TypeScriptLanguageFeaturesExports>(
      'vscode.typescript-language-features'
    );
  const api = tsExtension
    ? (await tsExtension.activate()).getAPI(0)
    : undefined;
  const synchronize = () =>
    api?.configurePlugin(pluginName, getPluginConfiguration());

  synchronize();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async event => {
      if (!event.affectsConfiguration(configurationSection)) return;
      documentSymbolRegistration.dispose();
      documentSymbolRegistration = registerDocumentSymbols();
      if (!api) return;

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
