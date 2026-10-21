import { createRequire } from 'node:module';
import path from 'node:path';

import { ts } from './ts';
import type { Logger } from './index';

/** The content mapper TypeScript 7.1+ uses to type `.graphql` files.
 *
 * @remarks
 * GraphQLSP reuses the `contentMappers` entry for this package in the
 * project's `tsconfig.json`, and loads the package from the project, so that
 * `.graphql` files look identical to TypeScript 5/6 editors and TypeScript 7.1
 * `tsc --runExternalCode`. TypeScript 5/6 ignores the `contentMappers` key. */
export const CONTENT_MAPPER_PACKAGE = '@gql.tada/content-mapper';

export const GRAPHQL_FILE_CODE = 52010;

// From the content mapper protocol
const enum SpanMapKind {
  Verbatim = 0,
  Atom = 1,
  Alias = 2,
}

// The content mapper's own "unknown fragment" diagnostic duplicates the
// schema validation GraphQLSP runs on every document
const UNKNOWN_FRAGMENT_MAPPER_CODE = 2;

type SpanMapping = [
  virtualStart: number,
  virtualLength: number,
  originalStart: number,
  originalLength: number,
  kind: SpanMapKind,
  features?: number,
];

interface MapperDiagnostic {
  messageText: string;
  start: number;
  length: number;
  code: number;
}

interface TransformResult {
  text: string;
  mappings?: SpanMapping[];
  diagnostics?: MapperDiagnostic[];
}

interface ContentMapperModule {
  transform(
    content: string,
    options: { fileName: string; graphqlModule: string; graphqlExport?: string }
  ): TransformResult;
  resolveGraphQLModule(
    configFileName: string,
    fileName: string,
    graphqlModule: string
  ): string;
}

interface ContentMapperEntry {
  package: string;
  extensions: string[];
  options?: { module?: unknown; export?: unknown };
}

interface MappedFile {
  version: string;
  /** Line starts of the original `.graphql` text */
  lineStarts: number[];
  result: TransformResult;
  /** Mappings sorted by virtual start */
  mappings: SpanMapping[];
}

export interface GraphQLFiles {
  isGraphQLFile(fileName: string): boolean;
  /** Lists the project's `.graphql` files matched by its tsconfig */
  getExternalFiles(updateLevel: number): string[];
  /** Translates positions and spans of `.graphql` files for the plugin's
   * outermost language service proxy */
  decorate(languageService: ts.LanguageService): void;
}

/** Projects whose host this module instance decorated */
const projects = new WeakMap<ts.server.Project, GraphQLFiles>();

/** Answers `getExternalFiles` of the plugin module for a project. */
export const getExternalFiles = (
  project: ts.server.Project,
  updateLevel: number
): string[] => {
  const files = projects.get(project);
  return files ? files.getExternalFiles(updateLevel) : [];
};

/** Resolves an `extends` specifier like TypeScript does, including packages */
const resolveExtendedConfig = (
  configFileName: string,
  specifier: string
): string | undefined => {
  const sourceFile = ts.parseJsonText(
    configFileName,
    JSON.stringify({ extends: specifier, files: [] })
  ) as ts.TsConfigSourceFile;
  ts.parseJsonSourceFileConfigFileContent(
    sourceFile,
    ts.sys,
    path.dirname(configFileName),
    undefined,
    configFileName
  );
  // Extended configs are listed depth-first, so the first is the specifier's
  return sourceFile.extendedSourceFiles && sourceFile.extendedSourceFiles[0];
};

/** Finds the `contentMappers` that apply to a tsconfig.
 *
 * @remarks
 * Like other options, the nearest `contentMappers` wins, and of several
 * extended configs the last one wins. Like TypeScript 7.1, options of an
 * inherited entry aren't rebased, so relative modules stay relative to the
 * project's tsconfig. */
