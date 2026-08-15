import { initGraphQLTada } from 'gql.tada';
import type { Schema } from './schema.js';

export const graphql = initGraphQLTada<{ introspection: Schema }>();
