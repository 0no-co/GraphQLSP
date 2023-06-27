# GraphQLSP

This is a TypeScript LSP Plugin that will recognise documents in your
TypeScript code and help you out with hover-information, diagnostics,
auto-complete and automatically generating [Typed-Document-nodes](https://the-guild.dev/graphql/codegen/plugins/typescript/typed-document-node)

## Features

- Hover information showing the decriptions of fields
- Diagnostics for adding fields that don't exist, are deprecated, missmatched argument types, ...
- Auto-complete inside your editor for fields
- When you save it will generate `typed-document-nodes` for your documents and cast them to the correct type
- Will warn you when you are importing from a file that is exporting fragments that you're not using

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

now restart your TS-server and you should be good to go, ensure you are using the
workspace version of TypeScript. In VSCode you can do so by clicking the bottom right
when on a TypeScript file or adding a file like [this](https://github.com/0no-co/GraphQLSP/blob/main/packages/example/.vscode/settings.json).

### Configuration

- `schema` allows you to specify a url, `.json` or `.graphql` file as your schema. If you need to specify headers for your introspection
  you can opt into the object notation i.e. `{ "schema": { "url": "x", "headers": { "Authorization": "y" } }}`
- `disableTypegen` disables type-generation in general
- `scalars` allows you to pass an object of scalars that we'll feed into `graphql-code-generator`
- `extraTypes` allows you to specify imports or declare types to help with `scalar` definitions
- `shouldCheckForColocatedFragments` when turned on (default), this will scan your imports to find
  unused fragments and provide a message notifying you about them

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

## Local development

Run `pnpm i` at the root. Open `packages/example` by running `code packages/example` or if you want to leverage
breakpoints do it with the `TSS_DEBUG_BRK=9559` prefix. When you make changes in `packages/graphqlsp` all you need
to do is run `pnpm i` in your other editor and restart the `TypeScript server` for the changes to apply.

> Ensure that both instances of your editor are using the Workspace Version of TypeScript
