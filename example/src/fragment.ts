import { gql } from '@urql/core'

export const PokemonFields = gql`
  fragment pokemonFields on Pokemon {
    id
    name
  }
`
