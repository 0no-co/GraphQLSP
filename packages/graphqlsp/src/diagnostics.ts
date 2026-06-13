import { ts } from './ts';
import { Diagnostic, getDiagnostics } from 'graphql-language-service';
import {
  FragmentDefinitionNode,
  Kind,
  OperationDefinitionNode,
  parse,
  visit,
} from 'graphql';
import { LRUCache } from 'lru-cache';
import fnv1a from '@sindresorhus/fnv1a';
import { print } from '@0no-co/graphql.web';

import {
  findAllCallExpressions,
  findAllImports,
  findAllPersistedCallExpressions,
  findAllTaggedTemplateNodes,
  findAllMaskFragmentsCalls,
  getSource,
  unrollFragment,
} from './ast';
import { getValueOfIdentifier } from './ast/declaration';
import { resolveTemplate } from './ast/resolve';
import { templates } from './ast/templates';
import { UNUSED_FIELD_CODE, checkFieldUsageInFile } from './fieldUsage';
import {
  MISSING_FRAGMENT_CODE,
  getColocatedFragmentNames,
} from './checkImports';
import {
  generateHashForDocument,
  getDocumentReferenceFromDocumentNode,
  getDocumentReferenceFromTypeQuery,
} from './persisted';
import { SchemaRef } from './graphql/getSchema';

const BASE_CLIENT_DIRECTIVES = new Set([
  'populate',
  'client',
  'unmask',
  '_unmask',
  '_optional',
  '_relayPagination',
  '_simplePagination',
  '_required',
  'optional',
  'required',
  'arguments',
  'argumentDefinitions',
  'connection',
  'refetchable',
  'relay',
  'required',
  'inline',
]);

export const SEMANTIC_DIAGNOSTIC_CODE = 52001;
export const USING_DEPRECATED_FIELD_CODE = 52004;
export const MISCONFIGURATION_CODE = 52006;
export const MODE_MISMATCH_CODE = 52007;
export const UNKNOWN_SCHEMA_NAME_CODE = 52008;
export const MISSING_PERSISTED_TYPE_ARG = 520100;
export const MISSING_PERSISTED_CODE_ARG = 520101;
export const MISSING_PERSISTED_DOCUMENT = 520102;
export const MISSMATCH_HASH_TO_DOCUMENT = 520103;
export const ALL_DIAGNOSTICS = [
  SEMANTIC_DIAGNOSTIC_CODE,
  USING_DEPRECATED_FIELD_CODE,
  MISSING_FRAGMENT_CODE,
  UNUSED_FIELD_CODE,
  MISCONFIGURATION_CODE,
  MODE_MISMATCH_CODE,
  UNKNOWN_SCHEMA_NAME_CODE,
  MISSING_PERSISTED_TYPE_ARG,
  MISSING_PERSISTED_CODE_ARG,
  MISSING_PERSISTED_DOCUMENT,
  MISSMATCH_HASH_TO_DOCUMENT,
];

/** How long after writing a typings file we trust the TS project to have
 * picked it up; newly created files take a moment to appear in the program. */
const OUTPUT_PICKUP_GRACE_PERIOD = 30_000;

/** Reports configuration, schema-loading, and typings-output failures on a
 * file's first GraphQL document, so misconfiguration is visible in the
 * editor rather than only in the tsserver log. */
