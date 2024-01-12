# GraphQLSP

This is a TypeScript LSP Plugin that will recognise documents in your
TypeScript code and help you out with hover-information, diagnostics and
auto-complete.

## Features

- Hover information showing the decriptions of fields
- Diagnostics for adding fields that don't exist, are deprecated, missmatched argument types, ...
- Auto-complete inside your editor for fields
- Will warn you when you are importing from a file that is exporting fragments that you're not using

> Note that this plugin does not do syntax highlighting, for that you still need something like
> [the VSCode/... plugin](https://marketplace.visualstudio.com/items?itemName=GraphQL.vscode-graphql-syntax)

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

> If you are using VSCode ensure that your editor is using [the Workspace Version of TypeScript](https://code.visualstudio.com/docs/typescript/typescript-compiling#_using-the-workspace-version-of-typescript)
> this can be done by manually selecting it or adding a `.vscode/config.json` with the contents of
>
> ```json
> {
>   "typescript.tsdk": "node_modules/typescript/lib",
>   "typescript.enablePromptUseWorkspaceTsdk": true
> }
> ```

### Configuration

**Required**

- `schema` allows you to specify a url, `.json` or `.graphql` file as your schema. If you need to specify headers for your introspection
  you can opt into the object notation i.e. `{ "schema": { "url": "x", "headers": { "Authorization": "y" } }}`

**Optional**

- `template` the shape of your template, by default `gql` and `graphql` are respected
- `templateIsCallExpression` this tells our client that you are using `graphql('doc')`
- `shouldCheckForColocatedFragments` when turned on, this will scan your imports to find
  unused fragments and provide a message notifying you about them
- `trackFieldUsage` this only works with the client-preset, when turned on it will warn you about
  unused fields within the same file.

### GraphQL Code Generator client-preset

For folks using the `client-preset` you can ues the following config

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@0no-co/graphqlsp",
        "schema": "./schema.graphql",
        "disableTypegen": true,
        "shouldCheckForColocatedFragments": true,
        "trackFieldUsage": true
      }
    ]
  }
}
```

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

## Local development

Run `pnpm i` at the root. Open `packages/example` by running `code packages/example` or if you want to leverage
breakpoints do it with the `TSS_DEBUG_BRK=9559` prefix. When you make changes in `packages/graphqlsp` all you need
to do is run `pnpm i` in your other editor and restart the `TypeScript server` for the changes to apply.

> Ensure that both instances of your editor are using the Workspace Version of TypeScript
