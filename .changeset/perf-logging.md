---
'@0no-co/graphqlsp': minor
---

Add an opt-in `logPerformance` configuration option. When enabled, GraphQLSP logs a timing entry to the TypeScript server log (e.g. `[GraphQLSP] perf: getSemanticDiagnostics 12.3ms <file>`) for every operation it performs — diagnostics, completions, quick-info, go-to-definition, refactors, and schema loads — making it possible to produce actionable data when investigating slow editor feedback. The option is off by default and adds no overhead when disabled.
