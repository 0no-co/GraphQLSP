<script setup lang="ts">
import { ref } from 'vue';
import { graphql, type ResultOf } from './graphql';

const PokemonQuery = graphql(`
  query Pok($id: ID!) {
    pokemon(id: $id) {
      id
      name
      fleeRate
    }
  }
`);

const pokemon = ref<ResultOf<typeof PokemonQuery>['pokemon']>(null);
</script>

<template>
  <li v-if="pokemon">{{ pokemon.name }}</li>
</template>
