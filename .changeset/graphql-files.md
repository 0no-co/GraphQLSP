---
'@0no-co/graphqlsp': minor
---

Support `.graphql` files through `@gql.tada/content-mapper`. When a project's `tsconfig.json` registers the content mapper under `contentMappers` (which TypeScript 7.1+ uses for `.graphql` imports, and TypeScript 5/6 ignore), GraphQLSP loads it from the project and adds `.graphql` files to the TypeScript project as their typed `gql.tada` modules. Imports of `.graphql` files are typed in the editor, and `.graphql` files get schema validation, completions, hover information, go-to-definition, and fragment references and renames, mapped back onto their original GraphQL source. GraphQL files that aren't mapped no longer show TypeScript errors when an editor sends them to the TypeScript server.
