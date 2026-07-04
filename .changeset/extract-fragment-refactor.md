---
'@0no-co/graphqlsp': minor
---

Add an "Extract to fragment" refactor for `graphql()` call-expression documents. When you select one or more complete fields inside a document's selection set, the editor now offers an "Extract to fragment" action under the "GraphQL" refactor group, which creates a new `graphql()` fragment document (named after the fields' parent type) above the current statement, replaces the selected fields with a fragment spread, and adds the new fragment variable to the call's fragment array.
