import { initGraphQLTada } from 'gql.tada';
import type { introspection } from '../introspection';

export const graphql = initGraphQLTada<{
  introspection: introspection;
}>();

export type { FragmentOf, ResultOf, VariablesOf } from 'gql.tada';
export { readFragment, maskFragments } from 'gql.tada';
