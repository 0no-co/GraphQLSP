# GraphQLSP

This is a TypeScript LSP Plugin that will recognise documents in your
TypeScript code and help you out with hover-information, diagnostics,
auto-complete and automatically generating [Typed-Document-nodes](https://the-guild.dev/graphql/codegen/plugins/typescript/typed-document-node)

## Features

- Hover information showing the decriptions of fields
- Diagnostics for adding fields that don't exist, are deprecated, missmatched argument types, ...
- Auto-complete inside your editor for fields
- When you save it will generate `typed-document-nodes` for your documents and cast them to the correct type

## Installation

```sh
npm install -D @0no-co/graphqlsp
```

## Usage

Go to your `tsconfig.json` and add

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

now restart your TS-server and you should be good to go

## Local development

Run `yarn` in both `/` as well as `/example`.

Open two terminal tabs, one where you run the build command which is `yarn tsc` and one
intended to open our `/example`, most of the debugging will happen through setting breakpoints.

Run `TSS_DEBUG_BRK=9559 code example` and ensure that the TypeScript used is the one from the workspace
the `.vscode` folder should ensure that but sometimes it fails. When we use `TSS_DEBUG_BRK` the plugin
won't run until we attach the debugger from our main editor.

After makiing changes you'll have to re-open said editor or restart the TypeScript server and re-attach the
debugger. Breakpoints have to be set in the transpiled JS-code hence using `tsc` currently so the code is a
bit easier to navigate.
