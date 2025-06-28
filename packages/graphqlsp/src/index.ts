import type { SchemaOrigin } from '@gql.tada/internal';

import { ts, init as initTypeScript } from './ts';
import { loadSchema } from './graphql/getSchema';
import { getGraphQLCompletions } from './autoComplete';
import { getGraphQLQuickInfo } from './quickInfo';
import { ALL_DIAGNOSTICS, getGraphQLDiagnostics } from './diagnostics';
import { templates } from './ast/templates';
import { getPersistedCodeFixAtPosition } from './persisted';

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

interface Config {
  schema: SchemaOrigin;
  schemas: SchemaOrigin[];
  tadaDisablePreprocessing?: boolean;
  templateIsCallExpression?: boolean;
  shouldCheckForColocatedFragments?: boolean;
  template?: string;
  clientDirectives?: string[];
  trackFieldUsage?: boolean;
  tadaOutputLocation?: string;
}

function create(info: ts.server.PluginCreateInfo) {
  const logger: Logger = (msg: string) =>
    info.project.projectService.logger.info(`[GraphQLSP] ${msg}`);
  const config: Config = info.config;

  logger('config: ' + JSON.stringify(config));
  if (!config.schema && !config.schemas) {
    logger('Missing "schema" option in configuration.');
    throw new Error('Please provide a GraphQL Schema!');
  }

  logger('Setting up the GraphQL Plugin');

  if (config.template) {
    templates.add(config.template);
  }

  const proxy = createBasicDecorator(info);

  const schema = loadSchema(info, config, logger);

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

  proxy.getEditsForRefactor = (
    filename,
    formatOptions,
    positionOrRange,
    refactorName,
    actionName,
    preferences,
    interactive
  ) => {
    const original = info.languageService.getEditsForRefactor(
      filename,
      formatOptions,
      positionOrRange,
      refactorName,
      actionName,
      preferences,
      interactive
    );

    const codefix = getPersistedCodeFixAtPosition(
      filename,
      typeof positionOrRange === 'number'
        ? positionOrRange
        : positionOrRange.pos,
      info
    );
    if (!codefix) return original;
    return {
      edits: [
        {
          fileName: filename,
          textChanges: [{ newText: codefix.replacement, span: codefix.span }],
        },
      ],
    };
  };

  proxy.getApplicableRefactors = (
    filename,
    positionOrRange,
    preferences,
    reason,
    kind,
    includeInteractive
  ) => {
    const original = info.languageService.getApplicableRefactors(
      filename,
      positionOrRange,
      preferences,
      reason,
      kind,
      includeInteractive
    );

    const codefix = getPersistedCodeFixAtPosition(
      filename,
      typeof positionOrRange === 'number'
        ? positionOrRange
        : positionOrRange.pos,
      info
    );

    if (codefix) {
      return [
        {
          name: 'GraphQL',
          description: 'Operations specific to gql.tada!',
          actions: [
            {
              name: 'Insert document-id',
              description:
                'Generate a document-id for your persisted-operation, by default a SHA256 hash.',
            },
          ],
          inlineable: true,
        },
        ...original,
      ];
    } else {
      return original;
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

  logger('proxy: ' + JSON.stringify(proxy));

  return proxy;
}

const init: ts.server.PluginModuleFactory = ts => {
  initTypeScript(ts);
  return { create };
};

export default init;
