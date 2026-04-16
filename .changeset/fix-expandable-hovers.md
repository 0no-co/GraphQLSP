---
'@0no-co/graphqlsp': patch
---

Forward all arguments from the `getQuickInfoAtPosition` proxy to the underlying TypeScript language service, so that the `verbosityLevel` argument (added in TypeScript 5.9 for expandable hovers) is no longer stripped when GraphQLSP delegates back to TypeScript.
