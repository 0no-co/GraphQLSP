---
'@0no-co/graphqlsp': minor
---

Add `checkProject` (`@0no-co/graphqlsp/check`), which reports GraphQLSP's diagnostics for a whole project without a language service. It runs on the TypeScript 7.1 API (`typescript@>=7.1` or `tsrs`), where language service plugins aren't loaded, and on the compiler API of TypeScript 5/6. To support this, the diagnostics now only depend on a small host interface rather than tsserver's plugin API, and identifiers are compared by their `text` instead of their `escapedText`.
