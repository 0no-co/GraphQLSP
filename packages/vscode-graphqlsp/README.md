# GraphQLSP for VSCode

VSCode extension for [GraphQLSP](https://github.com/0no-co/GraphQLSP), bringing schema-aware
GraphQL support to TypeScript and JavaScript:

- **TypeScript server plugin** — contributes `@0no-co/graphqlsp` to VSCode's built-in
  TypeScript language features, so you get diagnostics, auto-completion, hover information,
  and go-to-definition for GraphQL documents without installing the plugin per project.
- **Syntax highlighting** for `.graphql`, `.gql`, and `.graphqls` files.
- **Document symbols** for embedded GraphQL operations and fragments in the Outline view
  and “Go to Symbol in Editor…” (`Cmd/Ctrl+Shift+O`).
- **Inline syntax highlighting** for GraphQL documents in TypeScript/JavaScript:
  `` gql`...` `` and `` graphql`...` `` tagged templates, ``graphql(`...`)`` call
  expressions (the [gql.tada](https://gql-tada.0no.co) style), and untagged template
  literals starting with a `#graphql` comment.

## Setup

The recommended way to configure GraphQLSP is in your project's `tsconfig.json`, which keeps
the configuration shared with your whole team and CI:

```jsonc
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@0no-co/graphqlsp",
        "schema": "./schema.graphql",
      },
    ],
  },
}
```

When a project lists the plugin in its `tsconfig.json` — as `@0no-co/graphqlsp` or as
gql.tada's `gql.tada/ts-plugin` — that configuration always wins, and the project doesn't
need the plugin in its own `node_modules`: the extension defers to a running project-local
instance, and otherwise adopts the tsconfig entry's configuration using its bundled copy.

Alternatively — e.g. for projects whose tsconfig you don't control — the plugin can be
configured through VSCode settings:

```jsonc
{
  "graphqlsp.schema": "./schema.graphql",
  "graphqlsp.templateIsCallExpression": false,
}
```

The settings mirror the plugin's options (`graphqlsp.schema`, `graphqlsp.schemas`,
`graphqlsp.template`, `graphqlsp.templateIsCallExpression`,
`graphqlsp.shouldCheckForColocatedFragments`, `graphqlsp.trackFieldUsage`,
`graphqlsp.clientDirectives`, `graphqlsp.tadaOutputLocation`,
`graphqlsp.tadaDisablePreprocessing`); see the
[GraphQLSP README](https://github.com/0no-co/GraphQLSP#readme) for what they do. VSCode
settings only apply to projects that _don't_ configure the plugin in their `tsconfig.json` —
per project, the plugin uses the first of: the project's tsconfig entry, these editor
settings, or nothing (dormant). Settings changes require a TypeScript server restart (the
extension offers one when settings change).

Without any configuration in either place, the language service plugin stays dormant and
only the syntax highlighting is active.

> **Note:** If you use a TypeScript version installed in your workspace, run the
> **“TypeScript: Select TypeScript Version…”** command and ensure the workspace version is
> used; the plugin is enabled for both the bundled and workspace versions.

## Development

```sh
pnpm install
pnpm --filter vscode-graphqlsp build
```

Open `packages/vscode-graphqlsp` in VSCode and press F5 (“Run Extension”) to launch an
Extension Development Host. To inspect plugin logs, run the
**“TypeScript: Open TS Server log”** command in the development host and search for
`[GraphQLSP]`.

To build an installable `.vsix`:

```sh
pnpm --filter vscode-graphqlsp package
```

This stages the extension together with an npm-installed copy of the workspace's
`@0no-co/graphqlsp` (pnpm's symlinked layout can't be packaged directly) and runs
`vsce package` on it.
