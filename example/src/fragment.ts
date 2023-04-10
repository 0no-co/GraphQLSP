import { gql } from '@urql/core'

export const PokemonFields = gql`
  fragment pokemonFields on Pokemon {
    id
    name
  }
` as typeof import('./fragment.generated').PokemonFieldsFragmentDoc
// TODO: how to type
// export const PokemonFields = gql`
//   fragment pokemonFields on Pokemon {
//     id
//     name
//   }

//   fragment morePokemonFields on Pokemon {
//     id
//     name
//   }
// ` as typeof import('./fragment.generated').PokemonsDocument