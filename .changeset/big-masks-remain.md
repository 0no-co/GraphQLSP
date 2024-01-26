---
'@0no-co/graphqlsp': patch
---

Fix case for call-expression where index would go out of bounds due to fragments being external to the document. In tagged-templates we resolve this by adding it in to the original text
