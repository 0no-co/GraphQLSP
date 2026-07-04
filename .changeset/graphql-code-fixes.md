---
'@0no-co/graphqlsp': minor
---

Add quick fixes (code actions) for GraphQLSP's own diagnostics. Misspelled fields, arguments, and types with a "Did you mean" suggestion now offer one fix per suggested replacement, deprecated fields whose deprecation reason names a replacement (for example "Use `newField` instead" or "replaced by `newField`") offer a fix that swaps in the replacement, and unused fields reported by field-usage tracking offer a fix that removes them from the document — unless the removal would leave the parent selection set empty.
