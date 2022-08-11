import { gql } from '@urql/core'

const query = gql`
  query {
    pokemons {
      id
    }
  }
`
