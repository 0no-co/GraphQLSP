# @0no-co/graphqlsp

## 1.15.2

### Patch Changes

- Detect fragment usage in `maskFragments` calls to prevent false positive unused fragment warnings
  Submitted by [@takumiyoshikawa](https://github.com/takumiyoshikawa) (See [#379](https://github.com/0no-co/GraphQLSP/pull/379))

## 1.15.1

### Patch Changes

- Correctly identify missing fragments for gql.tada graphql call-expressions
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#376](https://github.com/0no-co/GraphQLSP/pull/376))

## 1.15.0

### Minor Changes

- Improves field-usage tracking, we bail when the identifier is passed into a function, this bail is intended so we don't have to traverse the whole codebase tracing down usage
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#374](https://github.com/0no-co/GraphQLSP/pull/374))

## 1.14.0

### Minor Changes

- Add new value declaration helpers to replace built-in services and to traverse TypeScript type checked AST exhaustively and efficiently
  Submitted by [@kitten](https://github.com/kitten) (See [#351](https://github.com/0no-co/GraphQLSP/pull/351))

### Patch Changes

- ⚠️ Fix support for default exported graphql() invocations
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#372](https://github.com/0no-co/GraphQLSP/pull/372))

## 1.13.0

### Minor Changes

- Remove missing operation-name code, with our increased focus on not generating any code this becomes irrelevant
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#362](https://github.com/0no-co/GraphQLSP/pull/362))
- Allow supplying a custom `clientDirectives` which will be mixed in with the base client directives
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#370](https://github.com/0no-co/GraphQLSP/pull/370))

### Patch Changes

- Recursively create directories if the target does not exist
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#364](https://github.com/0no-co/GraphQLSP/pull/364))

## 1.12.16

### Patch Changes

- Extract inlined fragments for the non-tada route
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#360](https://github.com/0no-co/GraphQLSP/pull/360))

## 1.12.15

### Patch Changes

- Handle chained expressions while crawling scopes
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#356](https://github.com/0no-co/GraphQLSP/pull/356))

## 1.12.14

### Patch Changes

- Strip our internal `@_unmask` directive from fragment-definitions when creating hashes for persisted-operations
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#354](https://github.com/0no-co/GraphQLSP/pull/354))
- Prevent resolution loop when resolving GraphQL fragments
  Submitted by [@kitten](https://github.com/kitten) (See [#350](https://github.com/0no-co/GraphQLSP/pull/350))

## 1.12.13

### Patch Changes

- ⚠️ Fix wrong fileType diagnostic error when introspection is disabled
  Submitted by [@FyndetNeo](https://github.com/FyndetNeo) (See [#348](https://github.com/0no-co/GraphQLSP/pull/348))

## 1.12.12

### Patch Changes

- Bail on dots, when there's one or two dots we are leading up to a fragment-spread and should avoid giving suggestions
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#344](https://github.com/0no-co/GraphQLSP/pull/344))

## 1.12.11

### Patch Changes

- ⚠️ Fixed duplicate fragments in persisted document hash generator
  Submitted by [@felamaslen](https://github.com/felamaslen) (See [#342](https://github.com/0no-co/GraphQLSP/pull/342))

## 1.12.10

### Patch Changes

- ⚠️ Fix unexpected case of persisted calls resolving to `undefined` AST nodes
  Submitted by [@kitten](https://github.com/kitten) (See [#337](https://github.com/0no-co/GraphQLSP/pull/337))

## 1.12.9

### Patch Changes

- Address potential crashes on malformed TypeScript AST input (such as missing function arguments where they were previously assumed to be passed)
  Submitted by [@kitten](https://github.com/kitten) (See [#335](https://github.com/0no-co/GraphQLSP/pull/335))

## 1.12.8

### Patch Changes

- ⚠️ Fix schema derivation when using `graphql.persisted`, we used the wrong expression in the ast
  Submitted by [@felamaslen](https://github.com/felamaslen) (See [#333](https://github.com/0no-co/GraphQLSP/pull/333))

## 1.12.7

### Patch Changes

- ⚠️ Fix nested fragment resolution during persisted traversal
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#330](https://github.com/0no-co/GraphQLSP/pull/330))

## 1.12.6

### Patch Changes

- Use resolved document text when generating the persisted hash
  Submitted by [@felamaslen](https://github.com/felamaslen) (See [#327](https://github.com/0no-co/GraphQLSP/pull/327))

## 1.12.5

### Patch Changes

- Support property-access-chain in binary-expression assignment
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#324](https://github.com/0no-co/GraphQLSP/pull/324))

## 1.12.4

### Patch Changes

- ⚠️ Fix fragments not being resolved when they're assigned to a property on an arbitrary identifier as an identifier
  Submitted by [@kitten](https://github.com/kitten) (See [#322](https://github.com/0no-co/GraphQLSP/pull/322))

## 1.12.3

### Patch Changes

- Remove unused `node-fetch` dependency
  Submitted by [@kitten](https://github.com/kitten) (See [#318](https://github.com/0no-co/GraphQLSP/pull/318))
- Support finding `graphql()` invocations within call-expressions
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#319](https://github.com/0no-co/GraphQLSP/pull/319))
- Upgrade `@gql.tada/internal` to `^1.0.0`
  Submitted by [@kitten](https://github.com/kitten) (See [#317](https://github.com/0no-co/GraphQLSP/pull/317))

## 1.12.2

### Patch Changes

- Update `graphql` to variably support `^15.5.0` and include future support for v17. The `graphql` package is now marked as a peer dependency in addition to a regular dependency
  Submitted by [@kitten](https://github.com/kitten) (See [#314](https://github.com/0no-co/GraphQLSP/pull/314))

## 1.12.1

### Patch Changes

- ⚠️ Fix schema name being determined incorrectly when calling `graphql` from namespace/property-access
  Submitted by [@kitten](https://github.com/kitten) (See [#312](https://github.com/0no-co/GraphQLSP/pull/312))

## 1.12.0

### Minor Changes

- Add support for defining multiple indepenent schemas through a new config property called `schemas`, you can
  pass a config like the following:
  ```json
  {
    "name": "@0no-co/graphqlsp",
    "schemas": [
      {
        "name": "pokemons",
        "schema": "./pokemons.graphql",
        "tadaOutputLocation": "./pokemons-introspection.d.ts"
      },
      {
        "name": "weather",
        "schema": "./weather.graphql",
        "tadaOutputLocation": "./weather-introspection.d.ts"
      }
    ]
  }
  ```
  The LSP will depending on what `graphql()` template you use figure out what API you are reaching out to.
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#303](https://github.com/0no-co/GraphQLSP/pull/303))
- Expose `findAllCallExpressions` on `@0no-co/graphqlsp/api`
  Submitted by [@kitten](https://github.com/kitten) (See [#308](https://github.com/0no-co/GraphQLSP/pull/308))
- Expand support for `gql.tada` API. GraphQLSP will now recognize `graphql()`/`graphql.persisted()` calls regardless of variable naming and support more obscure usage patterns
  Submitted by [@kitten](https://github.com/kitten) (See [#309](https://github.com/0no-co/GraphQLSP/pull/309))

## 1.11.0

### Minor Changes

- Add validation step to check that the persisted-operations hash has been updated when the document changes
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#301](https://github.com/0no-co/GraphQLSP/pull/301))

## 1.10.3

### Patch Changes

- Correctly identify unused fields on a fragment-definition, these have no parent to group by so we display them as unused leaves
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#299](https://github.com/0no-co/GraphQLSP/pull/299))

## 1.10.2

### Patch Changes

- ⚠️ Fix crash due to typeArguments being undefined
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#297](https://github.com/0no-co/GraphQLSP/pull/297))

## 1.10.1

### Patch Changes

- switch error message for missing operation-name to not allude to typegen
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#290](https://github.com/0no-co/GraphQLSP/pull/290))
- Swap-write introspection file instead of overwriting it directly
  Submitted by [@kitten](https://github.com/kitten) (See [#291](https://github.com/0no-co/GraphQLSP/pull/291))
- ⚠️ Fix directives being misreported due to globally declared regex maintaining state
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#293](https://github.com/0no-co/GraphQLSP/pull/293))

## 1.10.0

### Minor Changes

- Support passing GraphQL documents by value to `graphql.persisted`’s second argument
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#287](https://github.com/0no-co/GraphQLSP/pull/287))

## 1.9.1

### Patch Changes

- Add internal helper to unroll tada fragments
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#285](https://github.com/0no-co/GraphQLSP/pull/285))

## 1.9.0

### Minor Changes

- Add support for `graphql.persisted` https://github.com/0no-co/GraphQLSP/pull/240
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [`9210406`](https://github.com/0no-co/GraphQLSP/commit/9210406744ff94ffcc4958c42478ef98c0b64be6))

### Patch Changes

- Expose persisted helper to translate typeQuery to the corresponding document
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#284](https://github.com/0no-co/GraphQLSP/pull/284))

## 1.8.0

### Minor Changes

- Expose the `init` and `getGraphQLDiagnostics` methods
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#279](https://github.com/0no-co/GraphQLSP/pull/279))

### Patch Changes

- Switch to loading the schema with `@gql.tada/internal` utilities
  Submitted by [@kitten](https://github.com/kitten) (See [#277](https://github.com/0no-co/GraphQLSP/pull/277))

## 1.7.1

### Patch Changes

- Add `typescript` to `peerDependencies`
  Submitted by [@kitten](https://github.com/kitten) (See [#275](https://github.com/0no-co/GraphQLSP/pull/275))

## 1.7.0

### Minor Changes

- Introduce option to pre-process the introspection file, this improves the performance of `gql.tada`. This will be enabled by default and can be turned off by leveraging `tadaDisablePreprocessing: true` in the `tsconfig`
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#273](https://github.com/0no-co/GraphQLSP/pull/273))

## 1.6.1

### Patch Changes

- ⚠️ Fix case where our fragments is an empty array
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#271](https://github.com/0no-co/GraphQLSP/pull/271))

## 1.6.0

### Minor Changes

- Leverage `require.resolve` when following `tsconfig.extends` so we support `node_modules`
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#266](https://github.com/0no-co/GraphQLSP/pull/266))

## 1.5.1

### Patch Changes

- ⚠️ Fix type-condition suggestions
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#262](https://github.com/0no-co/GraphQLSP/pull/262))

## 1.5.0

### Minor Changes

- Add a bail for `fieldUsage` where we return a property from a function
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#260](https://github.com/0no-co/GraphQLSP/pull/260))

### Patch Changes

- Bubble up unused fields to their closest parent
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#258](https://github.com/0no-co/GraphQLSP/pull/258))

## 1.4.3

### Patch Changes

- Add support for alternative root directories, when your tsconfig does not define GraphQLSP we'll traverse up until we find the `extends` that does and resolve the schema from there
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#257](https://github.com/0no-co/GraphQLSP/pull/257))
- Change `setInterval` to `setTimeout`
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#255](https://github.com/0no-co/GraphQLSP/pull/255))

## 1.4.2

### Patch Changes

- ⚠️ fix case where the hover-information would target the wrong TypeScript node by one character
  Submitted by [@llllvvuu](https://github.com/llllvvuu) (See [#244](https://github.com/0no-co/GraphQLSP/pull/244))
- Update ESM build output to be written to a `.mjs` file extension rather than `.js`
  Submitted by [@kitten](https://github.com/kitten) (See [#250](https://github.com/0no-co/GraphQLSP/pull/250))

## 1.4.1

### Patch Changes

- ⚠️ Fix unused fields detection not respecting field aliases in GraphQL documents
  Submitted by [@kitten](https://github.com/kitten) (See [#238](https://github.com/0no-co/GraphQLSP/pull/238))

## 1.4.0

### Minor Changes

- Expand support of tracking field usage to more edge cases by matching a defined GraphQL document’s type against variables in-scope with said type
  Submitted by [@kitten](https://github.com/kitten) (See [#235](https://github.com/0no-co/GraphQLSP/pull/235))

### Patch Changes

- Only warn for fragments that are exported
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#230](https://github.com/0no-co/GraphQLSP/pull/230))
- ⚠️ Fix issue where a missing argument 2 for a call-expression would make us erase prior found fragment-definitions
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#233](https://github.com/0no-co/GraphQLSP/pull/233))

## 1.3.5

### Patch Changes

- Add bail for field-usage when we can't find anything
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#226](https://github.com/0no-co/GraphQLSP/pull/226))

## 1.3.4

### Patch Changes

- ⚠️ Fix offset issue when using the graphql annotation
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#217](https://github.com/0no-co/GraphQLSP/pull/217))
- Add more built-in urql directives
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#218](https://github.com/0no-co/GraphQLSP/pull/218))

## 1.3.3

### Patch Changes

- minor fix to avoid error message in the logs
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#214](https://github.com/0no-co/GraphQLSP/pull/214))

## 1.3.2

### Patch Changes

- ⚠️ fix broken positioning on unix
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#209](https://github.com/0no-co/GraphQLSP/pull/209))

## 1.3.1

### Patch Changes

- ⚠️ Fix case for call-expression where index would go out of bounds due to fragments being external to the document. In tagged-templates we resolve this by adding it in to the original text
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#207](https://github.com/0no-co/GraphQLSP/pull/207))

## 1.3.0

### Minor Changes

- Support array destructuring result lists
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#204](https://github.com/0no-co/GraphQLSP/pull/204))

## 1.2.0

### Minor Changes

- support property assignment/objectAccessPattern
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#202](https://github.com/0no-co/GraphQLSP/pull/202))

## 1.1.2

### Patch Changes

- Automatically disable Prettier and ESLint on `tadaOutputLocation` output files
  Submitted by [@kitten](https://github.com/kitten) (See [#199](https://github.com/0no-co/GraphQLSP/pull/199))

## 1.1.1

### Patch Changes

- Add `@_unmask` to known client directive list
  Submitted by [@kitten](https://github.com/kitten) (See [#197](https://github.com/0no-co/GraphQLSP/pull/197))

## 1.1.0

### Minor Changes

- Add way to provide additional reserved keys for field-usage tracking by means of the `reservedKeys` config property which accepts an array of strings
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#195](https://github.com/0no-co/GraphQLSP/pull/195))

## 1.0.7

### Patch Changes

- Avoid bailing out of the cache for identical introspections
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#193](https://github.com/0no-co/GraphQLSP/pull/193))
- Account for empty lines when asking for completions
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#191](https://github.com/0no-co/GraphQLSP/pull/191))

## 1.0.6

### Patch Changes

- Catch errors in field-usage as we have been seeing TS fail to resolve references
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#188](https://github.com/0no-co/GraphQLSP/pull/188))

## 1.0.5

### Patch Changes

- When creating a `d.ts` file, export the introspection type to make it reusable
  Submitted by [@kitten](https://github.com/kitten) (See [#184](https://github.com/0no-co/GraphQLSP/pull/184))
- Upgrade to `@urql/introspection@1.0.3`
  Submitted by [@kitten](https://github.com/kitten) (See [#185](https://github.com/0no-co/GraphQLSP/pull/185))

## 1.0.4

### Patch Changes

- When we have a query like the following

  ```graphql
  query {
    pokemon(id: 1) {
      id
      name
    }
    pokemons {
      id
      fleeRate
    }
  }
  ```

  and we perform

  ```ts
  const Pokemons = () => {
    const [result] = useQuery({
      query: PokemonQuery,
    });

    return result.data.pokemons.map(pokemon => pokemon.fleeRate);
  };
  ```

  Then it will see `pokemon` the variable inside our function closure as an
  allowed field due to `Query.pokemon` this PR fixes that by refining our search
  algorithm to only include valid built paths.
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#182](https://github.com/0no-co/GraphQLSP/pull/182))

## 1.0.3

### Patch Changes

- Stop caching diagnostics for fragment imports and field-usage as these can be controlled externally
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#174](https://github.com/0no-co/GraphQLSP/pull/174))
- Add fix for nonNullAssertion and using Array.at
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#177](https://github.com/0no-co/GraphQLSP/pull/177))

## 1.0.2

### Patch Changes

- Use `@0no-co/graphql.web` for better `visit` perf
  Submitted by [@JoviDeCroock](https://github.com/JoviDeCroock) (See [#172](https://github.com/0no-co/GraphQLSP/pull/172))

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
