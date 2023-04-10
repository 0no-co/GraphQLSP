# GraphQLSP

https://github.com/microsoft/TypeScript/wiki/Writing-a-Language-Service-Plugin

## Installation

```sh
npm install -D graphqlsp
```

## Usage

Go to your `tsconfig.json` and add

```json
{
  "compilerOptions": {
    "plugins": [{
      "name": "graphqlsp",
      "schema": "./schema.graphql"
    }]
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
