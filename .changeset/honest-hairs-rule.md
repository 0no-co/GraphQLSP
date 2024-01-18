---
"@0no-co/graphqlsp": patch
---

When we have a query like the following

```graphql
query {
  pokemon(id: 1) { id name }
  pokemons { id fleeRate }
}
```

and we perform

```ts
const Pokemons = () => {
  const [result] = useQuery({
    query: PokemonQuery,
  });
  

  return result.data.pokemons.map(pokemon => pokemon.fleeRate)
}
```

Then it will see `pokemon` the variable inside our function closure as an
allowed field due to `Query.pokemon` this PR fixes that by refining our search
algorithm to only include valid built paths.
