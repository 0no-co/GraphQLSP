---
'@0no-co/graphqlsp': patch
---

Add support for alternative root directories, when your tsconfig does not define GraphQLSP we'll traverse up until we find the `extends` that does and resolve the schema from there
