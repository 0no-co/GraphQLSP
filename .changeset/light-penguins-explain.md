---
'@0no-co/graphqlsp': minor
---

Add support for defining multiple indepenent schemas through a new config property called `schemas`, you can
pass a config like the following:

```json
{
  "name": "@0no-co/graphqlsp",
  "schemas": [
    {
      "name": "pokemons",
      "schema": "./pokemons.graphql",
      "tadaOutputLocation": "./pokemons-introspection.d.ts"
    },
    {
      "name": "weather",
      "schema": "./weather.graphql",
      "tadaOutputLocation": "./weather-introspection.d.ts"
    }
  ]
}
```

The LSP will depending on what `graphql()` template you use figure out what API you are reaching out to.
