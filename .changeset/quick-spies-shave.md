---
'@0no-co/graphqlsp': minor
---

Reduce type-checker work in `findAllCallExpressions`. The gql.tada function detection and schema-name lookups are now memoized per callee, so ordinary calls with a string-literal first argument (e.g. `t('key')`, `it('name', fn)`) no longer trigger a type probe per call site. Fragment unrolling is deduplicated for repeated references to the same fragment, and the third argument of `findAllCallExpressions` now also accepts an options object (`{ searchExternal?: boolean; collectFragments?: boolean }`), where `collectFragments: false` skips fragment collection entirely for callers that only consume `nodes`.
