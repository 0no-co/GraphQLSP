---
'@0no-co/graphqlsp': minor
---

Add a `message` diagnostic when we see an import from a file that has `fragment` exports we'll warn you when they are not imported, this because of the assumption that to use this file one would have to adhere to the data requirements of said file.
You can choose to disable this setting by setting `shouldCheckForColocatedFragments` to `false`
