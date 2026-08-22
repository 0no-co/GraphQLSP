---
'@0no-co/graphqlsp': patch
---

Fix intermittent `ENOENT: no such file or directory, unlink '<output>.d.ts.tmp'` failures when multiple plugin instances write the same `tadaOutputLocation`, e.g. several TS projects in a monorepo extending a shared tsconfig. The typings swap-file now has a unique name per process and write, so concurrent regenerations no longer clobber each other's swap-files, and swap-file cleanup no longer masks the original write error.
