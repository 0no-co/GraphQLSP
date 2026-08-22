---
'@0no-co/graphqlsp': minor
---

Support [fragment arguments](https://github.com/graphql/graphql-spec/pull/1081) for projects on GraphQL 17. Documents are parsed with `experimentalFragmentArguments`, and diagnostics validate the parsed document instead of letting `graphql-language-service` re-parse it without that option, so `fragment Fields($size: Int!) on Product` and `...Fields(size: $size)` no longer report a syntax error. Older GraphQL versions ignore the option and are unaffected.
