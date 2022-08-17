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
