---
'@0no-co/graphqlsp': minor
---

Introduce option to pre-process the introspection file, this improves the performance of `gql.tada`. This will be enabled by default and can be turned off by leveraging `tadaDisablePreprocessing: true` in the `tsconfig`
