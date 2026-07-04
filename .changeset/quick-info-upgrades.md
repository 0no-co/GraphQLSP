---
'@0no-co/graphqlsp': minor
---

Improve hover (quick info) for GraphQL documents. Hovering a field now shows a proper signature line — `ParentType.fieldName(arg: ArgType = default): ReturnType` — in the editor's display string, with the schema description and any `@deprecated: <reason>` notice (falling back to the spec default "No longer supported") rendered as documentation, plus a `deprecated` JSDoc tag so editors can render strikethrough. Hover now also works on field and directive arguments (showing the argument's type, default value, and description), enum values, and named types such as fragment type conditions (`on Pokemon`).
