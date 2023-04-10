import { createClient, gql } from '@urql/core'
import { PokemonFields } from './fragment'

const Pokemons = gql`
  query Pokemons {
    pokemons {
      id
      name
    }
  }

  ${PokemonFields}
` as typeof import('./index.generated').PokemonsDocument

const Pokemon = gql`
  query Pokemon {
    pokemon(id: "1") {
      id
      name
    }
  }

  ${PokemonFields}
` as typeof import('./index.generated').PokemonDocument

const urqlClient = createClient({
  url: 'http://localhost:3000/api'
});

urqlClient.query(Pokemons).toPromise().then(result => {
  result.data?.pokemons;
});
