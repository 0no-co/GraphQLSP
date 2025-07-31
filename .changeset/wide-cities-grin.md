---
'@0no-co/graphqlsp': minor
---

Improves field-usage tracking, we bail when the identifier is passed into a function, this bail is intended so we don't have to traverse the whole codebase tracing down usage.
