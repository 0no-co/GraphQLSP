import type { GraphQLSchema } from 'graphql';

import { getGraphQLDiagnostics } from './diagnostics';
import { init, reset, ts as activeTypeScript } from './ts';

export interface NativeGraphQLSPProject {
  readonly program: {
    getSourceFile(fileName: string): unknown;
  };
  readonly checker: unknown;
}

export interface NativeGraphQLSPConfig {
  clientDirectives?: string[];
  templateIsCallExpression?: boolean;
}

export interface NativeGraphQLSPDiagnostic {
  category: number;
  code: number;
  file: unknown;
  messageText: string;
  start: number;
  length: number;
}

export interface NativeTypeScriptModules {
  /** The `typescript/unstable/sync` module namespace. */
  sync: Record<string, unknown>;
  /** The `typescript/unstable/ast` module namespace. */
  ast: Record<string, unknown>;
}

let nextNativeDiagnosticVersion = 1;
const nativeDiagnosticVersions = new WeakMap<
  object,
  WeakMap<GraphQLSchema, Map<string, number>>
>();

const getNativeDiagnosticVersion = (
  project: NativeGraphQLSPProject,
  schema: GraphQLSchema,
  config: NativeGraphQLSPConfig
): number => {
  const configKey = JSON.stringify({
    clientDirectives: config.clientDirectives || [],
    templateIsCallExpression: config.templateIsCallExpression ?? true,
  });
  let projectVersions = nativeDiagnosticVersions.get(project);
  if (!projectVersions) {
    nativeDiagnosticVersions.set(project, (projectVersions = new WeakMap()));
  }
  let versions = projectVersions.get(schema);
  if (!versions) projectVersions.set(schema, (versions = new Map()));
  let version = versions.get(configKey);
  if (!version)
    versions.set(configKey, (version = nextNativeDiagnosticVersion++));
  return version;
};

/**
 * Runs GraphQLSP's real document discovery, template resolution, GraphQL
 * validation, and source mapping against a TypeScript 7.1 native snapshot.
 *
 * This is a batch/native API lane. It does not decorate the native language
 * service or publish diagnostics to an editor; TypeScript 7.1 does not expose
 * a plugin feature-injection contract equivalent to PluginCreateInfo yet.
 */
export function createNativeGraphQLSP(modules: NativeTypeScriptModules) {
  const nativeTypeScript = {
    ...modules.ast,
    ...modules.sync,
    isStringLiteralLike(node: unknown) {
      const ast = modules.ast as {
        isStringLiteral(node: unknown): boolean;
        isNoSubstitutionTemplateLiteral(node: unknown): boolean;
      };
      return (
        ast.isStringLiteral(node) || ast.isNoSubstitutionTemplateLiteral(node)
      );
    },
    forEachChild<T>(
      node: { forEachChild(visit: (node: unknown) => T): T },
      visit: (node: unknown) => T
    ) {
      return node.forEachChild(visit);
    },
  };

  const getDiagnostics = (
    project: NativeGraphQLSPProject,
    fileName: string,
    schema: GraphQLSchema,
    config: NativeGraphQLSPConfig = {}
  ): NativeGraphQLSPDiagnostic[] => {
    const previousTypeScript = activeTypeScript;
    init({ typescript: nativeTypeScript } as never);

    try {
      const program = {
        getSourceFile: (name: string) => project.program.getSourceFile(name),
        getTypeChecker: () => project.checker,
      };
      const info = {
        config: {
          ...config,
          // These project-wide features still depend on legacy language
          // service methods that the native snapshot API doesn't expose.
          shouldCheckForColocatedFragments: false,
          trackFieldUsage: false,
        },
        languageService: {
          getProgram: () => program,
        },
      };
      const schemaRef = {
        current: { schema },
        multi: {},
        // GraphQLSP's diagnostics cache keys on SchemaRef.version. Native
        // callers pass schema objects directly, so assign stable versions per
        // project/schema/config tuple to prevent results leaking across native
        // snapshots or invocations.
        version: getNativeDiagnosticVersion(project, schema, config),
        errors: { config: null, load: new Map(), write: new Map() },
        outputLocations: new Map(),
        sourceLocations: new Map(),
        turboLocations: new Map(),
        checkStale() {},
      };

      return (getGraphQLDiagnostics(
        fileName,
        schemaRef as never,
        info as never
      ) || []) as NativeGraphQLSPDiagnostic[];
    } finally {
      // The legacy plugin and public core API share a live TypeScript binding.
      // Restore it so invoking this adapter cannot permanently alter that path.
      if (previousTypeScript) {
        init({ typescript: previousTypeScript });
      } else {
        reset();
      }
    }
  };

  return { getDiagnostics };
}
