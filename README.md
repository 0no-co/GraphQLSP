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

- `template` add an additional template to the defaults `gql` and `graphql`
- `templateIsCallExpression` this tells our client that you are using `graphql('doc')` (default: true)
  when using `false` it will look for tagged template literals
- `shouldCheckForColocatedFragments` when turned on, this will scan your imports to find
  unused fragments and provide a message notifying you about them (only works with call-expressions, default: true)
- `trackFieldUsage` this only works with the client-preset, when turned on it will warn you about
  unused fields within the same file. (only works with call-expressions, default: true)
- `tadaOutputLocation` when using `gql.tada` this can be convenient as it automatically generates
  an `introspection.ts` file for you, just give it the directory to output to and you're done
- `tadaDisablePreprocessing` this setting disables the optimisation of `tadaOutput` to a pre-processed TypeScript type, this is off by default.
- `clientDirectives` this setting allows you to specify additional `clientDirectives` which won't be seen as a missing schema-directive.

## Framework support

GraphQLSP is a [TypeScript Language Service plugin](https://github.com/microsoft/TypeScript/wiki/Writing-a-Language-Service-Plugin):
it only runs inside `tsserver`. Whether it can work inside a framework's single-file
components therefore depends on whether that framework's language tooling routes those
files through `tsserver` (where `tsconfig.json` plugins are loaded) or through its own,
separate language server (where they are not).

Regular `.ts`/`.tsx` files work in any framework project, so keeping your GraphQL
documents in plain TypeScript files and importing them into components always works.

### Vue - supported

[Vue Language Tools](https://github.com/vuejs/language-tools) serves TypeScript features
for `.vue` files through the regular `tsserver` running `@vue/typescript-plugin`
("hybrid mode", [the only mode as of Vue Language Tools v3](https://github.com/vuejs/language-tools/discussions/5456)).
Because the Vue plugin maps positions between the SFC and its virtual TypeScript
representation at the `tsserver` boundary, GraphQLSP diagnostics, hover information,
and auto-completions inside `<script setup lang="ts">` blocks all work and are reported
at the correct `.vue` source locations.

Setup ([full example](https://github.com/0no-co/GraphQLSP/tree/main/packages/example-vue)):

1. Add `@0no-co/graphqlsp` to `compilerOptions.plugins` in your `tsconfig.json` as usual
2. Make sure your `include` covers your `.vue` files, e.g. `"include": ["src/**/*.ts", "src/**/*.vue"]`
3. Use the official [Vue (Official) editor extension](https://marketplace.visualstudio.com/items?itemName=Vue.volar),
   which loads `@vue/typescript-plugin` into `tsserver` for you, and make sure the
   workspace version of TypeScript is used. In other editors (Neovim, ...), configure
   `vtsls` or `typescript-language-server` with `@vue/typescript-plugin` as a global
   plugin with `languages: ["vue"]` as per
   [the Vue Language Tools upgrade guide](https://github.com/vuejs/language-tools/discussions/5456)

This was verified headlessly against the raw `tsserver` protocol with
`@vue/typescript-plugin@3.3.6` and TypeScript 5.3.3: GraphQL validation diagnostics,
schema hover information, and field auto-completions all appear inside `.vue` files.

Known limitations:

- `vue-tsc` (like `tsc`) never runs language service plugins, so GraphQLSP's document
  validation won't show up in CLI type checks. When using `gql.tada` you can run
  [`gql-tada check`](https://gql-tada.0no.co/get-started/installation) with the
  `@gql.tada/vue-support` package installed to get the same document diagnostics in CI
- `gql.tada`'s type-level checking still works in `.vue` files with `vue-tsc`, but on
  its own it won't error on fields that don't exist in the schema - the document
  diagnostics come from GraphQLSP or `gql-tada check`

### Svelte - partial (`.ts` files only)

The [svelte-language-server](https://github.com/sveltejs/language-tools) handles
`.svelte` files itself instead of routing them through `tsserver`, and it does not load
TypeScript plugins from `tsconfig.json`. Its companion `typescript-svelte-plugin` only
teaches `tsserver` about `.svelte` imports inside `.ts` files and deliberately returns
no diagnostics for `.svelte` files themselves. Loading external TypeScript plugins in
`.svelte` files is a long-standing open feature request, see
[sveltejs/language-tools#905](https://github.com/sveltejs/language-tools/issues/905)
(labeled as a limitation) and [#251](https://github.com/0no-co/GraphQLSP/issues/251) /
[#168](https://github.com/0no-co/GraphQLSP/issues/168) on this repository.

What this means for a SvelteKit project:

- GraphQL documents in `.ts`/`.js` modules (`+page.ts`, `load` functions, a co-located
  `queries.ts`, ...) get the full GraphQLSP experience
- documents inside `.svelte` `<script>` blocks get no GraphQLSP features; prefer
  defining documents in `.ts` files and importing them
- when using `gql.tada`, `gql-tada check` with the `@gql.tada/svelte-support` package
  can validate documents inside `.svelte` files on the CLI

### Astro - not supported in `.astro` files (`.ts` files work)

The Astro language server (Volar-based, now part of the
[Astro monorepo](https://github.com/withastro/astro/tree/main/packages/language-tools))
type-checks `.astro` frontmatter in its own language server instead of delegating to
`tsserver`, and it does not initialize plugins from `compilerOptions.plugins`. Requests
for this were declined, see
[withastro/language-tools#991](https://github.com/withastro/language-tools/issues/991)
and [withastro/astro#16917](https://github.com/withastro/astro/issues/16917) (both
closed as not planned), and [#242](https://github.com/0no-co/GraphQLSP/issues/242) on
this repository.

Until Astro's tooling loads `tsconfig.json` plugins, keep GraphQL documents in `.ts`
files - where GraphQLSP works as usual, including in Astro projects - and import them
into your `.astro` components.

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
