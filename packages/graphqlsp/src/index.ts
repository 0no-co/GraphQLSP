import { ts, init as initTypeScript } from './ts';
import { SchemaOrigin, loadSchema } from './graphql/getSchema';
import { getGraphQLCompletions } from './autoComplete';
import { getGraphQLQuickInfo } from './quickInfo';
import { ALL_DIAGNOSTICS, getGraphQLDiagnostics } from './diagnostics';
import { templates } from './ast/templates';

function createBasicDecorator(info: ts.server.PluginCreateInfo) {
  const proxy: ts.LanguageService = Object.create(null);
  for (let k of Object.keys(info.languageService) as Array<
    keyof ts.LanguageService
  >) {
    const x = info.languageService[k]!;
    // @ts-expect-error - JS runtime trickery which is tricky to type tersely
    proxy[k] = (...args: Array<{}>) => x.apply(info.languageService, args);
  }

  return proxy;
}

export type Logger = (msg: string) => void;

type Config = {
  schema: SchemaOrigin | string;
  tadaDisablePreprocessing?: boolean;
  templateIsCallExpression?: boolean;
  shouldCheckForColocatedFragments?: boolean;
  template?: string;
  trackFieldUsage?: boolean;
  tadaOutputLocation?: string;
};

function create(info: ts.server.PluginCreateInfo) {
  const logger: Logger = (msg: string) =>
    info.project.projectService.logger.info(`[GraphQLSP] ${msg}`);
  const config: Config = info.config;

  logger('config: ' + JSON.stringify(config));
  if (!config.schema) {
    logger('Missing "schema" option in configuration.');
    throw new Error('Please provide a GraphQL Schema!');
  }

  logger('Setting up the GraphQL Plugin');

  if (config.template) {
    templates.add(config.template);
  }

  const proxy = createBasicDecorator(info);

  const schema = loadSchema(
    info,
    config.schema,
    // TODO: either we check here for the client having a package.json
    // with gql.tada and use a default file loc or we use a config
    // option with a location
    config.tadaOutputLocation,
    logger
  );

  proxy.getSemanticDiagnostics = (filename: string): ts.Diagnostic[] => {
    const originalDiagnostics =
      info.languageService.getSemanticDiagnostics(filename);

    const hasGraphQLDiagnostics = originalDiagnostics.some(x =>
      ALL_DIAGNOSTICS.includes(x.code)
    );
    if (hasGraphQLDiagnostics) return originalDiagnostics;

    const graphQLDiagnostics = getGraphQLDiagnostics(filename, schema, info);

    return graphQLDiagnostics
      ? [...graphQLDiagnostics, ...originalDiagnostics]
      : originalDiagnostics;
  };

  proxy.getCompletionsAtPosition = (
    filename: string,
    cursorPosition: number,
    options: any
  ): ts.WithMetadata<ts.CompletionInfo> | undefined => {
    const completions = getGraphQLCompletions(
      filename,
      cursorPosition,
      schema,
      info
    );

    if (completions && completions.entries.length) {
      return completions;
    } else {
      return (
        info.languageService.getCompletionsAtPosition(
          filename,
          cursorPosition,
          options
        ) || {
          isGlobalCompletion: false,
          isMemberCompletion: false,
          isNewIdentifierLocation: false,
          entries: [],
        }
      );
    }
  };

  proxy.getQuickInfoAtPosition = (filename: string, cursorPosition: number) => {
    const quickInfo = getGraphQLQuickInfo(
      filename,
      cursorPosition,
      schema,
      info
    );

    if (quickInfo) return quickInfo;

    return info.languageService.getQuickInfoAtPosition(
      filename,
      cursorPosition
    );
  };

  // TODO: check out the following hooks
  // - getSuggestionDiagnostics, can suggest refactors
  // - getCompletionEntryDetails, this can build on the auto-complete for more information
  // - getCodeFixesAtPosition

  logger('proxy: ' + JSON.stringify(proxy));

  return proxy;
}

const init: ts.server.PluginModuleFactory = ts => {
  initTypeScript(ts);
  return { create };
};

export default init;
