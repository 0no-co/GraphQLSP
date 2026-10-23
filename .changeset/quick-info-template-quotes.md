---
'@0no-co/graphqlsp': patch
---

Fix hover information for `graphql()` documents that start on the same line as their opening quote. The document text was passed to the hover lookup with its quotes, which shifted the cursor on the first line and broke hovers in documents starting with `fragment`.
