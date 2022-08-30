import { gql } from '@urql/core'
import { PokemonFields } from './fragment'

const query = gql`
  query {
    pokemons {
      id
      n
    }
  }

  ${PokemonFields}
`
