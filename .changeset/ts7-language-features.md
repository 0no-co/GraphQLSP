---
'@0no-co/graphqlsp': minor
---

Expose hover, completion, schema definitions, fragment references and rename, quick fixes, and fragment extraction through TypeScript 7.1 language-server API sessions. Add the `graphqlsp --stdio` LSP proxy for other editors, and support the synchronous API relay on Windows using .NET Framework 4.x.

Preserve native TypeScript capabilities, keep GraphQL completion resolution local, reject stale cross-file edits, recover local schemas after deletion/recreation, and await named schemas before the first feature request. The VS Code integration also disposes native providers when switching back to classic TypeScript or resetting native enablement.

Drain API workers during shutdown and bound the native TS 7.1 cleanup hang with a documented two-second fallback that terminates the native child before acknowledging proxy shutdown. Document npm-only LSP setup, VS Code activation, standalone checks, session methods, configuration boundaries, platform requirements, and reproducible editor validation.
