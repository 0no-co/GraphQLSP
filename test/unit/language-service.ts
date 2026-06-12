import ts from 'typescript/lib/tsserverlibrary';
import { init } from '../../packages/graphqlsp/src/ts';

// The graphqlsp source accesses TypeScript through a live binding that the
// TSServer normally initializes; for unit tests we initialize it directly.
init({ typescript: ts });

export { ts };

/** Creates an in-memory language service over the given files, mimicking
 * the parts of `ts.server.PluginCreateInfo` that the AST utilities use. */
export function createTestEnvironment(files: Record<string, string>) {
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => Object.keys(files),
    getScriptVersion: () => '1',
    getScriptSnapshot: fileName => {
      const contents =
        files[fileName] != null ? files[fileName] : ts.sys.readFile(fileName);
      return contents != null
        ? ts.ScriptSnapshot.fromString(contents)
        : undefined;
    },
    getCurrentDirectory: () => process.cwd(),
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      strict: true,
    }),
    getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
    fileExists: fileName => fileName in files || ts.sys.fileExists(fileName),
    readFile: fileName =>
      files[fileName] != null ? files[fileName] : ts.sys.readFile(fileName),
  };

  const languageService = ts.createLanguageService(host);
  const info = {
    languageService,
    config: {},
  } as unknown as ts.server.PluginCreateInfo;

  const getSourceFile = (fileName: string): ts.SourceFile => {
    const source = languageService.getProgram()!.getSourceFile(fileName);
    if (!source) throw new Error(`Source file not found: ${fileName}`);
    return source;
  };

  return { languageService, info, getSourceFile };
}

/** A minimal stand-in for a `gql.tada` graphql() function: any function type
 * with both a `scalar` and a `persisted` property is detected as one. */
export const TADA_GRAPHQL_MODULE = `
  export type DocumentNode<Result = unknown, Variables = unknown> = {
    kind: 'document';
    __result?: Result;
    __variables?: Variables;
  };

  export interface GraphQLTadaLike {
    (document: string, fragments?: readonly DocumentNode[]): DocumentNode;
    scalar(name: string, value: unknown): unknown;
    persisted(id: string): DocumentNode;
    __name: 'pokemons';
  }

  export const graphql: GraphQLTadaLike = (() => {
    throw new Error('unimplemented');
  }) as unknown as GraphQLTadaLike;
`;

/** Instruments the program's type checker, counting `getTypeAtLocation`
 * calls made by code under test. */
export function countTypeProbes(
  info: ts.server.PluginCreateInfo
): () => number {
  const checker = info.languageService.getProgram()!.getTypeChecker();
  let count = 0;
  const original = checker.getTypeAtLocation;
  checker.getTypeAtLocation = function (node: ts.Node) {
    count++;
    return original.call(checker, node);
  };
  return () => count;
}