const readContentMappers = (
  configFileName: string,
  seen = new Set<string>()
): unknown => {
  if (seen.has(configFileName)) return undefined;
  seen.add(configFileName);
  const { config, error } = ts.readConfigFile(configFileName, ts.sys.readFile);
  if (error || !config) return undefined;
  if (config.contentMappers !== undefined) return config.contentMappers;
  const specifiers: unknown[] = [].concat(config.extends || []);
  for (let index = specifiers.length - 1; index >= 0; index--) {
    const specifier = specifiers[index];
    const extended =
      typeof specifier === 'string' &&
      resolveExtendedConfig(configFileName, specifier);
    const contentMappers = extended && readContentMappers(extended, seen);
    if (contentMappers !== undefined) return contentMappers;
  }
  return undefined;
};

const readContentMapperEntry = (
  configFileName: string,
  logger: Logger
): ContentMapperEntry | null => {
  const contentMappers = readContentMappers(configFileName);
  if (!Array.isArray(contentMappers)) return null;
  const entry = contentMappers.find(
    (entry: unknown): entry is ContentMapperEntry =>
      !!entry &&
      typeof entry === 'object' &&
      (entry as ContentMapperEntry).package === CONTENT_MAPPER_PACKAGE &&
      Array.isArray((entry as ContentMapperEntry).extensions)
  );
  if (!entry) return null;
  if (!entry.options || typeof entry.options.module !== 'string') {
    logger(
      `The "${CONTENT_MAPPER_PACKAGE}" content mapper has no "module" option; skipping GraphQL files`
    );
    return null;
  }
  return entry;
};

const loadContentMapper = (
  configFileName: string,
  logger: Logger
): ContentMapperModule | null => {
  try {
    return createRequire(configFileName)(CONTENT_MAPPER_PACKAGE);
  } catch (error) {
    logger(
      `The "${CONTENT_MAPPER_PACKAGE}" package couldn't be loaded from the project: ${error}`
    );
    return null;
  }
};

const isVerbatim = (mapping: SpanMapping) =>
  mapping[4] === SpanMapKind.Verbatim;

/** Maps an original position to its virtual positions, verbatim ones first.
 *
 * @remarks
 * A fragment spread maps both into its document and onto the identifier the
 * fragment is passed as, so features that find nothing in the document (e.g.
 * TypeScript's go-to-definition) are retried on the identifier. */
const toVirtualPositions = (file: MappedFile, position: number): number[] => {
  const verbatim: number[] = [];
  const aliases: number[] = [];
  for (const [vStart, vLength, oStart, oLength, kind] of file.mappings) {
    if (position < oStart || position > oStart + oLength) continue;
    const offset = position - oStart;
    if (kind === SpanMapKind.Verbatim) {
      verbatim.push(vStart + offset);
    } else {
      aliases.push(vStart + Math.min(offset, vLength));
    }
  }
  return [...verbatim, ...aliases];
};

interface OriginalSpan {
  start: number;
  length: number;
  /** Whether the span was copied verbatim, or covers a whole aliased name */
  exact: boolean;
}

/** Maps a virtual span to the original text */
const toOriginalSpan = (
  file: MappedFile,
  start: number,
  length: number
): OriginalSpan | undefined => {
  const end = start + length;
  for (const mapping of file.mappings) {
    const [vStart, vLength, oStart, oLength] = mapping;
    if (start < vStart || end > vStart + vLength) continue;
    if (isVerbatim(mapping)) {
      return { start: oStart + start - vStart, length, exact: true };
    } else {
      // Aliased names map as a whole, since their virtual text differs
      const exact =
        start === vStart && length === vLength && vLength === oLength;
      return { start: oStart, length: oLength, exact };
    }
  }
  return undefined;
};

