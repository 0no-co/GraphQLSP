# TypeScript 7 development and validation

The [root guide](../README.md#typescript-7-editor-integration) and
[npm README](../packages/graphqlsp/README.md#typescript-7-editor-integration)
describe end-user setup, including the npm-only LSP path. The
[extension README](../packages/vscode-graphqlsp/README.md) covers VS Code setup.
This document covers implementation boundaries and reproducible checks.

## How the integrations fit together

The classic TS 5/6 plugin and native API integrations share GraphQL host
operations for diagnostics, hover, completion, schema definitions, fragment
references and rename, quick fixes, and fragment extraction.

- `packages/graphqlsp/src/session.ts` owns the API connection, snapshot lifetime,
  schema state, and serialized feature/check calls. It refreshes the snapshot
  after initial schema loading so results use current document text.
- `packages/graphqlsp/src/languageFeatures.ts` translates shared operations into
  LSP positions, ranges, locations, completion items, code actions, and edits.
- `packages/graphqlsp/src/lsp.ts` forwards native LSP traffic and augments
  supported requests through a worker. It preserves native completion triggers
  and code-action kinds, resolves GraphQL completion items locally, and forwards
  ordinary TypeScript operations to the native server.
- `packages/vscode-graphqlsp/src/typescript7` connects to a TypeScript extension's
  API session and runs GraphQL work in a child process. It owns GraphQL completion
  items, uses middleware where supported, and provides adapters for older APIs.
  Native-mode changes dispose providers and diagnostics; server restarts create
  a fresh connection.
- `packages/graphqlsp/src/ts7/relay.ts` bridges the synchronous API client when
  direct pipe connections are unavailable. On Windows, `windowsRelay.ts` embeds
  source compiled with .NET Framework 4.x; Unix uses a shell launcher.

Results include the source text they were computed against. Integrations must
discard stale results. Cross-file edits additionally require validation of the
affected documents' identities and versions, including close/reopen transitions.
The VS Code adapter and proxy perform these checks before returning edits.

Local schema watching covers edits, deletion, and creation after an initial
missing-file error. Changed schemas are invalidated before reload; failed loads
do not silently reuse the old schema. Named schemas await initial readiness too.

## Prerequisites and build

Local validation used Node.js 22 and pnpm 11.3.0, matching the configured CI.
From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm --filter vscode-graphqlsp build
```

The workspace compiler remains TS 5/6 for building and compatibility tests. The
native fixture installs `typescript-7` as an alias of TypeScript 7.1.0-beta, so
native testing does not replace the workspace compiler. The tsrs fixture has no
Windows binary and is skipped there; use the native TypeScript implementation.

## Regression tests and typechecks

Run the complete suite:

```sh
pnpm exec vitest run --no-file-parallelism
```

For native editor/session/proxy changes, the targeted CI set is:

```sh
pnpm exec vitest run test/e2e/ts7-session.test.ts test/e2e/lsp-proxy.test.ts test/e2e/lsp-shutdown.test.ts test/unit/lspProtocol.test.ts test/unit/schemaRecovery.test.ts test/unit/editVersions.test.ts test/unit/nativeMode.test.ts test/unit/vscode-ts7-features.test.ts --no-file-parallelism
```

This covers unsaved snapshots, schema recovery and initial readiness, native
capabilities, GraphQL/native completion resolution, stale edits, setting
precedence, cancellation, and shutdown with documents open and closed.

Typecheck both packages explicitly:

```sh
pnpm exec tsc -p packages/graphqlsp --noEmit --types node --module esnext --moduleResolution bundler
pnpm exec tsc -p packages/vscode-graphqlsp --noEmit
```

To save machine-readable regression evidence:

```sh
pnpm exec vitest run --no-file-parallelism --reporter=default --reporter=json --outputFile.json=.tmp/regression-results.json
```

## Packaging both installation paths

Package the npm module without installing an editor extension:

```sh
pnpm --filter @0no-co/graphqlsp build
pnpm --filter @0no-co/graphqlsp pack --pack-destination .
```

The tarball name is derived from the package's current version. Install that
`.tgz` into a separate project with `npm install -D /absolute/path/to/package.tgz`.
Install TypeScript 7.1+ there, keep the GraphQLSP tsconfig entry, and launch the
proxy using the [documented Node command](../README.md#without-a-vsix-npm-and-an-lsp-client).

Package the VS Code integration:

```sh
pnpm --filter vscode-graphqlsp package
```

This builds the extension and core, packs the local npm module, and stages a
flat dependency tree before running `vsce package`. The output is
`packages/vscode-graphqlsp/vscode-graphqlsp-<version>.vsix`; the accompanying npm
tarball is in `packages/vscode-graphqlsp/.staging/`. Both contain their respective
READMEs. Packing does not publish to npm or the VS Code Marketplace.

## Actual VS Code validation

After packaging, run the isolated editor harness from the repository root:

```sh
node scripts/dogfood-vscode.mjs --code /absolute/path/to/Code --cli /absolute/path/to/resources/app/out/cli.js --results .tmp/dogfood-results.json
```

Use the installed VS Code executable and its matching CLI JavaScript file. On
Windows, quote paths containing spaces; versioned installations can place
`resources/app/out/cli.js` under a version directory beside `Code.exe`. The
optional `--vsix /absolute/path/to/file.vsix` selects an artifact explicitly.

The harness needs a desktop session and network access to install Microsoft's
TypeScript extension. It creates fresh temporary user-data and extension
directories and a fixture workspace. It installs the local VSIX and native
TypeScript extension, runs editor commands, and leaves the user's normal
profile untouched. The console prints the retained temporary directory for
logs; the JSON report records versions, checks, and failures. Any failed check
causes an unsuccessful exit.

The checks cover native diagnostics, unsaved correction, resolved completion
and application, hover, schema definitions, cross-file references, applied
rename, applied quick fixes and fragment extraction, schema edits and
deletion/recreation, server restart, TS 5/6 versus native switching, legacy
setting scope precedence, and resetting native enablement to unset.

## Shutdown workaround

The API worker stops accepting work, drains pending operations, and disposes
its session before native LSP shutdown. The relay releases retained snapshots
and files, half-closes the API connection, and waits for remote closure.

The tested native TS 7.1 server can still stall in API-session cleanup. After
requesting native shutdown, the proxy gives it two seconds to reply. On timeout,
it logs the fallback, terminates that in-memory child, and replies to the
client's shutdown request. It keeps the client transport alive until `exit`,
rejects further feature requests, and suppresses late duplicate shutdown replies.
This contains the native cleanup race; it does not repair it upstream.

## Validation scope and release status

The Windows implementation was exercised with VS Code 1.136.2,
TypeScriptTeam.native-preview 1.0.1, and TypeScript 7.1.0-beta. Before the
documentation pass, 149 regression tests in 28 files passed, 13 real-editor
checks passed, both packages typechecked, and an independent sub-agent's
14-case native shutdown stress run passed. These are local validation results,
not claims about every TypeScript or editor extension version.

The released native extension uses its older API shape; the newer middleware
adapter is covered by unit tests, not an actual released-editor run. The
`package-vscode.yaml` workflow is configured to build/test/package on Windows,
macOS, and Linux. macOS/Linux jobs were not executed in this local session,
and that workflow does not run the actual desktop-editor harness.

The npm changeset and extension version are independent. This local work does
not publish either artifact; CI packaging and Marketplace publishing are
separate actions. Rebuild after documentation changes so the npm README and
VSIX listing match the source, and record hashes against the exact artifact
used for editor validation.
