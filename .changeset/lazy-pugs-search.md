---
'@0no-co/graphqlsp': patch
---

Reject call expressions whose first argument cannot start a GraphQL document (after ignored tokens, a document must begin with `{` or a definition keyword) before resolving the callee's type in call discovery. Ordinary string-argument calls — translations, test titles, event names — no longer touch the type checker at all, which speeds up scanning codebases where GraphQL files are a small fraction of all files. Note that documents passed to a gql.tada function under a non-default name are now only discovered when they start with a valid document prefix; functions matching configured `templates` names are unaffected.
