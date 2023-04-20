import ts from 'typescript/lib/tsserverlibrary';

import { loadSchema } from './graphql/getSchema';
import { getGraphQLCompletions } from './autoComplete';
import { getGraphQLQuickInfo } from './quickInfo';
import { getGraphQLDiagnostics } from './diagnostics';

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

function create(info: ts.server.PluginCreateInfo) {
  const logger: Logger = (msg: string) =>
    info.project.projectService.logger.info(`[GraphQLSP] ${msg}`);
  logger('config: ' + JSON.stringify(info.config));
  if (!info.config.schema) {
    throw new Error('Please provide a GraphQL Schema!');
  }

  logger('Setting up the GraphQL Plugin');

  const scalars = info.config.scalars || {};

  const proxy = createBasicDecorator(info);

  const baseTypesPath =
    info.project.getCurrentDirectory() + '/__generated__/baseGraphQLSP.ts';

  const schema = loadSchema(
    info.project.getProjectName(),
    info.config.schema,
    logger,
    baseTypesPath,
    scalars
  );

  proxy.getSemanticDiagnostics = (filename: string): ts.Diagnostic[] => {
    const originalDiagnostics =
      info.languageService.getSemanticDiagnostics(filename);
    const graphQLDiagnostics = getGraphQLDiagnostics(
      filename,
      baseTypesPath,
      schema,
      info
    );
    return graphQLDiagnostics
      ? [...graphQLDiagnostics, ...originalDiagnostics]
      : originalDiagnostics;
  };

  proxy.getCompletionsAtPosition = (
    filename: string,
    cursorPosition: number,
    options: any
  ): ts.WithMetadata<ts.CompletionInfo> | undefined => {
    const originalCompletions = info.languageService.getCompletionsAtPosition(
      filename,
      cursorPosition,
      options
    ) || {
      isGlobalCompletion: false,
      isMemberCompletion: false,
      isNewIdentifierLocation: false,
      entries: [],
    };

    const completions = getGraphQLCompletions(
      filename,
      cursorPosition,
      schema,
      info
    );

    if (completions) {
      return {
        ...completions,
        entries: [...completions.entries, ...originalCompletions.entries],
      };
    } else {
      return originalCompletions;
    }
  };

  proxy.getQuickInfoAtPosition = (filename: string, cursorPosition: number) => {
    const originalInfo = info.languageService.getQuickInfoAtPosition(
      filename,
      cursorPosition
    );

    const quickInfo = getGraphQLQuickInfo(
      filename,
      cursorPosition,
      schema,
      info
    );

    return quickInfo || originalInfo;
  };

  logger('proxy: ' + JSON.stringify(proxy));

  return proxy;
}

const init: ts.server.PluginModuleFactory = () => {
  return { create };
};

export default init;
