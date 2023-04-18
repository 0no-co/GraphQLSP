# @0no-co/graphqlsp

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
