# @0no-co/graphqlsp

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
