---
'@0no-co/graphqlsp': minor
---

Bump `@gql.tada/internal` to `^1.3.0` so the generated `graphql-env.d.ts` output includes field arguments. This is required for argument inference in `gql.tada/addons/graphcache`, and ensures existing installs pick up the new introspection output when upgrading GraphQLSP.
