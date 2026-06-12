---
'@0no-co/graphqlsp': minor
---

Rewrite unused field detection as a single-pass, symbol-driven analysis. Instead of issuing a find-all-references request per binding and enumerating the lexical scope per reference, the file's AST is walked once to index identifier occurrences, and query-result bindings are resolved through `getSymbolAtLocation` against a selection-set trie. This removes the quadratic language-service calls from `getSemanticDiagnostics`, scales to files with many documents and consumers, and makes the analysis work without resolved document types.

The analysis also tracks more usage patterns, reducing false positives: values passed as function arguments (including property chains like `format(data.pokemon.weight)`), spreads and object-literal assignments now mark the affected sub-selections as used, `for...of` loop bindings are followed like array-method callbacks, and assignments (`existing = result.data.pokemon`) and conditional expressions now alias like variable declarations.
