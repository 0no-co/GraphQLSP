---
'@0no-co/graphqlsp': minor
---

Support TypeScript 5.9 expandable hovers (quick info verbosity) for GraphQL symbols. When an editor requests a higher `verbosityLevel`, the hover is expanded to include the full definition of the hovered field's return type (or named type, argument input type, variable type), recursing into referenced object/interface/union/input/enum types up to a depth cap. Level 0 behaviour is unchanged, and `canIncreaseVerbosityLevel` is reported so clients know when `+`/`-` controls are meaningful.
