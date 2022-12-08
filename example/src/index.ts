import { gql } from '@urql/core'
import { PokemonFields } from './fragment'

const query = gql`
  query Pokemons {
    pokemons {
      id
      name
    }
  }

  ${PokemonFields}
` as typeof import('./index.generated').PokemonsDocument
