---
'@0no-co/graphqlsp': minor
---

Surface plugin misconfiguration as editor diagnostics. When the `schema` option is missing, the schema fails to load (missing file, invalid SDL, unreachable URL), or the gql.tada typings file can't be written, an error diagnostic is now reported on the first GraphQL document of each file instead of failing silently with the error only visible in the tsserver log
