import { createClient, gql } from '@urql/core'
import { PokemonFields } from './fragment'

// testing stuffzzzzzzzz

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
      ...pokemonFields
    }
  }

  ${PokemonFields}
` as typeof import('./index.generated').PokemonDocument

const Donkemon = gql`
  query Donkemon ($id: ID!) {
    pokemon(id: $id) {
      id
    }
  }
` as typeof import('./index.generated').DonkemonDocument
const urqlClient = createClient({
  url: '',
  exchanges: []
});

urqlClient.query(Pokemons).toPromise().then(result => {
  result.data?.pokemons;
});
