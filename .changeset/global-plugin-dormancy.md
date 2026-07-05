---
'@0no-co/graphqlsp': minor
---

Support being loaded as a "global" tsserver plugin, as contributed by editor extensions. When loaded globally without any `schema`/`schemas` configuration the plugin now passes the language service through untouched, instead of reporting configuration errors in projects that never set up GraphQLSP.
