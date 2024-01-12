---
'@0no-co/graphqlsp': major
---

Look for `gql` and `graphql` by default as well as change the default for call-expressions to true.

If you are using TaggedTemplateExpressions you can migrate by adding the following to your tsconfig file

```json
{
  "plugins": [
    {
      "name": "@0no-co/graphqlsp",
      "schema": "...",
      "templateIsCallExpression": false
    }
  ]
}
```
