# GraphQLSP

GraphQLSP provides GraphQL diagnostics, hover information, completion, and
navigation for documents embedded in JavaScript and TypeScript. It runs as a
TypeScript 5/6 language service plugin, or through the TypeScript 7.1+ native
language-server API.

## Features

- Hover information showing the decriptions of fields
- Diagnostics for adding fields that don't exist, are deprecated, missmatched argument types, ...
- Auto-complete inside your editor for fields
- Will warn you when you are importing from a file that is exporting fragments that you're not using
- An "Extract to fragment" refactor that moves selected fields into a new co-located fragment (in `graphql()` call-expression mode)

> Note that this plugin does not do syntax highlighting, for that you still need something like
> [the VSCode/... plugin](https://marketplace.visualstudio.com/items?itemName=GraphQL.vscode-graphql-syntax)

## Installation

```sh
npm install -D @0no-co/graphqlsp
```

## Usage

For all integrations, add the GraphQLSP configuration to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@0no-co/graphqlsp",
        "schema": "./schema.graphql"
      }
    ]
  }
}
```

For TypeScript 7, continue with [TypeScript 7 editor integration](#typescript-7-editor-integration);
the tsconfig entry alone does not activate GraphQLSP.

For TypeScript 5/6, restart your TS server and ensure you are using the
workspace version of TypeScript. In VSCode you can do so by clicking the bottom right
when on a TypeScript file or adding a file like [this](https://github.com/0no-co/GraphQLSP/blob/main/packages/example/.vscode/settings.json).

> If you are using VSCode ensure that your editor is using [the Workspace Version of TypeScript](https://code.visualstudio.com/docs/typescript/typescript-compiling#_using-the-workspace-version-of-typescript)
> this can be done by manually selecting it or adding a `.vscode/settings.json` with the contents of
>
> ```json
> {
>   "js/ts.tsdk.path": "node_modules/typescript/lib",
>   "js/ts.tsdk.promptToUseWorkspaceVersion": true
> }
> ```

### Configuration

**Schema source (choose one)**

- `schema` allows you to specify a url, `.json` or `.graphql` file as your schema. If you need to specify headers for your introspection
  you can opt into the object notation i.e. `{ "schema": { "url": "x", "headers": { "Authorization": "y" } }}`

- `schemas` accepts multiple named schemas instead of a single `schema`, for example:

  ```json
  {
    "name": "@0no-co/graphqlsp",
    "schemas": [
      { "name": "pokemon", "schema": "./pokemon.graphql" },
      { "name": "accounts", "schema": "./accounts.graphql" }
    ]
  }
  ```

  Use the schema name configured in your gql.tada client to select its schema.
  Each schema can also configure its own `tadaOutputLocation`.

**Optional**

- `template` add an additional template to the defaults `gql` and `graphql`
- `templateIsCallExpression` this tells our client that you are using `graphql('doc')` (default: true)
  when using `false` it will look for tagged template literals
- `shouldCheckForColocatedFragments` when turned on, this will scan your imports to find
  unused fragments and provide a message notifying you about them (only works with call-expressions, default: true)
- `trackFieldUsage` this only works with the client-preset, when turned on it will warn you about
  unused fields within the same file. (only works with call-expressions, default: true)
- `tadaOutputLocation` when using `gql.tada` this can be convenient as it automatically generates
  an `introspection.ts` file for you, just give it the directory to output to and you're done
- `reservedKeys` this setting will affect `trackFieldUsage`, you can enter keys here that will be ignored
  from usage tracking, so when they are unused in the component but used in i.e. the normalised cache you
  won't get annoying warnings. (default `id`, `_id` and `__typename`, example: ['slug'])
- `tadaDisablePreprocessing` this setting disables the optimisation of `tadaOutput` to a pre-processed TypeScript type, this is off by default.
- `clientDirectives` this setting allows you to specify additional `clientDirectives` which won't be seen as a missing schema-directive.

## Checking projects with TypeScript 7

TypeScript 7 does not load language service plugins. Adding a plugin to
`tsconfig.json` does not make `tsc` report GraphQLSP diagnostics or make the
native language server load GraphQLSP. Use `checkProject` for a standalone
check, and the [editor integration](#typescript-7-editor-integration) for live
editor features. The classic TypeScript 5/6 plugin remains supported.

`checkProject` uses the TypeScript 7.1 API, or the TypeScript 5/6 compiler API.
It resolves the compiler from the checked project's directory by default:

```js
// Save as check-graphql.mjs and run: node check-graphql.mjs
import { checkProject } from '@0no-co/graphqlsp/check';

