---
'@0no-co/graphqlsp': patch
---

Treat `||` and `??` as value pass-throughs in unused-field tracking: `fn(a.b || fallback)` now marks `a.b`'s sub-selections as used, like other escapes of an access chain. `&&` keeps its guard semantics, so `a?.b && a?.b.c` retains leaf-level precision.
