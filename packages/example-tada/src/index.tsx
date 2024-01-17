import { createClient, useQuery } from 'urql';
import { graphql } from './graphql';
import { Pokemon, PokemonFields } from './Pokemon';

const PokemonQuery = graphql(`
  query Po($id: ID!) {
    pokemon(id: $id) {
      id
      fleeRate
      ...pokemonFields
      attacks {
        special {
          name
          damage
        }
      }
      weight {
        minimum
        maximum
      }
      name
      __typename
    }
    pokemons {
      name
      maxCP
      maxHP
    }
  }
`, [PokemonFields]);

const Pokemons = () => {
  const [result] = useQuery({
    query: PokemonQuery,
    variables: { id: '' }
  });
  
  const selected = result.data?.pokemons?.at(0)!
  console.log(result.data?.pokemons?.at(0)?.maxCP)
  console.log(selected.maxHP)
  const names = result.data?.pokemons?.map(x => x?.name)
  console.log(names)
  
  // Works
  console.log(result.data?.pokemon?.attacks && result.data?.pokemon?.attacks.special && result.data?.pokemon?.attacks.special[0] && result.data?.pokemon?.attacks.special[0].name)

  // Works
  const { fleeRate } = result.data?.pokemon || {};
  console.log(fleeRate)
  // Works
  const po = result.data?.pokemon;

  // @ts-expect-error
  const { pokemon: { weight: { minimum } } } = result.data || {};
  console.log(po?.name, minimum)

  // Works
  const { pokemon } = result.data || {};
  console.log(pokemon?.weight?.maximum)

  return <Pokemon data={result.data!.pokemon} />;
}
