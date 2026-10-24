---
'@0no-co/graphqlsp': patch
---

Add a `runExternalCode` option to `checkProject`, which runs a project's content mappers (like `tsc --runExternalCode`), so documents imported from content-mapped files (e.g. `.graphql` files mapped by `@gql.tada/content-mapper`) are resolved. Content-mapped files themselves aren't checked, since their mappers report their diagnostics. Also compute persisted document hashes from string literals' values rather than their source text, which failed to parse documents written with escape sequences.
