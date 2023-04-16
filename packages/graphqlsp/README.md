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

Run `pnpm i` at the root. Open `packages/example` by running `code packages/example` or if you want to leverage
breakpoints do it with the `TSS_DEBUG_BRK=9559` prefix. When you make changes in `packages/graphqlsp` all you need
to do is run `pnpm i` in your other editor and restart the `TypeScript server` for the changes to apply.

> Ensure that both instances of your editor are using the Workspace Version of TypeScript
