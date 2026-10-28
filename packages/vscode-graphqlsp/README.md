# GraphQLSP for VSCode

VSCode extension for [GraphQLSP](https://github.com/0no-co/GraphQLSP), bringing schema-aware
GraphQL support to TypeScript and JavaScript:

- **TypeScript 5/6 server plugin** — contributes `@0no-co/graphqlsp` to VSCode's built-in
  TypeScript language features, so you get diagnostics, auto-completion, hover information,
  and go-to-definition for GraphQL documents without installing the plugin per project.
- **TypeScript 7.1+ integration** — connects to the native TypeScript extension's
  API session for diagnostics, hover, completion, schema navigation, fragment
  references and rename, quick fixes, and fragment extraction.
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

With TypeScript 7, also follow [TypeScript 7](#typescript-7) below to activate
the native integration. The npm package and tsconfig entry alone do not enable
GraphQLSP in the native server.

When a project lists the plugin in its `tsconfig.json` — as `@0no-co/graphqlsp` or as
gql.tada's `gql.tada/ts-plugin` — that configuration always wins, and the project doesn't
need the plugin in its own `node_modules`: the extension defers to a running project-local
instance, and otherwise adopts the tsconfig entry's configuration using its bundled copy.

With TypeScript 5/6, the plugin can alternatively be configured through VSCode
settings, for example for projects whose tsconfig you don't control:

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

## TypeScript 7

TypeScript 7 does not load TypeScript server plugins. This extension connects
to the native server's API session instead. **TypeScript 7.1+** is required;
7.0 does not expose the API used by GraphQLSP. TypeScript 5/6 keep using the plugin.

1. Install this extension's VSIX with **Extensions: Install from VSIX…**, and
   install a compatible TypeScript native extension, such as
   [TypeScript Native Preview](https://marketplace.visualstudio.com/items?itemName=TypeScriptTeam.native-preview).
2. Install TypeScript 7.1+ in your project. Local validation used
   `npm install -D typescript@7.1.0-beta`.
3. Select that SDK and enable native mode. The locally tested `.vscode/settings.json` is:

   ```json
   {
     "js/ts.experimental.useTsgo": true,
     "js/ts.tsdk.path": "./node_modules/typescript"
   }
   ```

4. Configure the plugin and schema in tsconfig as above. Restart the
   TypeScript server, then open a JS/TS file belonging to that project.

The VSIX includes GraphQLSP; installing its npm package in each project is
optional for this editor integration. The project still needs its own
GraphQL dependencies. GraphQLSP uses the same native server as the TypeScript
extension, including its unsaved document snapshots.

With TypeScript 7, only projects that configure the plugin in their `tsconfig.json` are
checked; the `graphqlsp.*` settings don't apply. The extension also provides hover,
completion, schema-field navigation, fragment references and rename, quick fixes,
and fragment extraction in call-expression mode. Local schema files are watched,
including deletion and recreation; save schema edits for the watcher to see them.
Paths resolve relative to the tsconfig declaring the plugin entry, including
inherited configurations. Restart the native server after changing the plugin
settings or schema paths.
Remote URL schemas load once per native API session; restart the server to
refresh them. Automatic watching applies to local schema files.

Native server restarts reconnect automatically. Switching back to TS 5/6, or
resetting explicit native-mode enablement, disposes the native diagnostics and
providers. The deprecated `typescript.experimental.useTsgo` setting alias is
also recognized with the native extension's scope precedence.

Windows isn't supported yet with TS 7. The TS 7
path does not reproduce navigation from generated gql.tada turbo-cache result
types back into queries. This extension supplies syntax highlighting for standalone
`.graphql` files, but its native API language features target embedded GraphQL
in JS/TS; use a GraphQL language server for standalone files.

Hover uses TypeScript's response middleware when available. Completion items
always belong to GraphQLSP's own provider so the native completion resolver
never receives them; middleware suppresses native suggestions in GraphQL contexts. Rename uses a provider so native
`prepareRename` errors inside strings cannot hide GraphQL fragment renames.

### Using the npm package without this extension

The npm package also ships `graphqlsp --stdio`, a TypeScript LSP proxy. Use an
LSP client configured to start it as your TypeScript server:

```sh
node ./node_modules/@0no-co/graphqlsp/bin/graphqlsp.cjs --stdio
```

Run it with the project root as the working directory. It starts the native
TypeScript server itself. Use either this extension's native integration or
the proxy for a given set of files to avoid duplicate results. Stock VS Code
does not discover and start the proxy from an npm install or tsconfig entry.
See the [npm package's guide](https://github.com/0no-co/GraphQLSP/blob/main/packages/graphqlsp/README.md#without-a-vsix-npm-and-an-lsp-client)
for installation, client configuration, compiler selection, and flags.

### Troubleshooting

Open **View: Toggle Output** and select **GraphQLSP** to inspect native API
messages. If no GraphQL features appear, verify the native extension is active,
the server and selected SDK both use TypeScript 7.1+, and the file belongs to
a tsconfig project with a valid GraphQLSP schema. A project inferred without
a tsconfig entry is skipped. For older TypeScript extension APIs, explicitly
select the workspace SDK and allow that extension to use it.
This extension requires a trusted workspace; VS Code's Restricted Mode disables it.

If `graphqlsp.*` settings have no effect under TS 7, move that configuration to
the tsconfig plugin entry.

### Packaging and release status

The extension is released separately from the npm package. CI builds a `.vsix`
artifact on macOS and Linux; install it with **Extensions: Install from
VSIX…**. Marketplace publishing remains a separate maintainer action.
Locally generated packages and VSIX files are not automatically published.

## Development

```sh
pnpm install
pnpm --filter @0no-co/graphqlsp build
pnpm --filter vscode-graphqlsp build
```

Open `packages/vscode-graphqlsp` in VSCode and press F5 (“Run Extension”) to launch an
Extension Development Host. To inspect plugin logs, run the
**“TypeScript: Open TS Server log”** command in the development host and search for
`[GraphQLSP]`. Native TS 7 messages appear in the **GraphQLSP** Output channel.

To build an installable `.vsix`:

```sh
pnpm --filter vscode-graphqlsp package
```

This stages the extension together with an npm-installed copy of the workspace's
`@0no-co/graphqlsp` (pnpm's symlinked layout can't be packaged directly) and runs
`vsce package` on it.

## Real-editor dogfooding

After building the VSIX, run the isolated editor harness against an installed
VS Code executable and its CLI JavaScript entry point:

```sh
node scripts/dogfood-vscode.mjs --code /path/to/Code --cli /path/to/resources/app/out/cli.js
```

The harness installs the built VSIX and Microsoft's TypeScript extension into a
fresh temporary profile, copies the TS 7 fixture, and runs actual VS Code editor
commands. It exercises unsaved diagnostics, hover, resolved completion items and
application, schema navigation, cross-file references/rename, quick fixes,
fragment extraction, schema edits/deletion/recreation, native server restart,
and switching between TypeScript 6 and 7. It writes a JSON evidence report
(`--results /path/to/results.json`) and retains the isolated profile and logs
for inspection. It does not change the user's normal profile.

Run the command from the repository root after `pnpm install` and packaging.
The install phase needs Marketplace access; this is an actual editor test and
requires a desktop session. `--vsix /path/to/file.vsix` selects an artifact
explicitly; the default uses the extension manifest's current version.

For architecture, regression commands, typechecks, packaging outputs, and
the distinction between local validation and configured cross-platform CI,
see [TypeScript 7 development and validation](https://github.com/0no-co/GraphQLSP/blob/main/docs/typescript-7-development.md).
