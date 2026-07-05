import type { SchemaOrigin } from '@gql.tada/internal';

import { ts, init as initTypeScript } from './ts';
import { loadSchema } from './graphql/getSchema';
import { getGraphQLCompletions } from './autoComplete';
import { getGraphQLQuickInfo } from './quickInfo';
import {
  getGraphQLDefinitionAndBoundSpan,
  getGraphQLDefinitionAtPosition,
} from './definition';
import { ALL_DIAGNOSTICS, getGraphQLDiagnostics } from './diagnostics';
import {
  getGraphQLFragmentReferences,
  getGraphQLFragmentReferenceEntries,
  getGraphQLFragmentRenameInfo,
  getGraphQLFragmentRenameLocations,
} from './references';
import {
  getGraphQLCodeFixesAtPosition,
  registerGraphQLCodeFixes,
} from './codeFixes';
import { templates } from './ast/templates';
import { getPersistedCodeFixAtPosition } from './persisted';
import { canExtractFragment, getExtractFragmentEdits } from './extractFragment';

/** Marks the language service proxies of active GraphQLSP instances.
 *
 * `Symbol.for` uses the shared symbol registry, so the marker survives
 * multiple module copies of the plugin being loaded side by side — e.g. a
 * project's own `gql.tada/ts-plugin` and a copy bundled with an editor
 * extension. */
const instanceMarker = Symbol.for('@0no-co/graphqlsp');