const { diagnostics } = await checkProject({
  tsconfigPath: './tsconfig.json',
  compiler: 'typescript',
});

for (const diagnostic of diagnostics) {
  console.log(
    `${diagnostic.file}:${diagnostic.line}:${diagnostic.column} ` +
      `${diagnostic.severity} (${diagnostic.code}): ${diagnostic.message}`
  );
}
process.exitCode = diagnostics.some(item => item.severity === 'error') ? 1 : 0;
```

Run your normal TypeScript check separately; this function returns GraphQLSP
diagnostics, not TypeScript's compiler diagnostics. It does not change the exit
status of a separate `tsc` process.

| Option            | Meaning                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tsconfigPath`    | Required path of the project to check.                                                                                                                       |
| `compiler`        | `'typescript'` (default) or `'tsrs'`.                                                                                                                        |
| `compilerPath`    | Optional compiler package directory or `package.json`, useful for an aliased TypeScript installation.                                                        |
| `files`           | Optional list of files; otherwise checks the project's non-declaration JS/TS files outside `node_modules`. Relative paths use the process working directory. |
| `logger`          | Optional callback for GraphQLSP log messages.                                                                                                                |
| `runExternalCode` | Opt into running the project's content mappers; defaults to `false`.                                                                                         |

The result contains `compiler` (name and version), `tsconfigPath`, `files`, and
`diagnostics`. Diagnostic file paths are absolute; line and column are one-based.
Each diagnostic also has a source span (`start` and `length`), `code`,
`severity`, and `message`.

Configuration comes from `compilerOptions.plugins`, including entries found
through `extends`. Relative schema and output paths resolve against the config
declaring the entry. Schemas load once per check; they are not watched, and
`tadaOutputLocation` typings are not written.

For projects with `contentMappers` in their tsconfig, pass
`runExternalCode: true` to resolve imports from mapped files, such as
`.graphql` files used by `@gql.tada/content-mapper`. Mappers run external
processes, as with `tsc --runExternalCode`. GraphQLSP checks the JS/TS consumers;
the mappers report diagnostics for the mapped files themselves. The tsrs API
does not run content mappers yet, and its current package does not provide a
Windows binary. The native TypeScript path is the locally verified Windows path.

### Connecting to an existing language server

Custom integrations can use `createLanguageServerSession` with an API pipe
from a running TypeScript 7.1+ language server. The compiler package must match
the installation running that server. A pipe can come from the TypeScript
extension's `sdk.initializeAPIConnection()`, or the `pipe` field returned by
the server's `custom/initializeAPISession` request.

The following belongs in your integration's worker; `sdk`, `fileName`, and
`currentText` are supplied by the integration. `fileName` is an absolute path.

```ts
import { createLanguageServerSession } from '@0no-co/graphqlsp/check';

const session = await createLanguageServerSession({
  packageJsonPath: sdk.packageJsonPath,
  pipe: await sdk.initializeAPIConnection(),
  persist: false, // Optional: do not write gql.tada typings.
});
try {
  const checked = await session.check(fileName);
  if (checked && checked.text === currentText) {
    // Publish checked.diagnostics to your editor.
  }
  const hover = await session.hover(fileName, { line: 0, character: 0 });
  // Use hover.result only if hover.text still matches the current document.
} finally {
  session.dispose();
}
```

The checker API blocks synchronously while it talks to TypeScript, even though
the session methods return promises. Run it in a worker or child process to
keep the editor or LSP forwarding loop responsive. Calls are serialized within
a session. Await outstanding calls before disposal, and create a new session
after the underlying server restarts.

| Session call                        | Result                                                    |
| ----------------------------------- | --------------------------------------------------------- |
| `check(fileName)`                   | `{ text, diagnostics }`.                                  |
| `hover(fileName, position)`         | `{ text, result }`, with an LSP Hover or `null`.          |
| `complete(fileName, position)`      | `{ text, result }`, with an LSP CompletionList or `null`. |
| `request(method, fileName, params)` | `{ text, result }`, using the LSP shape for that method.  |
| `dispose()`                         | Closes the API connection and schema watchers.            |

