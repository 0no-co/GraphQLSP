import { gql } from '@urql/core'
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
`