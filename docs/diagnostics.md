# Diagnostics

GraphQLSP reports its findings through the TypeScript language service, so
every diagnostic shows up in your editor like a regular TypeScript error or
warning, tagged with a numeric code — for example `ts(52005)` in VSCode's
hover popup or in the Problems panel. You can use that code to look up the
rule that produced the squiggle in this document.

All codes are defined in
[`packages/graphqlsp/src/diagnostics.ts`](../packages/graphqlsp/src/diagnostics.ts)
(the unused-field code lives in
[`fieldUsage.ts`](../packages/graphqlsp/src/fieldUsage.ts) and the
colocated-fragment code in
[`checkImports.ts`](../packages/graphqlsp/src/checkImports.ts)).

| Code                                                    | Name                                 |
| ------------------------------------------------------- | ------------------------------------ |
| [52001](#52001--graphql-validation-error)               | GraphQL validation error             |
| [52003](#52003--unused-co-located-fragment)             | Unused co-located fragment           |
| [52004](#52004--deprecated-field)                       | Deprecated field                     |
| [52005](#52005--unused-field)                           | Unused field                         |
| [52006](#52006--misconfiguration)                       | Misconfiguration                     |
| [52007](#52007--mode-mismatch)                          | Mode mismatch                        |
| [52008](#52008--unknown-schema-name)                    | Unknown schema name                  |
| [520100](#520100--missing-persisted-document-reference) | Missing persisted document reference |
| [520101](#520101--missing-persisted-hash)               | Missing persisted hash               |
| [520102](#520102--persisted-document-not-found)         | Persisted document not found         |
| [520103](#520103--persisted-hash-mismatch)              | Persisted hash mismatch              |

### 52001 — GraphQL validation error

**When it fires**

Every GraphQL document found by the plugin is validated against your schema
with `graphql-language-service`. Any error-severity result — unknown fields,
unknown arguments, mismatched argument types, malformed syntax, and so on —
is reported as a TypeScript error. Only the first line of the underlying
GraphQL error message is shown.

`Unknown directive` errors are suppressed for known client-side directives:
a built-in list (`@client`, `@populate`, `@unmask`, `@_unmask`, `@_optional`,
`@_required`, `@required`, `@optional`, `@connection`, `@refetchable`,
`@relay`, `@arguments`, `@argumentDefinitions`, `@_relayPagination`,
`@_simplePagination`, `@inline`) plus anything you add via the
`clientDirectives` option.

> Note: when the underlying GraphQL diagnostic already carries a numeric
> code of its own, that code is passed through instead of `52001`.

**Example**

```ts
const query = graphql(`
  query Pokemon($id: ID!) {
    pokemon(id: $id) {
      nam
    }
  }
`);
```

Produces: `Cannot query field "nam" on type "Pokemon". Did you mean "name"?`

**How to fix**

Correct the document so it validates against the schema. If the error is
`Unknown directive` for a directive your client library handles at runtime,
declare it in `clientDirectives` instead.

**Configuration**

Requires a loaded schema (`schema` or `schemas`); documents that can't be
matched to a schema are skipped. `clientDirectives` extends the list of
directives exempt from `Unknown directive` errors:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@0no-co/graphqlsp",
        "schema": "./schema.graphql",
        "clientDirectives": ["myClientDirective"]
      }
    ]
  }
}
```

### 52003 — Unused co-located fragment

**When it fires**

Only in call-expression mode (`templateIsCallExpression` unset or `true`) and
when `shouldCheckForColocatedFragments` is enabled (default: `true`).

For every import in the file (default, named, and namespace imports) that
resolves to a source file outside `node_modules`, the plugin collects the
imported module's exported `graphql()`/`gql()` documents that consist solely
of fragment definitions. If any of those fragment names is neither spread
(`...pokemonFields`) inside a document in the current file nor referenced
directly (used as a value or type anywhere other than a `graphql()`
fragment-reference array — for example passed to an unmasking helper or
re-exported), a warning is placed on the import's module specifier.

**Example**

```ts
// PokemonFields.ts
export const PokemonFields = graphql(`
  fragment pokemonFields on Pokemon {
    id
    name
  }
`);

// Pokemon.ts
import { PokemonFields } from './PokemonFields';

const query = graphql(`
  query {
    pokemon(id: 1) {
      id
    }
  }
`);
```

Produces: `Unused co-located fragment definition(s) "pokemonFields" in './PokemonFields'`

**How to fix**

Spread the fragment in one of the file's documents (in gql.tada, also pass
the fragment document in the fragment-reference array of the `graphql()`
call), use the imported document directly, or remove the import.

**Configuration**

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@0no-co/graphqlsp",
        "schema": "./schema.graphql",
        "shouldCheckForColocatedFragments": false
      }
    ]
  }
}
```

### 52004 — Deprecated field

**When it fires**

Same validation pass as [52001](#52001--graphql-validation-error), but for
warning-severity results — in practice, selecting a field that the schema
marks with `@deprecated`. Reported as a TypeScript warning.

**Example**

```ts
const query = graphql(`
  query {
    pokemon(id: 1) {
      classification # marked "@deprecated(reason: 'Use types instead')" in the schema
    }
  }
`);
```

Produces: `The field Pokemon.classification is deprecated. Use types instead`

**How to fix**

Stop selecting the deprecated field and use its suggested replacement.

**Configuration**

No dedicated option; it follows the schema's deprecation metadata. Like
52001 it requires a loaded `schema`/`schemas`.

### 52005 — Unused field

**When it fires**

Only in call-expression mode, and when `trackFieldUsage` is enabled (default:
`true`). The plugin builds the selection set of each document in the file and
follows every access to the query result _within the same file_ — through
variable declarations whose initializer involves the document (e.g.
`useQuery`), destructuring patterns, aliases and reassignments, `for…of`
loops, and array-method callbacks (`map`, `filter`, `forEach`, `reduce`,
`every`, `some`, `find`, `flatMap`, `sort`). A leaf field counts as used when
it's read; when an object escapes the file's analysis — returned, passed as a
call argument, or spread — its whole subtree is considered used.

The check stays silent in these cases:

- documents whose text contains `mutation` or `subscription` (extra fields
  are commonly selected for normalized-cache updates);
- fields named `id`, `_id`, or `__typename`, plus anything in the
  `reservedKeys` option;
- documents whose result is never accessed in the file at all (it's assumed
  to be consumed elsewhere).

Warnings for unused leaves are aggregated onto their parent field in the
document (`Field(s) 'pokemon.name' are not used.`); unused top-level fields
are reported individually (`Field name is not used.`).

**Example**

```ts
const query = graphql(`
  query Pokemon($id: ID!) {
    pokemon(id: $id) {
      id
      name
      classification
    }
  }
`);

const [result] = useQuery({ query, variables: { id } });
return <span>{result.data?.pokemon?.name}</span>;
```

Produces, on `pokemon`: `Field(s) 'pokemon.classification' are not used.`
(`id` is a reserved key and stays exempt.)

**How to fix**

Remove the unused field from the selection set, or use it. If the field is
intentionally selected for a side effect (e.g. cache normalization), add it
to `reservedKeys`, or disable the rule with `trackFieldUsage`.

**Configuration**

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@0no-co/graphqlsp",
        "schema": "./schema.graphql",
        "trackFieldUsage": true,
        "reservedKeys": ["slug"]
      }
    ]
  }
}
```

### 52006 — Misconfiguration

**When it fires**

Reported as an error on the first GraphQL document of a file (so a broken
setup is visible in the editor rather than only in the tsserver log) when any
of the following holds:

- the plugin configuration is invalid, e.g. the `schema` option is missing;
- a schema failed to load or reload — a missing file, invalid SDL, or an
  unreachable introspection URL;
- the `tadaOutputLocation` typings file could not be written;
- a typings file was written successfully more than 30 seconds ago but is
  still not part of the TypeScript project, i.e. it isn't matched by your
  tsconfig's `include` patterns.

**Example**

With `"schema": "./missing.graphql"` pointing at a file that doesn't exist,
the first document in each file gets an error such as:
`Failed to load the GraphQL schema: …`

**How to fix**

The message states the exact problem: fix the plugin entry in
`compilerOptions.plugins`, point `schema`/`schemas` at a valid source, make
the output path for `tadaOutputLocation` writable, or extend your tsconfig
`include` so it covers the generated typings file.

**Configuration**

This diagnostic reflects the state of the configuration itself — primarily
`schema`/`schemas` and `tadaOutputLocation`:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@0no-co/graphqlsp",
        "schema": "./schema.graphql",
        "tadaOutputLocation": "./src/graphql-env.d.ts"
      }
    ]
  }
}
```

### 52007 — Mode mismatch

**When it fires**

Only when the plugin found **no** GraphQL documents in a file using its
configured mode. It then probes the file for documents written in the other
mode (using the known template names `gql` and `graphql`, plus the `template`
option):

- configured for call expressions (`templateIsCallExpression` unset or
  `true`), but the file contains tagged templates like `` gql`…` ``;
- configured for tagged templates (`templateIsCallExpression: false`), but
  the file contains `graphql()`/`gql()` calls whose string argument looks
  like a GraphQL document (starts with `query`, `mutation`, `subscription`,
  `fragment`, or `{`).

Reported as a warning on the first such document.

**Example**

With the default configuration:

```ts
const query = gql`
  query {
    pokemons {
      name
    }
  }
`;
```

Produces: `Found GraphQL documents in tagged templates, but GraphQLSP is configured to search for graphql()/gql() calls. If you use tagged templates, set "templateIsCallExpression": false in the plugin configuration in your tsconfig.json.`

**How to fix**

Either switch the documents to the configured style, or change
`templateIsCallExpression` to match the style you use.

**Configuration**

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@0no-co/graphqlsp",
        "schema": "./schema.graphql",
        "templateIsCallExpression": false
      }
    ]
  }
}
```

### 52008 — Unknown schema name

**When it fires**

In multi-schema setups. gql.tada `graphql()` functions carry the schema name
they were created for as a type brand; when a document (or
`graphql.persisted()` call) uses a function branded with a name that doesn't
appear in the `schemas` option, the document is silently skipped by all other
features — so this error points that out. It's only checked once at least
one schema has finished loading, and it's reported on the document itself.

**Example**

With `schemas` configuring only `pokemons`, but a `graphql` function created
via `initGraphQLTada` for a schema named `characters`:

Produces: `This document refers to the schema named "characters", which isn't configured. Configured schemas are: pokemons.`

