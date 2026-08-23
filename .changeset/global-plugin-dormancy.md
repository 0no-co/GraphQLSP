---
'@0no-co/graphqlsp': minor
---

Support being loaded as a "global" tsserver plugin, as contributed by editor extensions, with project configuration taking precedence over editor settings. An editor-contributed instance now defers to a live project-local instance (including `gql.tada/ts-plugin`, detected through a shared marker on the language service), adopts the project's tsconfig `plugins` entry when the plugin package isn't installed locally, falls back to editor settings passed through `configurePlugin`, and otherwise stays dormant instead of reporting configuration errors in projects that never set up GraphQLSP.
