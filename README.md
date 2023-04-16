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

1. Run `pnpm i` at the root
1. Run `pnpm launch-debug` to run a VS Code instance with debugging enabled This will run a sandboxed version of VS Code
1. Go to "Run and Debug" (⌘⇧D) and run "Attach to VS Code TS Server via Port"
1. Run `pnpm dev` to produce unminified source code for easier debugging
1. Now you can select breakpoints in the built code in `packages/example/node_modules/@0no-co/graphqlsp/dist/index.js`
1. After you've made changes you have to restart the TS server in the extension VS Code instance (Command Palette -> "Restart TS Server")
1. You also need to reconnect the debugger (🔄 point 4)

<details>
  <summary><b>TL;DR video</b></summary>

https://user-images.githubusercontent.com/571589/232340571-4fcf0c97-6817-497f-bee9-7be07baeb10e.mp4

</details>
  
### Troubleshooting

- If the debugger doesn't attach:
  - Open some `.ts` file, otherwise the TS Server won't start
  - Make sure that you've selected the correct TypeScript instance (for both VS Codes)
    <img src="https://user-images.githubusercontent.com/571589/232340638-1ba61c96-7aed-46ae-a192-0d2c070d18fb.png" height=500 />