export const setupGraphQLFiles = (
  info: ts.server.PluginCreateInfo,
  logger: Logger
): GraphQLFiles | null => {
  const project = info.project;
  if (!(project instanceof ts.server.ConfiguredProject)) return null;
  if (projects.has(project)) return projects.get(project)!;

  const configFileName = project.getConfigFilePath();
  const entry = readContentMapperEntry(configFileName, logger);
  if (!entry) return null;
  const mapper = loadContentMapper(configFileName, logger);
  if (!mapper) return null;

  const extensions = entry.extensions.filter(
    extension => typeof extension === 'string' && extension.startsWith('.')
  );
  const graphqlModule = entry.options!.module as string;
  const graphqlExport =
    typeof entry.options!.export === 'string'
      ? entry.options!.export
      : undefined;

  logger(
    `Mapping ${extensions.join(', ')} files with "${CONTENT_MAPPER_PACKAGE}"`
  );

  const isGraphQLFile = (fileName: string) =>
    extensions.some(extension => fileName.endsWith(extension));

  let externalFiles: string[] | undefined;
  const getExternalFiles = (updateLevel: number): string[] => {
    // Only rescan when tsserver reloads the project's root names, which its
    // directory watchers also do for added `.graphql` files, since they accept
    // the files `getScriptKind` supports (TypeScript 5.3+)
    if (externalFiles && updateLevel === 0) return externalFiles;
    const { config } = ts.readConfigFile(configFileName, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(
      config || {},
      ts.sys,
      path.dirname(configFileName),
      undefined,
      configFileName,
      undefined,
      extensions.map(extension => ({
        extension,
        isMixedContent: false,
        scriptKind: ts.ScriptKind.Deferred,
      }))
    );
    return (externalFiles = parsed.fileNames.filter(isGraphQLFile));
  };

  const host = info.languageServiceHost;
  const getScriptSnapshot = host.getScriptSnapshot.bind(host);
  const getScriptKind = host.getScriptKind && host.getScriptKind.bind(host);
  const resolveModuleNameLiterals =
    host.resolveModuleNameLiterals && host.resolveModuleNameLiterals.bind(host);

  const cache = new Map<string, MappedFile>();
  const getMappedFile = (fileName: string): MappedFile | undefined => {
    if (!isGraphQLFile(fileName)) return undefined;
    const version = host.getScriptVersion(fileName);
    const cached = cache.get(fileName);
    if (cached && cached.version === version) return cached;
    const snapshot = getScriptSnapshot(fileName);
    if (!snapshot) return undefined;
    const content = snapshot.getText(0, snapshot.getLength());
    let result: TransformResult;
    try {
      result = mapper.transform(content, {
        fileName,
        graphqlModule: mapper.resolveGraphQLModule(
          configFileName,
          fileName,
          graphqlModule
        ),
        graphqlExport,
      });
    } catch (error) {
      logger(`Failed to transform ${fileName}: ${error}`);
      result = { text: 'export {};\n' };
    }
    const mappings = [...(result.mappings || [])].sort((a, b) => a[0] - b[0]);
    const lineStarts = [0];
    for (let index = 0; index < content.length; index++) {
      const char = content[index];
      if (char === '\r' && content[index + 1] === '\n') index++;
      if (char === '\n' || char === '\r') lineStarts.push(index + 1);
    }
    const file: MappedFile = { version, lineStarts, result, mappings };
    cache.set(fileName, file);
    return file;
  };

  host.getScriptSnapshot = fileName => {
    const file = getMappedFile(fileName);
    return file
      ? ts.ScriptSnapshot.fromString(file.result.text)
      : getScriptSnapshot(fileName);
  };

  host.getScriptKind = fileName => {
    if (isGraphQLFile(fileName)) return ts.ScriptKind.TS;
    return getScriptKind ? getScriptKind(fileName) : ts.ScriptKind.Unknown;
  };

  if (resolveModuleNameLiterals) {
    host.resolveModuleNameLiterals = (literals, containingFile, ...rest) => {
      const resolutions = resolveModuleNameLiterals(
        literals,
        containingFile,
        ...rest
      );
      return resolutions.map((resolution, index) => {
        const literal = literals[index]!.text;
        if (resolution.resolvedModule || !isGraphQLFile(literal)) {
          return resolution;
        }
        // TypeScript looks up `<name>.graphql.ts` and similar for the import,
        // which also covers `paths` aliases; the file itself is what we map
        const candidates = new Set<string>();
        if (literal.startsWith('.')) {
          candidates.add(path.resolve(path.dirname(containingFile), literal));
        }
        for (const location of (resolution as any).failedLookupLocations ||
          []) {
          const match = /^(.*?)(?:\.d)?\.[cm]?[jt]sx?$/.exec(location);
          if (match && isGraphQLFile(match[1]!)) candidates.add(match[1]!);
        }
        for (const resolvedFileName of candidates) {
          if (host.fileExists(resolvedFileName)) {
            return {
              resolvedModule: {
                resolvedFileName,
                extension: ts.Extension.Ts,
                isExternalLibraryImport: false,
                resolvedUsingTsExtension: false,
              },
            };
          }
        }
        return resolution;
      });
    };
  }

  const files: GraphQLFiles = {
    isGraphQLFile,
    getExternalFiles,
    decorate: languageService =>
      decorateLanguageService(languageService, getMappedFile, logger),
  };
  projects.set(project, files);
  return files;
};

/** Converts mapper diagnostics into TypeScript diagnostics on the original text */
const getMapperDiagnostics = (
  file: MappedFile,
  sourceFile: ts.SourceFile
): ts.DiagnosticWithLocation[] =>
  (file.result.diagnostics || [])
    .filter(diagnostic => diagnostic.code !== UNKNOWN_FRAGMENT_MAPPER_CODE)
    .map(diagnostic => ({
      category: ts.DiagnosticCategory.Error,
      code: GRAPHQL_FILE_CODE,
      file: sourceFile,
      start: diagnostic.start,
      length: diagnostic.length,
      messageText: diagnostic.messageText,
      source: 'GraphQL',
    }));

type GetMappedFile = (fileName: string) => MappedFile | undefined;

/** Decorates the plugin's language service to translate positions and spans
 * between `.graphql` files and their virtual TypeScript modules.
 *
 * @remarks
 * This has to wrap GraphQLSP's own proxy, so the GraphQL features receive
 * virtual positions, and their results are mapped back, too. */
const decorateLanguageService = (
  languageService: ts.LanguageService,
  getMappedFile: GetMappedFile,
  logger: Logger
) => {
  const base: ts.LanguageService = Object.create(null);
  for (const key of Object.keys(languageService) as Array<
    keyof ts.LanguageService
  >) {
    const method = languageService[key];
    if (typeof method === 'function')
      (base as any)[key] = (method as Function).bind(languageService);
  }

  /** Returns the mapped file for spans in virtual coordinates. Files without
   * mappings (e.g. a schema's SDL) are left alone, since GraphQLSP reports
   * locations in them on the original text. */
  const getVirtualFile = (fileName: string) => {
    const file = getMappedFile(fileName);
    return file && file.mappings.length ? file : undefined;
  };

  /** Maps a span-carrying result into the original text of `.graphql` files.
   * Returns `undefined` when a span inside a `.graphql` file isn't mapped. */
  const mapSpan = <T extends { fileName: string; textSpan: ts.TextSpan }>(
    item: T,
    requireExact = false
  ): T | undefined => {
    const file = getVirtualFile(item.fileName);
    if (!file) return item;
    const span = toOriginalSpan(
      file,
      item.textSpan.start,
      item.textSpan.length
    );
    if (!span || (requireExact && !span.exact)) return undefined;
    const mapped: T = {
      ...item,
      textSpan: { start: span.start, length: span.length },
    };
    const contextSpan = (item as { contextSpan?: ts.TextSpan }).contextSpan;
    if (contextSpan) {
      const context = toOriginalSpan(
        file,
        contextSpan.start,
        contextSpan.length
      );
      (mapped as { contextSpan?: ts.TextSpan }).contextSpan = context
        ? { start: context.start, length: context.length }
        : undefined;
    }
    return mapped;
  };

  const mapSpans = <T extends { fileName: string; textSpan: ts.TextSpan }>(
    items: readonly T[] | undefined
  ): T[] | undefined =>
    items &&
    items.map(item => mapSpan(item)).filter((item): item is T => !!item);

  const isEmpty = (result: unknown) =>
    !result || (Array.isArray(result) && !result.length);

  /** Runs a position-based request, translating a `.graphql` position to each
   * of its virtual positions until one of them has a result */
  const atPosition = <T>(
    fileName: string,
    position: number,
    run: (position: number) => T
  ): T | undefined => {
    const file = getMappedFile(fileName);
    if (!file) return run(position);
    let result: T | undefined;
    for (const virtual of toVirtualPositions(file, position)) {
      result = run(virtual);
      if (!isEmpty(result)) break;
    }
    return result;
  };

  /** Runs a position-based request for every virtual position of a
   * `.graphql` position and merges the results. Used for requests like
   * references, where GraphQLSP finds fragment spreads in documents and
   * TypeScript finds the identifiers fragments are imported and passed as. */
  const atAllPositions = <T>(
    fileName: string,
    position: number,
    run: (position: number) => readonly T[] | undefined
  ): T[] | undefined => {
    const file = getMappedFile(fileName);
    if (!file) return run(position) as T[] | undefined;
    let results: T[] | undefined;
    for (const virtual of toVirtualPositions(file, position)) {
      const result = run(virtual);
      if (result) results = [...(results || []), ...result];
    }
    return results;
  };

  const spanKey = (item: { fileName: string; textSpan: ts.TextSpan }) =>
    `${item.fileName}:${item.textSpan.start}:${item.textSpan.length}`;

  /** Removes duplicates after spans were mapped onto the original text */
  const dedupe = <T extends { fileName: string; textSpan: ts.TextSpan }>(
    items: T[],
    seen = new Set<string>()
  ): T[] =>
    items.filter(item => {
      const key = spanKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const mapDiagnostics = <T extends ts.Diagnostic>(
    fileName: string,
    diagnostics: readonly T[]
  ): T[] => {
    const file = getMappedFile(fileName);
    if (!file) return diagnostics as T[];
    return diagnostics.map(diagnostic => {
      const span =
        diagnostic.start !== undefined &&
        toOriginalSpan(file, diagnostic.start, diagnostic.length || 0);
      // Diagnostics in generated code (e.g. an unresolvable `graphql()`
      // module) are reported at the start of the file instead of being lost
      return {
        ...diagnostic,
        start: span ? span.start : 0,
        length: span ? span.length : 0,
      };
    });
  };

  const guard = <T>(operation: string, fallback: T, run: () => T): T => {
    try {
      return run();
    } catch (error) {
      logger(`Unexpected error in ${operation} for GraphQL files: ${error}`);
      return fallback;
    }
  };

  const ls = languageService;

  // tsserver converts result spans to lines and columns with this, which
  // would otherwise read the virtual module's text
  ls.toLineColumnOffset = (fileName, position) => {
    const file = getMappedFile(fileName);
    if (!file) return base.toLineColumnOffset!(fileName, position);
    let line = file.lineStarts.length - 1;
    while (line > 0 && file.lineStarts[line]! > position) line--;
    return { line, character: position - file.lineStarts[line]! };
  };

  ls.getSyntacticDiagnostics = fileName => {
    const diagnostics = base.getSyntacticDiagnostics(fileName);
    const file = getMappedFile(fileName);
    const sourceFile = file && base.getProgram()?.getSourceFile(fileName);
    if (!file || !sourceFile) return diagnostics;
    return guard('getSyntacticDiagnostics', [], () => [
      ...getMapperDiagnostics(file, sourceFile),
      ...mapDiagnostics(fileName, diagnostics),
    ]);
  };

  ls.getSemanticDiagnostics = fileName =>
    mapDiagnostics(fileName, base.getSemanticDiagnostics(fileName));

  ls.getSuggestionDiagnostics = fileName =>
    mapDiagnostics(fileName, base.getSuggestionDiagnostics(fileName));

  ls.getQuickInfoAtPosition = (fileName, position, ...rest) => {
    const quickInfo = atPosition(fileName, position, virtual =>
      base.getQuickInfoAtPosition(fileName, virtual, ...rest)
    );
    if (!quickInfo) return undefined;
    const mapped = mapSpan({ ...quickInfo, fileName });
    return mapped && { ...quickInfo, textSpan: mapped.textSpan };
  };

  ls.getCompletionsAtPosition = (fileName, position, ...rest) => {
    const completions = atPosition(fileName, position, virtual => {
      const completions = base.getCompletionsAtPosition(
        fileName,
        virtual,
        ...rest
      );
      return completions && completions.entries.length
        ? completions
        : undefined;
    });
    const file = getVirtualFile(fileName);
    if (!completions || !file) return completions;
    const mapReplacementSpan = (span: ts.TextSpan | undefined) => {
      const mapped = span && toOriginalSpan(file, span.start, span.length);
      return mapped
        ? { start: mapped.start, length: mapped.length }
        : undefined;
    };
    return {
      ...completions,
      optionalReplacementSpan: mapReplacementSpan(
        completions.optionalReplacementSpan
      ),
      entries: completions.entries.map(entry =>
        entry.replacementSpan
          ? {
              ...entry,
              replacementSpan: mapReplacementSpan(entry.replacementSpan),
            }
          : entry
      ),
    };
  };

  ls.getCompletionEntryDetails = (fileName, position, ...rest) =>
    atPosition(fileName, position, virtual =>
      base.getCompletionEntryDetails(fileName, virtual, ...rest)
    );

  ls.getDefinitionAtPosition = (fileName, position, ...rest) =>
    mapSpans(
      atPosition(fileName, position, virtual =>
        base.getDefinitionAtPosition(fileName, virtual, ...rest)
      )
    );

  ls.getDefinitionAndBoundSpan = (fileName, position) => {
    const result = atPosition(fileName, position, virtual => {
      const result = base.getDefinitionAndBoundSpan(fileName, virtual);
      return result && result.definitions && result.definitions.length
        ? result
        : undefined;
    });
    if (!result) return result;
    const bound = mapSpan({ fileName, textSpan: result.textSpan });
    if (!bound) return undefined;
    return {
      definitions: mapSpans(result.definitions),
      textSpan: bound.textSpan,
    };
  };

  ls.getTypeDefinitionAtPosition = (fileName, position) =>
    mapSpans(
      atPosition(fileName, position, virtual =>
        base.getTypeDefinitionAtPosition(fileName, virtual)
      )
    );

  ls.getImplementationAtPosition = (fileName, position) =>
    mapSpans(
      atPosition(fileName, position, virtual =>
        base.getImplementationAtPosition(fileName, virtual)
      )
    );

  ls.getReferencesAtPosition = (fileName, position) => {
    const references = mapSpans(
      atAllPositions(fileName, position, virtual =>
        base.getReferencesAtPosition(fileName, virtual)
      )
    );
    return references && dedupe(references);
  };

  ls.findReferences = (fileName, position) => {
    const symbols = atAllPositions(fileName, position, virtual =>
      base.findReferences(fileName, virtual)
    );
    if (!symbols) return symbols;
    const seen = new Set<string>();
    return symbols
      .map(symbol => {
        const definition = mapSpan(symbol.definition);
        const references = dedupe(mapSpans(symbol.references)!, seen);
        return definition && references.length
          ? { definition, references }
          : undefined;
      })
      .filter((symbol): symbol is ts.ReferencedSymbol => !!symbol);
  };

  ls.getDocumentHighlights = (fileName, position, filesToSearch) => {
    const highlights = atAllPositions(fileName, position, virtual =>
      base.getDocumentHighlights(fileName, virtual, filesToSearch)
    );
    if (!highlights) return highlights;
    const seen = new Set<string>();
    const byFile = new Map<string, ts.HighlightSpan[]>();
    for (const highlight of highlights) {
      const spans = dedupe(
        mapSpans(
          highlight.highlightSpans.map(span => ({
            ...span,
            fileName: highlight.fileName,
          }))
        )!,
        seen
      );
      byFile.set(highlight.fileName, [
        ...(byFile.get(highlight.fileName) || []),
        ...spans.map(({ fileName: _fileName, ...span }) => span),
      ]);
    }
    return [...byFile].map(([fileName, highlightSpans]) => ({
      fileName,
      highlightSpans,
    }));
  };

  const cannotRename: ts.RenameInfoFailure = {
    canRename: false,
    localizedErrorMessage: 'You cannot rename this element.',
  };

  ls.getRenameInfo = (fileName, position, preferences) => {
    const file = getVirtualFile(fileName);
    if (!getMappedFile(fileName)) {
      return base.getRenameInfo(fileName, position, preferences);
    } else if (!file) {
      return cannotRename;
    }
    const info = atPosition(fileName, position, virtual => {
      const info = base.getRenameInfo(fileName, virtual, preferences);
      return info.canRename ? info : undefined;
    });
    if (!info || !info.canRename) return cannotRename;
    const span = toOriginalSpan(
      file,
      info.triggerSpan.start,
      info.triggerSpan.length
    );
    return span && span.exact
      ? { ...info, triggerSpan: { start: span.start, length: span.length } }
      : cannotRename;
  };

  ls.findRenameLocations = ((
    fileName: string,
    position: number,
    ...rest: [any, any, any]
  ) => {
    const locations = atAllPositions(
      fileName,
      position,
      virtual =>
        (base.findRenameLocations as Function)(fileName, virtual, ...rest) as
          readonly ts.RenameLocation[] | undefined
    );
    if (!locations) return locations;
    // Renames are only safe when every location maps onto the original text
    const mapped = locations.map(location => mapSpan(location, true));
    return mapped.every(location => !!location)
      ? dedupe(mapped as ts.RenameLocation[])
      : undefined;
  }) as ts.LanguageService['findRenameLocations'];

  ls.getNavigateToItems = (...args) =>
    mapSpans(base.getNavigateToItems(...args))!;

  // Features that work on syntax (and would show the virtual module's
  // syntax) don't apply to `.graphql` files
  const emptyClassifications: ts.Classifications = {
    spans: [],
    endOfLineState: ts.EndOfLineState.None,
  };

  const disable = <K extends keyof ts.LanguageService>(
    key: K,
    empty: () => unknown
  ) => {
    const method = base[key] as Function | undefined;
    if (!method) return;
    (ls as any)[key] = (fileName: string, ...rest: unknown[]) =>
      getMappedFile(fileName) ? empty() : method(fileName, ...rest);
  };

  disable('getEncodedSemanticClassifications', () => emptyClassifications);
  disable('getEncodedSyntacticClassifications', () => emptyClassifications);
  disable('getSemanticClassifications', () => []);
  disable('getSyntacticClassifications', () => []);
  disable('getOutliningSpans', () => []);
  disable('getNavigationBarItems', () => []);
  disable('getNavigationTree', () => ({
    text: '',
    kind: ts.ScriptElementKind.moduleElement,
    kindModifiers: '',
    spans: [],
    childItems: [],
  }));
  disable('getFormattingEditsForRange', () => []);
  disable('getFormattingEditsForDocument', () => []);
  disable('getFormattingEditsAfterKeystroke', () => []);
  disable('getBraceMatchingAtPosition', () => []);
  disable('getTodoComments', () => []);
  disable('getSignatureHelpItems', () => undefined);
  disable('getApplicableRefactors', () => []);
  disable('getCodeFixesAtPosition', () => []);
  disable('provideInlayHints', () => []);
  disable('getDocCommentTemplateAtPosition', () => undefined);
  disable('isValidBraceCompletionAtPosition', () => false);
  disable('getJsxClosingTagAtPosition', () => undefined);
  disable('getLinkedEditingRangeAtPosition', () => undefined);
  disable('getSpanOfEnclosingComment', () => undefined);
  disable('getSmartSelectionRange', () => ({
    textSpan: { start: 0, length: 0 },
  }));
  disable('organizeImports', () => []);
  disable('getIndentationAtPosition', () => 0);
};

/** The extensions of the `graphql` language, which editors may send to tsserver */
const GRAPHQL_EXTENSIONS = ['.graphql', '.graphqls', '.gql'];

/** Silences GraphQL files that tsserver parses as TypeScript.
 *
 * @remarks
 * Editor integrations route the `graphql` language to tsserver, so that
 * `.graphql` files can be mapped to TypeScript. Files that no GraphQLSP
 * instance maps (e.g. in projects without the content mapper) would otherwise
 * show TypeScript's syntax errors and semantic tokens. A mapped file's program
 * text differs from the editor's text, which works across stacked plugin
 * instances without sharing any state. */
export const silenceUnmappedGraphQLFiles = (
  info: ts.server.PluginCreateInfo,
  languageService: ts.LanguageService
) => {
  const isUnmapped = (fileName: unknown): boolean => {
    if (
      typeof fileName !== 'string' ||
      !GRAPHQL_EXTENSIONS.some(extension => fileName.endsWith(extension))
    ) {
      return false;
    }
    const scriptInfo = info.project.getScriptInfo(fileName);
    const sourceFile = info.languageService
      .getProgram()
      ?.getSourceFile(fileName);
    if (!scriptInfo || !sourceFile) return true;
    const snapshot = scriptInfo.getSnapshot();
    return snapshot.getText(0, snapshot.getLength()) === sourceFile.text;
  };

  const emptyClassifications: ts.Classifications = {
    spans: [],
    endOfLineState: ts.EndOfLineState.None,
  };

  const empty: { [K in keyof ts.LanguageService]?: () => unknown } = {
    getSyntacticDiagnostics: () => [],
    getSemanticDiagnostics: () => [],
    getSuggestionDiagnostics: () => [],
    getEncodedSemanticClassifications: () => emptyClassifications,
    getEncodedSyntacticClassifications: () => emptyClassifications,
    getSemanticClassifications: () => [],
    getSyntacticClassifications: () => [],
    getCompletionsAtPosition: () => undefined,
    getQuickInfoAtPosition: () => undefined,
    getDefinitionAtPosition: () => undefined,
    getDefinitionAndBoundSpan: () => undefined,
    getTypeDefinitionAtPosition: () => undefined,
    getReferencesAtPosition: () => undefined,
    findReferences: () => undefined,
    getDocumentHighlights: () => undefined,
    getOutliningSpans: () => [],
    getNavigationBarItems: () => [],
    getNavigationTree: () => ({
      text: '',
      kind: ts.ScriptElementKind.moduleElement,
      kindModifiers: '',
      spans: [],
      childItems: [],
    }),
    getFormattingEditsForRange: () => [],
    getFormattingEditsForDocument: () => [],
    getFormattingEditsAfterKeystroke: () => [],
    getBraceMatchingAtPosition: () => [],
    getTodoComments: () => [],
    getSignatureHelpItems: () => undefined,
    getApplicableRefactors: () => [],
    getCodeFixesAtPosition: () => [],
    provideInlayHints: () => [],
    getDocCommentTemplateAtPosition: () => undefined,
    isValidBraceCompletionAtPosition: () => false,
    getJsxClosingTagAtPosition: () => undefined,
    getLinkedEditingRangeAtPosition: () => undefined,
    getSpanOfEnclosingComment: () => undefined,
  };

  for (const key of Object.keys(empty) as Array<keyof ts.LanguageService>) {
    const method = languageService[key] as Function | undefined;
    if (typeof method !== 'function') continue;
    (languageService as any)[key] = (fileName: unknown, ...rest: unknown[]) =>
      isUnmapped(fileName)
        ? empty[key]!()
        : method.call(languageService, fileName, ...rest);
  }
};