Supported `request` methods are `textDocument/hover`,
`textDocument/completion`, `textDocument/definition`,
`textDocument/references`, `textDocument/prepareRename`,
`textDocument/rename`, and `textDocument/codeAction`. For example:

```ts
const renamed = await session.request('textDocument/rename', fileName, {
  position: { line: 3, character: 12 },
  newName: 'PokemonFields',
});
```

Pass LSP `position` for navigation and references, `newName` for rename,
and `range` plus `context` for code actions. Reference context can include
`includeDeclaration`; code-action context can include `diagnostics` and
`only` (`quickfix` or `refactor.extract`). For quick fixes, pass diagnostics with
`source: 'graphqlsp'` and the diagnostic `code`. Positions and ranges are zero-based
and use UTF-16 character offsets.

Session calls return `null` for files outside configured projects. Feature
payloads use `result: null` outside supported GraphQL contexts. Compare `text`
to the current document before publishing results. For cross-file edits, also
capture and validate every affected open document's identity and version;
the requesting file's `text` alone cannot detect a changed referenced file.

Sessions write configured gql.tada typings by default; pass `persist: false`
to disable this. `logger` receives messages, and `onSchemaChange` tells the
integration to recheck unchanged open files after local schemas reload.

## TypeScript 7 editor integration