const getMisconfigurationDiagnostics = (
  source: ts.SourceFile,
  nodes: {
    node: ts.StringLiteralLike | ts.TaggedTemplateExpression;
    schema: string | null;
  }[],
  schema: SchemaRef,
  info: ts.server.PluginCreateInfo
): ts.Diagnostic[] => {
  if (!schema.errors || !nodes.length) return [];
  const diagnostics: ts.Diagnostic[] = [];
  const firstNode = nodes[0]!.node;

  const messages = [
    schema.errors.config,
    ...schema.errors.load.values(),
    ...schema.errors.write.values(),
  ].filter(Boolean) as string[];

  // A successfully written typings file that the TS project doesn't include
  // presents as "my types never update" even though generation works
  const program = info.languageService.getProgram();
  if (program) {
    for (const [output, writtenAt] of schema.outputLocations) {
      if (
        Date.now() - writtenAt > OUTPUT_PICKUP_GRACE_PERIOD &&
        !program.getSourceFile(output)
      ) {
        messages.push(
          `The generated typings file "${output}" is not part of the TypeScript project. ` +
            'Check that it is matched by the "include" patterns of your tsconfig.json.'
        );
      }
    }
  }

  for (const messageText of messages) {
    diagnostics.push({
      category: ts.DiagnosticCategory.Error,
      code: MISCONFIGURATION_CODE,
      file: source,
      messageText,
      start: firstNode.getStart(),
      length: firstNode.getEnd() - firstNode.getStart(),
    });
  }

  // A document that names a schema which isn't configured is silently
  // skipped by all other features; only check once a schema has loaded so
  // names aren't reported while loading is still in flight
  const schemaLoaded =
    !!schema.current || Object.values(schema.multi).some(Boolean);
  if (schemaLoaded) {
    const knownNames = Object.keys(schema.multi);
    for (const { node, schema: name } of nodes) {
      if (name && !knownNames.includes(name)) {
        diagnostics.push({
          category: ts.DiagnosticCategory.Error,
          code: UNKNOWN_SCHEMA_NAME_CODE,
          file: source,
          messageText:
            `This document refers to the schema named "${name}", which isn't configured. ` +
            (knownNames.length
              ? `Configured schemas are: ${knownNames.join(', ')}.`
              : 'No named schemas are configured in the "schemas" option.'),
          start: node.getStart(),
          length: node.getEnd() - node.getStart(),
        });
      }
    }
  }

  return diagnostics;
};

/** Reports GraphQL documents written in the mode the plugin is not
 * configured for, which would otherwise be silently ignored. */