function createBasicDecorator(info: ts.server.PluginCreateInfo) {
  const proxy: ts.LanguageService = Object.create(null);
  for (let k of Object.keys(info.languageService) as Array<
    keyof ts.LanguageService
  >) {
    const x = info.languageService[k]!;
    // @ts-expect-error - JS runtime trickery which is tricky to type tersely
    proxy[k] = (...args: Array<{}>) => x.apply(info.languageService, args);
  }

  // Keep the active-instance marker of a wrapped GraphQLSP proxy visible to
  // any plugin instance loaded on top of this one
  if ((info.languageService as any)[instanceMarker]) {
    (proxy as any)[instanceMarker] = true;
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

/** Resolves the configuration this instance should run with, or `null` to
 * stay dormant.
 *
 * A project-local instance (configured through a tsconfig "plugins" entry)
 * always runs with its entry as-is. For an editor-contributed ("global")
 * instance the project's configuration wins over editor settings:
 * - a live local instance already handles the project → stay dormant,
 * - a tsconfig entry that produced no instance (e.g. the package isn't
 *   installed in the project) → adopt the entry's configuration,
 * - editor settings passed through `configurePlugin` → use them,
 * - no configuration anywhere → stay dormant, so unrelated projects don't
 *   get "missing schema" configuration errors. */
function resolveConfig(
  info: ts.server.PluginCreateInfo,
  logger: Logger
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
    logger(
      `Adopting the project's "${localEntry.name}" tsconfig configuration`
    );
    return localEntry as Config;
  }

  if (config.schema !== undefined || config.schemas !== undefined) {
    return config;
  }

  logger('Loaded as a global plugin without configuration; skipping setup');
  return null;
}

function create(info: ts.server.PluginCreateInfo) {
  const logger: Logger = (msg: string) =>
    info.project.projectService.logger.info(`[GraphQLSP] ${msg}`);

  const config = resolveConfig(info, logger);
  if (!config) return createBasicDecorator(info);

  // Everything downstream (diagnostics, completions, schema loading) reads
  // `info.config` directly, so an adopted configuration has to land there
  info.config = config;

  logger('config: ' + JSON.stringify(config));

  logger('Setting up the GraphQL Plugin');

  if (config.template) {
    templates.add(config.template);
  }

  const proxy = createBasicDecorator(info);
  // Marks this project as handled, keeping an editor-contributed instance
  // loaded on top of this one dormant
  (proxy as any)[instanceMarker] = true;

  const schema = loadSchema(info, logger);

  // An exception thrown by any of the plugin's own logic fails the whole
  // tsserver request, which presents as a dead plugin (or worse, a dead
  // editor feature) for the file; each proxied method logs and falls back
  // to the underlying language service instead
  const guard = <T>(operation: string, fallback: T, run: () => T): T => {
    try {
      return run();
    } catch (error) {
      logger(`Unexpected error in ${operation}: ${error}`);
      return fallback;
    }
  };

  proxy.getSemanticDiagnostics = (filename: string): ts.Diagnostic[] => {
    const originalDiagnostics =
      info.languageService.getSemanticDiagnostics(filename);

    return guard('getSemanticDiagnostics', originalDiagnostics, () => {
      // Diagnostics requests are a steady editor-driven heartbeat, which
      // makes them a good time to detect missed schema watcher events
      schema.checkStale();

      const hasGraphQLDiagnostics = originalDiagnostics.some(x =>
        ALL_DIAGNOSTICS.includes(x.code)
      );
      if (hasGraphQLDiagnostics) return originalDiagnostics;

      const graphQLDiagnostics = getGraphQLDiagnostics(filename, schema, info);

      return graphQLDiagnostics
        ? [...graphQLDiagnostics, ...originalDiagnostics]
        : originalDiagnostics;
    });
  };

  proxy.getCodeFixesAtPosition = (
    filename: string,
    start: number,
    end: number,
    errorCodes: readonly number[],
    formatOptions: ts.FormatCodeSettings,
    preferences: ts.UserPreferences
  ): readonly ts.CodeFixAction[] => {
    const originalFixes = info.languageService.getCodeFixesAtPosition(
      filename,
      start,
      end,
      errorCodes,
      formatOptions,
      preferences
    );

    return guard('getCodeFixesAtPosition', originalFixes, () => {
      const graphQLFixes = getGraphQLCodeFixesAtPosition(
        filename,
        start,
        end,
        errorCodes,
        schema,
        info
      );

      return graphQLFixes.length
        ? [...graphQLFixes, ...originalFixes]
        : originalFixes;
    });
  };

  proxy.getCompletionsAtPosition = (
    filename: string,
    cursorPosition: number,
    options: any
  ): ts.WithMetadata<ts.CompletionInfo> | undefined => {
    const completions = guard('getCompletionsAtPosition', undefined, () =>
      getGraphQLCompletions(filename, cursorPosition, schema, info)
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
    if (refactorName === 'GraphQL') {
      if (actionName === 'Insert document-id') {
        const codefix = guard('getEditsForRefactor', undefined, () =>
          getPersistedCodeFixAtPosition(
            filename,
            typeof positionOrRange === 'number'
              ? positionOrRange
              : positionOrRange.pos,
            info
          )
        );
        if (codefix) {
          return {
            edits: [
              {
                fileName: filename,
                textChanges: [
                  { newText: codefix.replacement, span: codefix.span },
                ],
              },
            ],
          };
        }
      } else if (actionName === 'Extract to fragment') {
        const refactor = guard('getEditsForRefactor', undefined, () =>
          getExtractFragmentEdits(filename, positionOrRange, schema, info)
        );
        if (refactor) return refactor;
      }
    }

    return info.languageService.getEditsForRefactor(
      filename,
      formatOptions,
      positionOrRange,
      refactorName,
      actionName,
      preferences,
      interactive
    );
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

    const actions: ts.RefactorActionInfo[] = [];

    const codefix = guard('getApplicableRefactors', undefined, () =>
      getPersistedCodeFixAtPosition(
        filename,
        typeof positionOrRange === 'number'
          ? positionOrRange
          : positionOrRange.pos,
        info
      )
    );
    if (codefix) {
      actions.push({
        name: 'Insert document-id',
        description:
          'Generate a document-id for your persisted-operation, by default a SHA256 hash.',
      });
    }

    const extractFragment = guard('getApplicableRefactors', false, () =>
      canExtractFragment(filename, positionOrRange, schema, info)
    );
    if (extractFragment) {
      actions.push({
        name: 'Extract to fragment',
        description:
          'Extract the selected fields into a new co-located fragment.',
      });
    }

    if (actions.length) {
      return [
        {
          name: 'GraphQL',
          description: 'Operations specific to gql.tada!',
          actions,
          inlineable: true,
        },
        ...original,
      ];
    } else {
      return original;
    }
  };

  proxy.getDefinitionAtPosition = (
    filename: string,
    cursorPosition: number
  ) => {
    const originalDefinitions = info.languageService.getDefinitionAtPosition(
      filename,
      cursorPosition
    );

    const definitions = guard('getDefinitionAtPosition', undefined, () =>
      getGraphQLDefinitionAtPosition(
        filename,
        cursorPosition,
        schema,
        info,
        originalDefinitions
      )
    );

    return definitions || originalDefinitions;
  };

  proxy.getDefinitionAndBoundSpan = (
    filename: string,
    cursorPosition: number
  ) => {
    const original = info.languageService.getDefinitionAndBoundSpan(
      filename,
      cursorPosition
    );

    const definition = guard('getDefinitionAndBoundSpan', undefined, () =>
      getGraphQLDefinitionAndBoundSpan(
        filename,
        cursorPosition,
        schema,
        info,
        original
      )
    );

    return definition || original;
  };

  proxy.findReferences = (filename: string, cursorPosition: number) => {
    const references = guard('findReferences', undefined, () =>
      getGraphQLFragmentReferences(filename, cursorPosition, info)
    );

    return (
      references ||
      info.languageService.findReferences(filename, cursorPosition)
    );
  };

  proxy.getReferencesAtPosition = (
    filename: string,
    cursorPosition: number
  ) => {
    const references = guard('getReferencesAtPosition', undefined, () =>
      getGraphQLFragmentReferenceEntries(filename, cursorPosition, info)
    );

    return (
      references ||
      info.languageService.getReferencesAtPosition(filename, cursorPosition)
    );
  };

  proxy.getRenameInfo = (
    ...args: Parameters<ts.LanguageService['getRenameInfo']>
  ) => {
    const [filename, cursorPosition] = args;
    const renameInfo = guard('getRenameInfo', undefined, () =>
      getGraphQLFragmentRenameInfo(filename, cursorPosition, info)
    );

    if (renameInfo) return renameInfo;

    return info.languageService.getRenameInfo(...args);
  };

  proxy.findRenameLocations = (
    filename: string,
    cursorPosition: number,
    findInStrings: boolean,
    findInComments: boolean,
    preferences?: ts.UserPreferences | boolean
  ) => {
    const locations = guard('findRenameLocations', undefined, () =>
      getGraphQLFragmentRenameLocations(filename, cursorPosition, info)
    );

    if (locations) return locations;

    return info.languageService.findRenameLocations(
      filename,
      cursorPosition,
      findInStrings,
      findInComments,
      // Both overloads of `findRenameLocations` are forwarded through the
      // same call site, which the overloaded signatures can't express
      preferences as ts.UserPreferences
    );
  };

  proxy.getQuickInfoAtPosition = (
    ...args: Parameters<ts.LanguageService['getQuickInfoAtPosition']>
  ) => {
    const [filename, cursorPosition] = args;
    const quickInfo = guard('getQuickInfoAtPosition', undefined, () =>
      getGraphQLQuickInfo(filename, cursorPosition, schema, info)
    );

    if (quickInfo) return quickInfo;

    // Forward all arguments (including `verbosityLevel` for expandable
    // hovers, added in TS 5.9) so we don't break the underlying feature.
    return info.languageService.getQuickInfoAtPosition(...args);
  };

  logger('proxy: ' + JSON.stringify(proxy));

  return proxy;
}

const init: ts.server.PluginModuleFactory = ts => {
  initTypeScript(ts);
  registerGraphQLCodeFixes();
  return { create };
};

export default init;
