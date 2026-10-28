import type { ts } from './ts';

/** The type checker methods GraphQLSP's diagnostics rely on.
 *
 * @remarks
 * The TypeScript 7 adapter (see `./ts7`) implements these on top of the
 * TypeScript 7.1 API, which has no `ts.server` API to plug into, so anything
 * the diagnostics need from the checker has to be listed here.
 */
export type HostChecker = Pick<
  ts.TypeChecker,
  | 'getSymbolAtLocation'
  | 'getAliasedSymbol'
  | 'getTypeAtLocation'
  | 'getTypeOfSymbol'
  | 'getShorthandAssignmentValueSymbol'
  | 'getContextualType'
  | 'getExportsOfModule'
>;

/** The program methods GraphQLSP's diagnostics rely on. */
export interface HostProgram {
  getSourceFile(fileName: string): ts.SourceFile | undefined;
  getTypeChecker(): HostChecker;
  getSourceFiles?(): readonly ts.SourceFile[];
}

/** The subset of a TypeScript plugin's `PluginCreateInfo` that GraphQLSP's
 * diagnostics (document discovery, fragment resolution, schema validation,
 * colocation and field usage checks) rely on.
 *
 * @remarks
 * A `ts.server.PluginCreateInfo` satisfies this interface as-is, which is how
 * the TypeScript 5/6 plugin uses it. The TypeScript 7 adapter creates one
 * from a TypeScript 7.1 API project instead.
 */
export interface GraphQLSPHost {
  /** The GraphQLSP plugin configuration. */
  config: any;
  languageService: {
    getProgram(): HostProgram | undefined;
  };
  project: {
    /** The project's `tsconfig.json` path. */
    getProjectName(): string;
    projectService: {
      logger: { info(message: string): void };
    };
  };
}