const getModeMismatchDiagnostic = (
  source: ts.SourceFile,
  isCallExpression: boolean,
  info: ts.server.PluginCreateInfo
): ts.Diagnostic | null => {
  // Cheap text probe before walking the AST of files without any documents
  const probe = new RegExp(
    `\\b(?:${Array.from(templates).join('|')})\\s*${
      isCallExpression ? '`' : '\\('
    }`
  );
  if (!probe.test(source.getText())) return null;

  let node: ts.Node | undefined;
  let messageText: string;
  if (isCallExpression) {
    node = findAllTaggedTemplateNodes(source)[0];
    messageText =
      'Found GraphQL documents in tagged templates, but GraphQLSP is configured to search for graphql()/gql() calls. ' +
      'If you use tagged templates, set "templateIsCallExpression": false in the plugin configuration in your tsconfig.json.';
  } else {
    // Restricted to string arguments that look like GraphQL documents, since
    // any gql()/graphql() call with a string argument is found by name
    node = findAllCallExpressions(source, info, {
      searchExternal: false,
      collectFragments: false,
    }).nodes.find(x =>
      /^[\s,]*(?:query|mutation|subscription|fragment|\{)/.test(x.node.text)
    )?.node;
    messageText =
      'Found GraphQL documents in graphql()/gql() calls, but GraphQLSP is configured to search for tagged templates. ' +
      'If you use call expressions, remove "templateIsCallExpression": false from the plugin configuration in your tsconfig.json.';
  }

  if (!node) return null;
  return {
    category: ts.DiagnosticCategory.Warning,
    code: MODE_MISMATCH_CODE,
    file: source,
    messageText,
    start: node.getStart(),
    length: node.getEnd() - node.getStart(),
  };
};

const cache = new LRUCache<number, ts.Diagnostic[]>({
  // how long to live in ms
  ttl: 1000 * 60 * 15,
  max: 5000,
});

export function getGraphQLDiagnostics(
  filename: string,
  schema: SchemaRef,
  info: ts.server.PluginCreateInfo
): ts.Diagnostic[] | undefined {
  const isCallExpression = info.config.templateIsCallExpression ?? true;

  let source = getSource(info, filename);
  if (!source) return undefined;

  let fragments: Array<FragmentDefinitionNode> = [],
    nodes: {
      node: ts.StringLiteralLike | ts.TaggedTemplateExpression;
      schema: string | null;
      tadaFragmentRefs?: readonly ts.Identifier[] | null;
    }[];
  if (isCallExpression) {
    const result = findAllCallExpressions(source, info);
    fragments = result.fragments;
    nodes = result.nodes;
  } else {
    nodes = findAllTaggedTemplateNodes(source).map(x => ({
      node: x,
      schema: null,
    }));
  }

  const texts = nodes.map(({ node }) => {
    if (
      (ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateExpression(node)) &&
      !isCallExpression
    ) {
      if (ts.isTaggedTemplateExpression(node.parent)) {
        node = node.parent;
      } else {
        return undefined;
      }
    }

    return resolveTemplate(node, filename, info).combinedText;
  });

  const cacheKey = fnv1a(
    isCallExpression
      ? source.getText() +
          fragments.map(x => print(x)).join('-') +
          schema.version
      : texts.join('-') + schema.version
  );

  let tsDiagnostics: ts.Diagnostic[];
  if (cache.has(cacheKey)) {
    tsDiagnostics = cache.get(cacheKey)!;
  } else {
    tsDiagnostics = runDiagnostics(source, { nodes, fragments }, schema, info);
    cache.set(cacheKey, tsDiagnostics);
  }

  // These are computed on every call, outside of the cached diagnostics,
  // since the error-state can change without `schema.version` changing
  tsDiagnostics = [
    ...getMisconfigurationDiagnostics(source, nodes, schema, info),
    ...tsDiagnostics,
  ];

  if (!nodes.length) {
    const modeMismatch = getModeMismatchDiagnostic(
      source,
      isCallExpression,
      info
    );
    if (modeMismatch) tsDiagnostics.unshift(modeMismatch);
  }

  const shouldCheckForColocatedFragments =
    info.config.shouldCheckForColocatedFragments ?? true;
  let fragmentDiagnostics: ts.Diagnostic[] = [];

  if (isCallExpression) {
    const persistedCalls = findAllPersistedCallExpressions(source, info);
    // We need to check whether the user has correctly inserted a hash,
    // by means of providing an argument to the function and that they
    // are establishing a reference to the document by means of the generic.
    const persistedDiagnostics = persistedCalls
      .map<ts.Diagnostic | null>(found => {
        const { node: callExpression } = found;
        if (!callExpression.typeArguments && !callExpression.arguments[1]) {
          return {
            category: ts.DiagnosticCategory.Warning,
            code: MISSING_PERSISTED_TYPE_ARG,
            file: source,
            messageText: 'Missing generic pointing at the GraphQL document.',
            start: callExpression.getStart(),
            length: callExpression.getEnd() - callExpression.getStart(),
          };
        }

        let foundNode,
          foundFilename = filename,
          ref,
          start,
          length;
        const typeQuery =
          callExpression.typeArguments && callExpression.typeArguments[0];
        if (typeQuery) {
          start = typeQuery.getStart();
          length = typeQuery.getEnd() - typeQuery.getStart();

          if (!ts.isTypeQueryNode(typeQuery)) {
            return {
              category: ts.DiagnosticCategory.Warning,
              code: MISSING_PERSISTED_TYPE_ARG,
              file: source,
              messageText:
                'Provided generic should be a typeQueryNode in the shape of graphql.persisted<typeof document>.',
              start,
              length,
            };
          }
          const { node: found, filename: fileName } =
            getDocumentReferenceFromTypeQuery(typeQuery, filename, info);
          foundNode = found;
          foundFilename = fileName;
          ref = typeQuery.getText();
        } else if (callExpression.arguments[1]) {
          start = callExpression.arguments[1].getStart();
          length =
            callExpression.arguments[1].getEnd() -
            callExpression.arguments[1].getStart();
          if (
            !ts.isIdentifier(callExpression.arguments[1]) &&
            !ts.isCallExpression(callExpression.arguments[1])
          ) {
            return {
              category: ts.DiagnosticCategory.Warning,
              code: MISSING_PERSISTED_TYPE_ARG,
              file: source,
              messageText:
                'Provided argument should be an identifier or invocation of "graphql" in the shape of graphql.persisted(hash, document).',
              start,
              length,
            };
          }

          const { node: found, filename: fileName } =
            getDocumentReferenceFromDocumentNode(
              callExpression.arguments[1],
              filename,
              info
            );
          foundNode = found;
          foundFilename = fileName;
          ref = callExpression.arguments[1].getText();
        }

        if (!foundNode) {
          return {
            category: ts.DiagnosticCategory.Warning,
            code: MISSING_PERSISTED_DOCUMENT,
            file: source,
            messageText: `Can't find reference to "${ref}".`,
            start,
            length,
          };
        }

        const initializer = foundNode;
        if (
          !initializer ||
          !ts.isCallExpression(initializer) ||
          !initializer.arguments[0] ||
          !ts.isStringLiteralLike(initializer.arguments[0])
        ) {
          // TODO: we can make this check more stringent where we also parse and resolve
          // the accompanying template.
          return {
            category: ts.DiagnosticCategory.Warning,
            code: MISSING_PERSISTED_DOCUMENT,
            file: source,
            messageText: `Referenced type "${ref}" is not a GraphQL document.`,
            start,
            length,
          };
        }

        if (!callExpression.arguments[0]) {
          // TODO: this might be covered by the API enforcing the first
          // argument so can possibly be removed.
          return {
            category: ts.DiagnosticCategory.Warning,
            code: MISSING_PERSISTED_CODE_ARG,
            file: source,
            messageText: `The call-expression is missing a hash for the persisted argument.`,
            start: callExpression.arguments.pos,
            length: callExpression.arguments.end - callExpression.arguments.pos,
          };
        }

        const hash = callExpression.arguments[0].getText().slice(1, -1);
        if (hash.startsWith('sha256:')) {
          const generatedHash = generateHashForDocument(
            info,
            initializer.arguments[0],
            foundFilename,
            initializer.arguments[1] &&
              ts.isArrayLiteralExpression(initializer.arguments[1])
              ? initializer.arguments[1]
              : undefined
          );
          if (!generatedHash) return null;

          const upToDateHash = `sha256:${generatedHash}`;
          if (upToDateHash !== hash) {
            return {
              category: ts.DiagnosticCategory.Warning,
              code: MISSMATCH_HASH_TO_DOCUMENT,
              file: source,
              messageText: `The persisted document's hash is outdated`,
              start: callExpression.arguments.pos,
              length:
                callExpression.arguments.end - callExpression.arguments.pos,
            };
          }
        }

        return null;
      })
      .filter(Boolean);

    tsDiagnostics.push(...(persistedDiagnostics as ts.Diagnostic[]));
  }

  if (isCallExpression && shouldCheckForColocatedFragments) {
    const moduleSpecifierToFragments = getColocatedFragmentNames(source, info);
    const typeChecker = info.languageService.getProgram()?.getTypeChecker();

    const usedFragments = new Set();
    nodes.forEach(({ node }) => {
      try {
        const parsed = parse(node.getText().slice(1, -1), {
          noLocation: true,
        });
        visit(parsed, {
          FragmentSpread: node => {
            usedFragments.add(node.name.value);
          },
        });
      } catch (e) {}
    });

    // check for maskFragments() calls
    const maskFragmentsCalls = findAllMaskFragmentsCalls(source);
    maskFragmentsCalls.forEach(call => {
      const firstArg = call.arguments[0];
      if (!firstArg) return;

      // Handle array of fragments: maskFragments([Fragment1, Fragment2], data)
      if (ts.isArrayLiteralExpression(firstArg)) {
        firstArg.elements.forEach(element => {
          if (ts.isIdentifier(element)) {
            const fragmentDefs = unrollFragment(element, info, typeChecker);
            fragmentDefs.forEach(def => usedFragments.add(def.name.value));
          }
        });
      }
    });

    // A fragment referenced directly (as a type/value) rather than declared in a
    // fragment-reference array isn't meant to be spread here, so don't flag it.
    const directlyUsedFragments = getDirectlyUsedFragments(
      source,
      nodes,
      typeChecker
    );

    Object.keys(moduleSpecifierToFragments).forEach(moduleSpecifier => {
      const {
        fragments: fragmentNames,
        start,
        length,
      } = moduleSpecifierToFragments[moduleSpecifier]!;
      const missingFragments = Array.from(
        new Set(
          fragmentNames.filter(
            x => !usedFragments.has(x) && !directlyUsedFragments.has(x)
          )
        )
      );
      if (missingFragments.length) {
        fragmentDiagnostics.push({
          file: source,
          length,
          start,
          category: ts.DiagnosticCategory.Warning,
          code: MISSING_FRAGMENT_CODE,
          messageText: `Unused co-located fragment definition(s) "${missingFragments.join(
            ', '
          )}" in ${moduleSpecifier}`,
        });
      }
    });

    return [...tsDiagnostics, ...fragmentDiagnostics];
  } else {
    return tsDiagnostics;
  }
}