**How to fix**

Add the schema to the `schemas` option, or create the document with the
`graphql` function belonging to a configured schema.

**Configuration**

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@0no-co/graphqlsp",
        "schemas": [
          {
            "name": "pokemons",
            "schema": "./pokemons.graphql",
            "tadaOutputLocation": "./src/pokemons-env.d.ts"
          }
        ]
      }
    ]
  }
}
```

## Persisted-operations diagnostics

The following codes are produced for `graphql.persisted()` calls (gql.tada
persisted documents), and only in call-expression mode. They are all reported
as warnings. The expected shape is:

```ts
const query = graphql(`
  query Pokemon($id: ID!) {
    pokemon(id: $id) {
      name
    }
  }
`);

const persisted = graphql.persisted<typeof query>('sha256:<hash>');
// or, passing the document as a runtime argument:
const persistedAlt = graphql.persisted('sha256:<hash>', query);
```

### 520100 — Missing persisted document reference

**When it fires**

The `graphql.persisted()` call doesn't establish a usable reference to the
document it persists. One of three messages is produced:

- neither a type argument nor a second (document) argument is present:
  `Missing generic pointing at the GraphQL document.`
- a type argument is present but isn't a `typeof` query:
  `Provided generic should be a typeQueryNode in the shape of graphql.persisted<typeof document>.`
- a second argument is present but is neither an identifier nor a call
  expression:
  `Provided argument should be an identifier or invocation of "graphql" in the shape of graphql.persisted(hash, document).`

**How to fix**

Point the call at the document, either through the generic
(`graphql.persisted<typeof query>(hash)`) or through the second argument
(`graphql.persisted(hash, query)`).

### 520101 — Missing persisted hash

**When it fires**

The document reference resolved, but the call has no first argument — the
persisted hash is missing.

Produces: `The call-expression is missing a hash for the persisted argument.`

**How to fix**

Pass the hash as the first argument. GraphQLSP offers a code fix that inserts
the computed `sha256:…` hash for you.

### 520102 — Persisted document not found

**When it fires**

The reference in the generic or second argument couldn't be resolved to a
GraphQL document:

- the identifier/type query doesn't resolve to a value in scope (also across
  files): `Can't find reference to "typeof query".`
- it resolves, but not to a `graphql()`/`gql()` call with a string document:
  `Referenced type "query" is not a GraphQL document.`

**How to fix**

Make the referenced variable an actual `graphql()` call with an inline
document string, and ensure the identifier used in `typeof …` or as the
second argument is in scope.

### 520103 — Persisted hash mismatch

**When it fires**

The hash argument starts with `sha256:` but doesn't match the hash GraphQLSP
computes for the referenced document (the document plus all of its resolved
fragments, with `@_unmask` directives stripped). Hashes that don't start with
`sha256:` are not verified.

Produces: `The persisted document's hash is outdated`

**How to fix**

Recompute the hash — GraphQLSP offers a code fix on the call that replaces
the stale hash with the up-to-date `sha256:…` value. This typically fires
after the document or one of its fragments changed.

**Configuration (all persisted diagnostics)**

There is no dedicated option; these checks run whenever
`templateIsCallExpression` is unset or `true`:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@0no-co/graphqlsp",
        "schema": "./schema.graphql",
        "templateIsCallExpression": true
      }
    ]
  }
}
```