TypeScript **7.1 or newer** is required for the API used here; 7.0 is not
supported. Keep the GraphQLSP entry in `compilerOptions.plugins` from
[Usage](#usage), including its schema settings. GraphQLSP reads this as
configuration; the native TypeScript server does not load the classic plugin.

| Environment                                    | How to activate GraphQLSP                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| TypeScript 5/6                                 | Install the npm plugin and configure tsconfig; use the workspace TypeScript version in your editor.          |
| TypeScript 7.1+ in VS Code                     | Install the GraphQLSP extension and a compatible TypeScript native extension, then enable native TypeScript. |
| TypeScript 7.1+ with a configurable LSP client | Install the npm package and launch the bundled LSP proxy as your TypeScript server. No VSIX is required.     |
| CI or scripts                                  | Call `checkProject` separately from your TypeScript compiler check.                                          |

Both TS 7 editor paths provide live diagnostics for open JS/TS files, hover,
completion, schema-field definitions, fragment references and rename, quick
fixes, and the **Extract to fragment** refactor in call-expression mode. They
use the native server's project snapshots, including unsaved edits.

### Without a VSIX: npm and an LSP client

Install a build of `@0no-co/graphqlsp` containing the `graphqlsp` executable
and TypeScript 7.1+. For this local implementation, install the supplied
tarball rather than assuming a registry release includes these changes:

```sh
# Replace the path with the downloaded/local package path.
npm install -D "/absolute/path/to/graphqlsp-ts7-local.tgz"
# The prerelease used for local validation:
npm install -D typescript@7.1.0-beta
```

Keep your existing `tsconfig.json` plugin entry, and set the LSP client's
working directory to your project root. Configure its executable and arguments
as follows (the field names depend on the editor):

```json
{
  "command": "node",
  "args": ["./node_modules/@0no-co/graphqlsp/bin/graphqlsp.cjs", "--stdio"]
}
```

This direct Node command also works on Windows clients that cannot launch
`.cmd` shims. The equivalent executable, when `node_modules/.bin` is on the
client's PATH, is `graphqlsp --stdio`.

Attach this server to the editor's JavaScript, JavaScript React, TypeScript,
and TypeScript React language IDs (JS/JSX/TS/TSX files). It replaces your
direct `tsc --lsp --stdio` server command: the proxy starts and forwards to
the native TypeScript server itself. Disable a duplicate TypeScript LSP
attachment for those same buffers to avoid duplicate diagnostics and edits.
Use the normal LSP initialize/open/change/close/shutdown lifecycle; simply
running the command in a terminal waits for LSP input.

By default the proxy resolves `typescript/package.json` from its working
directory. When the editor uses a different directory, a monorepo root, or
an aliased compiler package, use absolute paths for the proxy script and
`--typescript`:

```sh
node /absolute/path/to/node_modules/@0no-co/graphqlsp/bin/graphqlsp.cjs --stdio --typescript /absolute/path/to/node_modules/typescript
```

| Proxy option          | Meaning                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `--stdio`             | Use the bundled stdio LSP entry point. stdout carries only LSP messages; logs go to stderr.                               |
| `--typescript <path>` | Select the native TypeScript package directory or its `package.json`; defaults to the project-local `typescript` package. |
| `--runExternalCode`   | Allow the native server to run tsconfig content mappers. Omitted by default.                                              |
| `--no-persist`        | Disable writes of configured gql.tada introspection typings. Writes are enabled by default.                               |
| `--help`              | Print command usage and exit.                                                                                             |

**Can VS Code discover the npm package automatically, like the old plugin?**
With TS 7, npm installation plus a tsconfig entry is not sufficient. Use the
GraphQLSP extension or a VS Code LSP client configured to launch the proxy.
The built-in TypeScript extension does not launch this executable from the
plugin entry. The npm-only automatic plugin setup remains available for TS 5/6.

### VS Code extension setup

1. Install the GraphQLSP VSIX with **Extensions: Install from VSIX…** and a
   compatible TypeScript extension, such as
   [TypeScript Native Preview](https://marketplace.visualstudio.com/items?itemName=TypeScriptTeam.native-preview).
2. Point the TypeScript extension at your TypeScript 7.1+ installation and
   enable native TypeScript. The locally tested settings are:

   ```json
   {
     "js/ts.experimental.useTsgo": true,
     "js/ts.tsdk.path": "./node_modules/typescript"
   }
   ```

3. Add the GraphQLSP plugin entry and schema to the project's tsconfig, then
   restart the TypeScript server and open a JS/TS file belonging to that project.

The VSIX bundles GraphQLSP, so this path does not require its npm package in
every project. The project still needs its GraphQL dependencies. GraphQLSP
connects to the native server started by the TypeScript extension; do not also
configure the proxy for the same files.

GraphQLSP follows the TypeScript extension's native-mode settings, including
the deprecated `typescript.experimental.useTsgo` alias and scope precedence.
Switching back to classic TypeScript, or resetting an explicit enablement,
disposes its native diagnostics and providers. Returning to native mode or
restarting the server creates a fresh API session.

### Configuration, platforms, and limits

- Configure TS 7 projects through `compilerOptions.plugins`; VS Code
  `graphqlsp.*` settings apply only to the TS 5/6 plugin path. Existing
  `@0no-co/graphqlsp` and `gql.tada/ts-plugin` entries are recognized.
- Configuration inherited through `extends` is supported. Relative schema
  paths resolve from the config that declares the entry, not the editor's
  working directory. Restart the server after changing plugin settings or
  schema paths.
- Local schema contents are watched, including deletion and recreation.
  Schema changes recheck open files; a failed load does not retain the old
  schema as if it were current. Named schemas are loaded before the first
  feature request. An unsaved schema edit must be saved to reach the file watcher.
- Remote URL schemas load once per TS 7 session; restart the server to refresh
  them. Automatic file watching applies to local schemas.
- The VS Code extension requires a trusted workspace and is disabled in
  Restricted Mode.
- The proxy and extension check embedded GraphQL in JS/TS. Standalone
  `.graphql` files need their own GraphQL language server for language
  features; content mappers can expose their imports to JS/TS consumers.
  Syntax highlighting and document symbols are extension features, not
  features supplied by the npm proxy.
- The TS 7 path does not reproduce navigation from generated gql.tada
  turbo-cache result types back into queries. Ordinary native TypeScript
  navigation remains available at those positions.
- On Windows, the sync API relay requires the installed **.NET Framework 4.x
  C# compiler**. It builds a small included launcher locally; no .NET SDK or
  download is needed. Unix uses a shell launcher. The relay is bypassed when
  TypeScript supports synchronous pipe connections directly.
- TypeScript 7.1 can hang during native API-session cleanup. The proxy drains
  its GraphQL worker first and requests clean native shutdown. If the native
  child does not reply within two seconds, the proxy terminates that child
  and acknowledges shutdown, then waits for the client's `exit`. This is a
  bounded workaround; it does not fix the native server's cleanup race.

### Troubleshooting

| Symptom                                                | Check                                                                                                                                                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm package and tsconfig entry have no effect in TS 7  | Start the proxy through an LSP client, or install and enable the VS Code integration.                                                                                                        |
| Proxy reports that TypeScript 7.1+ is required         | Verify the package selected from the working directory, or pass `--typescript` explicitly.                                                                                                   |
| Proxy cannot resolve `typescript/package.json`         | Use the project root as its working directory and install the compiler there, or select its absolute package path.                                                                           |
| No GraphQL results for a file                          | Ensure it belongs to a configured tsconfig project, has a valid schema, and uses the configured `graphql()` or tagged-template form. Inferred projects without a tsconfig entry are skipped. |
| Native VS Code integration cannot find the API package | Select the same workspace SDK that the native server uses and allow the TypeScript extension to use it. Older extension APIs discover the package through SDK settings.                      |
| Settings changed but behavior did not                  | Restart the TypeScript server after config edits. Save schema-file edits so watchers see them.                                                                                               |
| Windows API relay cannot start                         | Check that .NET Framework 4.x's `csc.exe` is installed; inspect the logged launcher/compiler error.                                                                                          |
| Duplicate diagnostics or rename edits                  | Ensure only one TypeScript LSP handles each buffer; use either the extension integration or proxy.                                                                                           |

For the proxy, capture stderr without mixing it into stdout. For VS Code,
open the **GraphQLSP** Output channel; TS 5/6 plugin logs
are in **TypeScript: Open TS Server log**.

## Tracking unused fields

Currently the tracking unused fields feature has a few caveats with regards to tracking, first and foremost
it will only track the result and the accessed properties in the same file to encourage
[fragment co-location](https://www.apollographql.com/docs/react/data/fragments/#colocating-fragments).

Secondly, we don't track mutations/subscriptions as some folks will add additional fields to properly support
normalised cache updates.

## Fragment masking

When we use a `useQuery` that supports `TypedDocumentNode` it will automatically pick up the typings
from the `query` you provide it. However for fragments this could become a bit more troublesome, the
minimal way of providing typings for a fragment would be the following:

```tsx
import { TypedDocumentNode } from '@graphql-typed-document-node/core';

export const PokemonFields = gql`
  fragment pokemonFields on Pokemon {
    id
    name
  }
` as typeof import('./Pokemon.generated').PokemonFieldsFragmentDoc;

export const Pokemon = props => {
  const pokemon = useFragment(props.pokemon, PokemonFields);
};

export function useFragment<Type>(
  data: any,
  _fragment: TypedDocumentNode<Type>
): Type {
  return data;
}
```

This is mainly needed in cases where this isn't supported out of the box and mainly serves as a way
for you to case your types.

## 💙 [Sponsors](https://github.com/sponsors/urql-graphql)

<table>
  <tr>
   <td align="center"><a href="https://bigcommerce.com/"><img src="https://avatars.githubusercontent.com/u/186342?s=150&v=4" width="150" alt="BigCommerce"/><br />BigCommerce</a></td>
   <td align="center"><a href="https://wundergraph.com/"><img src="https://avatars.githubusercontent.com/u/64281914?s=200&v=4" width="150" alt="WunderGraph"/><br />WunderGraph</a></td>
   <td align="center"><a href="https://the-guild.dev/"><img src="https://avatars.githubusercontent.com/u/42573040?s=200&v=4" width="150" alt="The Guild "/><br />The Guild</a></td>
  </tr>
</table>

<table>
  <tr>
   <td align="center"><a href="https://beatgig.com/"><img src="https://avatars.githubusercontent.com/u/51333382?s=200&v=4" width="100" alt="BeatGig"/><br />BeatGig</a></td>
  </tr>
</table>

## Local development

Run `pnpm i` at the root. Open `packages/example` by running `code packages/example` or if you want to leverage
breakpoints do it with the `TSS_DEBUG_BRK=9559` prefix. When you make changes in `packages/graphqlsp` all you need
to do is run `pnpm i` in your other editor and restart the `TypeScript server` for the changes to apply.

> Ensure that both instances of your editor are using the Workspace Version of TypeScript
