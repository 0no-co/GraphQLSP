import { initGraphQLTada } from 'gql.tada';
import type { introspection } from './introspection.js';

export const graphql = initGraphQLTada<{
  introspection: introspection;
}>();

export type { FragmentOf, ResultOf, VariablesOf } from 'gql.tada';
export { readFragment } from 'gql.tada';
