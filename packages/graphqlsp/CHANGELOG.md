# @0no-co/graphqlsp

## 1.0.1

### Patch Changes

- Ensure we track usage across all references
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#170](https://github.com/0no-co/GraphQLSP/pull/170))

## 1.0.0

### Major Changes

- Look for `gql` and `graphql` by default as well as change the default for call-expressions to true.
  If you are using TaggedTemplateExpressions you can migrate by adding the following to your tsconfig file
  ```json
  {
    "plugins": [
      {
        "name": "@0no-co/graphqlsp",
        "schema": "...",
        "templateIsCallExpression": false
      }
    ]
  }
  ```
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#162](https://github.com/0no-co/GraphQLSP/pull/162))
- Retire automatic typegen with tagged-templates, we encourage folks to either try out
  [gql.tada](https://github.com/0no-co/gql.tada) or the [client-preset](https://the-guild.dev/graphql/codegen/docs/guides/react-vue)
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#148](https://github.com/0no-co/GraphQLSP/pull/148))
- Remove `fragment-checking` from tagged-templates due to issues with barrel-file exports and flip defaults for field usage and import tracking with call-expressions
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#166](https://github.com/0no-co/GraphQLSP/pull/166))

### Minor Changes

- Add option named `tadaOutputLocation` to automatically write the `introspection.ts` file
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#165](https://github.com/0no-co/GraphQLSP/pull/165))
- Update build process to output typings and to bundle more dependencies
  Submitted by [@kitten](https://github.com/kitten) (See [#167](https://github.com/0no-co/GraphQLSP/pull/167))
- Use `ts` namespace passed to plugin by TypeScript instance, rather than re-requiring/importing it
  Submitted by [@kitten](https://github.com/kitten) (See [#167](https://github.com/0no-co/GraphQLSP/pull/167))
- Allow `tadaOutputLocation` to contain filename targets and switch between a `.d.ts` and `.ts` output mode
  Submitted by [@kitten](https://github.com/kitten) (See [#169](https://github.com/0no-co/GraphQLSP/pull/169))

## 0.15.0

### Minor Changes

- Make the LSP work with [`gql.tada`](https://github.com/0no-co/gql.tada)
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#160](https://github.com/0no-co/GraphQLSP/pull/160))

## 0.14.1

### Patch Changes

- Check whether we are on the correct template tag
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#157](https://github.com/0no-co/GraphQLSP/pull/157))

## 0.14.0

### Minor Changes

- Warn when an import defines a fragment that is unused in the current file
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#152](https://github.com/0no-co/GraphQLSP/pull/152))

## 0.13.0

### Minor Changes

- Track field usage and warn when a field goes unused
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#146](https://github.com/0no-co/GraphQLSP/pull/146))

### Patch Changes

- Adjust documentation display
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#126](https://github.com/0no-co/GraphQLSP/pull/126))

## 0.12.1

### Patch Changes

- Upgrade TypeScript dependency, this would normally not result in a changeset but it had us remove the normal auto-complete and quick-info and only do that logic when ours ends up in no results
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#136](https://github.com/0no-co/GraphQLSP/pull/136))
- Don't error on known client-side directives
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#144](https://github.com/0no-co/GraphQLSP/pull/144))

## 0.12.0

### Minor Changes

- Use our internal suggestions algo for better arugments and spread-suggestions
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#132](https://github.com/0no-co/GraphQLSP/pull/132))

### Patch Changes

- Add fragments to the cache-key when using call-expressions
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#134](https://github.com/0no-co/GraphQLSP/pull/134))

## 0.11.2

### Patch Changes

- ⚠️ Fix crash during fragment aggregation step
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#119](https://github.com/0no-co/GraphQLSP/pull/119))

## 0.11.1

### Patch Changes

- Poll schema every minute
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#112](https://github.com/0no-co/GraphQLSP/pull/112))

## 0.11.0

### Minor Changes

- Support the GraphQL Code Generator client preset
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#109](https://github.com/0no-co/GraphQLSP/pull/109))

## 0.10.1

### Patch Changes

- Resolve parsed AST nodes being interpolated into an operation
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#105](https://github.com/0no-co/GraphQLSP/pull/105))
- add caching for gql-diagnostics
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#104](https://github.com/0no-co/GraphQLSP/pull/104))
- Correctly bail when file has typescript errors
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#107](https://github.com/0no-co/GraphQLSP/pull/107))

## 0.10.0

### Minor Changes

- Change default config to not check for co-located fragments by default
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#99](https://github.com/0no-co/GraphQLSP/pull/99))

### Patch Changes

- Prevent duplicate async file-generation processes from happening
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#100](https://github.com/0no-co/GraphQLSP/pull/100))

## 0.9.2

### Patch Changes

- ⚠️ Fix setting `shouldCheckForColocatedFragments` to `false` falling back to `true`
  Submitted by [@dan-lee](https://github.com/dan-lee) (See [#96](https://github.com/0no-co/GraphQLSP/pull/96))

## 0.9.1

### Patch Changes

- Catch expression statements
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#94](https://github.com/0no-co/GraphQLSP/pull/94))

## 0.9.0

### Minor Changes

- Add missing dependencies
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#91](https://github.com/0no-co/GraphQLSP/pull/91))

## 0.8.0

### Minor Changes

- Allow specifying headers for fetching the introspection
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#87](https://github.com/0no-co/GraphQLSP/pull/87))

### Patch Changes

- Guard against no schema or errored codegen attempts
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#89](https://github.com/0no-co/GraphQLSP/pull/89))
- catch more schema errors and improve logging
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#84](https://github.com/0no-co/GraphQLSP/pull/84))

## 0.7.4

### Patch Changes

- Correctly replace with identical replacement strings
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#82](https://github.com/0no-co/GraphQLSP/pull/82))
- Account for offsets in auto-complete as well
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#81](https://github.com/0no-co/GraphQLSP/pull/81))
- ⚠️ Fix quick-info getting offset by preceding fragments
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#78](https://github.com/0no-co/GraphQLSP/pull/78))

## 0.7.3

### Patch Changes

- Avoid polluting with diagnostics not in current file
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#73](https://github.com/0no-co/GraphQLSP/pull/73))

## 0.7.2

### Patch Changes

- ⚠️ Fix multiple selection-set updates
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#69](https://github.com/0no-co/GraphQLSP/pull/69))

## 0.7.1

### Patch Changes

- ⚠️ Fix forgotten typegen
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#67](https://github.com/0no-co/GraphQLSP/pull/67))

## 0.7.0

### Minor Changes

- Add option to disable type-generation
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#64](https://github.com/0no-co/GraphQLSP/pull/64))

## 0.6.2

### Patch Changes

- ⚠️ Fix extra types
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#62](https://github.com/0no-co/GraphQLSP/pull/62))

## 0.6.1

### Patch Changes

- Add `nonOptionalTypename: true` as this allows for easier type matching
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#60](https://github.com/0no-co/GraphQLSP/pull/60))

## 0.6.0

### Minor Changes

- Add new option named `extraTypes` which can be used to define an additional set of types to help with the `scalar` definitions
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#58](https://github.com/0no-co/GraphQLSP/pull/58))
- Change `avoidOptionals` to false in the base type generation
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#58](https://github.com/0no-co/GraphQLSP/pull/58))

## 0.5.2

### Patch Changes

- dont perform file additions when we have ts-errors
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#56](https://github.com/0no-co/GraphQLSP/pull/56))

## 0.5.1

### Patch Changes

- First perform the graphqlsp operations and only after do the TypeScript ones, this to account for changed lines from semantic-diagnostics
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#53](https://github.com/0no-co/GraphQLSP/pull/53))

## 0.5.0

### Minor Changes

- Do not suggest fields/fragments/input vars that are already present
  Submitted by [@TheMightyPenguin](https://github.com/TheMightyPenguin) (See [#48](https://github.com/0no-co/GraphQLSP/pull/48))

## 0.4.2

### Patch Changes

- publish with provenance
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#49](https://github.com/0no-co/GraphQLSP/pull/49))

## 0.4.1

### Patch Changes

- Optimise parse performance by omitting location information
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [`660235e`](https://github.com/0no-co/GraphQLSP/commit/660235ef782e60de29f3199c0df839db1f4dfd21))
- Improve the error-codes so they become discernible
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [`8f3de11`](https://github.com/0no-co/GraphQLSP/commit/8f3de11a768bd92a80c4570505f5eab8d8cdb441))

## 0.4.0

### Minor Changes

- Add a `message` diagnostic when we see an import from a file that has `fragment` exports we'll warn you when they are not imported, this because of the assumption that to use this file one would have to adhere to the data requirements of said file.
  You can choose to disable this setting by setting `shouldCheckForColocatedFragments` to `false`
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#42](https://github.com/0no-co/GraphQLSP/pull/42))

## 0.3.0

### Minor Changes

- only run the `typescript` plugin once to generate a set of types that we'll reference from our
  `typescript-operations`, this to reduce lengthy generated files
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#39](https://github.com/0no-co/GraphQLSP/pull/39))

## 0.2.1

### Patch Changes

- Bump the graphql-code-generator and graphiql-utils dependencies
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#35](https://github.com/0no-co/GraphQLSP/pull/35))

## 0.2.0

### Minor Changes

- Add ability to specify a URL for your schema, GraphQLSP will then fetch the introspection from the specified URL
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#26](https://github.com/0no-co/GraphQLSP/pull/26))
- Display some documentation alongside fields and fragments, for fields it will show the documentation or the type and for fragmentSpreads the typeCondition will be displayed
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#31](https://github.com/0no-co/GraphQLSP/pull/31))

### Patch Changes

- Check the `dirty` state of the file an additional time to prevent writing to the file when the user types directly after saving
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#27](https://github.com/0no-co/GraphQLSP/pull/27))
- Enforce the correct type on FragmentSpread suggestions
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#32](https://github.com/0no-co/GraphQLSP/pull/32))
