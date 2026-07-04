---
'@0no-co/graphqlsp': minor
---

Add find-references and rename support for GraphQL fragments. Placing the cursor on a fragment name — either at its definition (`fragment PokemonFields on Pokemon`) or at a spread (`...PokemonFields`) — now lists the definition and every spread of that fragment across the project's source files, and renaming from any of those locations updates all of them at once, including fragments defined in other `graphql()` calls in the same file and fragments imported from other files.