/** Resolves the fragment name(s) defined directly by an identifier's `graphql()`
 * document, excluding fragments it only composes via its reference array. */
function getFragmentNamesForIdentifier(
  identifier: ts.Identifier,
  checker: ts.TypeChecker
): string[] {
  const value = getValueOfIdentifier(identifier, checker);
  if (!value || !ts.isCallExpression(value)) return [];
  const documentArg = value.arguments[0];
  if (!documentArg || !ts.isStringLiteralLike(documentArg)) return [];
  try {
    const parsed = parse(documentArg.getText().slice(1, -1), {
      noLocation: true,
    });
    return parsed.definitions
      .filter(
        (definition): definition is FragmentDefinitionNode =>
          definition.kind === Kind.FRAGMENT_DEFINITION
      )
      .map(definition => definition.name.value);
  } catch (e) {
    return [];
  }
}

/** Collects fragment names whose imported binding is referenced outside both its
 * import and any `graphql()` fragment-reference array — i.e. used directly (as a
 * type, an unmasking-call argument, or a re-export) and so not meant to be
 * spread here. Bindings only in a reference array, or never referenced, are left
 * to warn. */
function getDirectlyUsedFragments(
  source: ts.SourceFile,
  nodes: Array<{ tadaFragmentRefs?: readonly ts.Identifier[] | null }>,
  typeChecker: ts.TypeChecker | undefined
): Set<string> {
  const directlyUsedFragments = new Set<string>();
  if (!typeChecker) return directlyUsedFragments;

  // A reference here is an explicit co-location declaration, not a direct use.
  const fragmentRefIdentifiers = new Set<ts.Node>();
  nodes.forEach(({ tadaFragmentRefs }) => {
    if (tadaFragmentRefs)
      tadaFragmentRefs.forEach(identifier =>
        fragmentRefIdentifiers.add(identifier)
      );
  });

  // Index occurrences by symbol once, rather than re-walking per import.
  const occurrencesBySymbol = new Map<ts.Symbol, ts.Identifier[]>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const symbol = typeChecker.getSymbolAtLocation(node);
      if (symbol) {
        const existing = occurrencesBySymbol.get(symbol);
        if (existing) existing.push(node);
        else occurrencesBySymbol.set(symbol, [node]);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  const bindings: ts.Identifier[] = [];
  findAllImports(source).forEach(imp => {
    const clause = imp.importClause;
    if (!clause) return;
    if (clause.name) bindings.push(clause.name);
    const namedBindings = clause.namedBindings;
    if (namedBindings) {
      if (ts.isNamespaceImport(namedBindings)) {
        bindings.push(namedBindings.name);
      } else {
        namedBindings.elements.forEach(element => bindings.push(element.name));
      }
    }
  });

  bindings.forEach(binding => {
    const symbol = typeChecker.getSymbolAtLocation(binding);
    if (!symbol) return;
    const occurrences = occurrencesBySymbol.get(symbol) || [];
    const usedDirectly = occurrences.some(
      identifier =>
        identifier !== binding && !fragmentRefIdentifiers.has(identifier)
    );
    if (!usedDirectly) return;
    getFragmentNamesForIdentifier(binding, typeChecker).forEach(name =>
      directlyUsedFragments.add(name)
    );
  });

  return directlyUsedFragments;
}

const runDiagnostics = (
  source: ts.SourceFile,
  {
    nodes,
    fragments,
  }: {
    nodes: {
      node: ts.TaggedTemplateExpression | ts.StringLiteralLike;
      schema: string | null;
      tadaFragmentRefs?: readonly ts.Identifier[] | null;
    }[];
    fragments: FragmentDefinitionNode[];
  },
  schema: SchemaRef,
  info: ts.server.PluginCreateInfo
): ts.Diagnostic[] => {
  const filename = source.fileName;
  const isCallExpression = info.config.templateIsCallExpression ?? true;
  const typeChecker = info.languageService.getProgram()?.getTypeChecker();

  const diagnostics = nodes
    .map(originalNode => {
      let node = originalNode.node;
      if (
        !isCallExpression &&
        (ts.isNoSubstitutionTemplateLiteral(node) ||
          ts.isTemplateExpression(node))
      ) {
        if (ts.isTaggedTemplateExpression(node.parent)) {
          node = node.parent;
        } else {
          return undefined;
        }
      }

      const { combinedText: text, resolvedSpans } = resolveTemplate(
        node,
        filename,
        info
      );
      const lines = text.split('\n');

      let isExpression = false;
      if (ts.isAsExpression(node.parent)) {
        if (ts.isExpressionStatement(node.parent.parent)) {
          isExpression = true;
        }
      } else if (ts.isExpressionStatement(node.parent)) {
        isExpression = true;
      }
      // When we are dealing with a plain gql statement we have to add two these can be recognised
      // by the fact that the parent is an expressionStatement

      let startingPosition =
        node.getStart() +
        (isCallExpression
          ? 0
          : (node as ts.TaggedTemplateExpression).tag.getText().length +
            (isExpression ? 2 : 0));
      const endPosition = startingPosition + node.getText().length;
      let docFragments = [...fragments];

      if (
        originalNode.tadaFragmentRefs !== undefined &&
        originalNode.tadaFragmentRefs !== null
      ) {
        const fragmentNames = new Set<string>();
        for (const identifier of originalNode.tadaFragmentRefs) {
          const unrolled = unrollFragment(identifier, info, typeChecker);
          unrolled.forEach((frag: FragmentDefinitionNode) =>
            fragmentNames.add(frag.name.value)
          );
        }
        docFragments = docFragments.filter(frag =>
          fragmentNames.has(frag.name.value)
        );
      }

      if (isCallExpression) {
        try {
          const documentFragments = parse(text, {
            noLocation: true,
          }).definitions.filter(x => x.kind === Kind.FRAGMENT_DEFINITION);
          docFragments = docFragments.filter(
            x =>
              !documentFragments.some(
                y =>
                  y.kind === Kind.FRAGMENT_DEFINITION &&
                  y.name.value === x.name.value
              )
          );
        } catch (e) {}
      }

      const schemaToUse =
        originalNode.schema && schema.multi[originalNode.schema]
          ? schema.multi[originalNode.schema]?.schema
          : schema.current?.schema;

      if (!schemaToUse) {
        return undefined;
      }

      const clientDirectives = new Set([
        ...BASE_CLIENT_DIRECTIVES,
        ...(info.config.clientDirectives || []),
      ]);

      const graphQLDiagnostics = getDiagnostics(
        text,
        schemaToUse,
        undefined,
        undefined,
        docFragments
      )
        .filter(diag => {
          if (!diag.message.includes('Unknown directive')) return true;

          const [message] = diag.message.split('(');
          const matches =
            message && /Unknown directive "@([^)]+)"/g.exec(message);
          if (!matches) return true;
          const directiveName = matches[1];
          return directiveName && !clientDirectives.has(directiveName);
        })
        .map(x => {
          const { start, end } = x.range;

          // We add the start.line to account for newline characters which are
          // split out
          let startChar = startingPosition + start.line;
          for (let i = 0; i <= start.line && i < lines.length; i++) {
            if (i === start.line) startChar += start.character;
            else if (lines[i]) startChar += lines[i]!.length;
          }

          let endChar = startingPosition + end.line;
          for (let i = 0; i <= end.line && i < lines.length; i++) {
            if (i === end.line) endChar += end.character;
            else if (lines[i]) endChar += lines[i]!.length;
          }

          const locatedInFragment = resolvedSpans.find(x => {
            const newEnd = x.new.start + x.new.length;
            return startChar >= x.new.start && endChar <= newEnd;
          });

          if (!!locatedInFragment) {
            return {
              ...x,
              start: locatedInFragment.original.start,
              length: locatedInFragment.original.length,
            };
          } else {
            if (startChar > endPosition) {
              // we have to calculate the added length and fix this
              const addedCharacters = resolvedSpans
                .filter(x => x.new.start + x.new.length < startChar)
                .reduce(
                  (acc, span) => acc + (span.new.length - span.original.length),
                  0
                );
              startChar = startChar - addedCharacters;
              endChar = endChar - addedCharacters;
              return {
                ...x,
                start: startChar + 1,
                length: endChar - startChar,
              };
            } else {
              return {
                ...x,
                start: startChar + 1,
                length: endChar - startChar,
              };
            }
          }
        })
        .filter(x => x.start + x.length <= endPosition);

      return graphQLDiagnostics;
    })
    .flat()
    .filter(Boolean) as Array<Diagnostic & { length: number; start: number }>;

  const tsDiagnostics = diagnostics.map(
    diag =>
      ({
        file: source,
        length: diag.length,
        start: diag.start,
        category:
          diag.severity === 2
            ? ts.DiagnosticCategory.Warning
            : ts.DiagnosticCategory.Error,
        code:
          typeof diag.code === 'number'
            ? diag.code
            : diag.severity === 2
            ? USING_DEPRECATED_FIELD_CODE
            : SEMANTIC_DIAGNOSTIC_CODE,
        messageText: diag.message.split('\n')[0],
      } as ts.Diagnostic)
  );

  if (isCallExpression) {
    const usageDiagnostics =
      checkFieldUsageInFile(
        source,
        nodes.map(x => x.node) as ts.NoSubstitutionTemplateLiteral[],
        info
      ) || [];

    if (!usageDiagnostics) return tsDiagnostics;

    return [...tsDiagnostics, ...usageDiagnostics];
  } else {
    return tsDiagnostics;
  }
};
