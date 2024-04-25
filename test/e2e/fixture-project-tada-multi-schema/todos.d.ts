/* eslint-disable */
/* prettier-ignore */

/** An IntrospectionQuery representation of your schema.
 *
 * @remarks
 * This is an introspection of your schema saved as a file by GraphQLSP.
 * It will automatically be used by `gql.tada` to infer the types of your GraphQL documents.
 * If you need to reuse this data or update your `scalars`, update `tadaOutputLocation` to
 * instead save to a .ts instead of a .d.ts file.
 */
export type introspection = {
  name: 'todos';
  query: 'Query';
  mutation: never;
  subscription: never;
  types: {
    'Boolean': unknown;
    'ID': unknown;
    'Query': { kind: 'OBJECT'; name: 'Query'; fields: { 'todo': { name: 'todo'; type: { kind: 'OBJECT'; name: 'Todo'; ofType: null; } }; }; };
    'String': unknown;
    'Todo': { kind: 'OBJECT'; name: 'Todo'; fields: { 'completed': { name: 'completed'; type: { kind: 'NON_NULL'; name: never; ofType: { kind: 'SCALAR'; name: 'Boolean'; ofType: null; }; } }; 'id': { name: 'id'; type: { kind: 'NON_NULL'; name: never; ofType: { kind: 'SCALAR'; name: 'ID'; ofType: null; }; } }; 'text': { name: 'text'; type: { kind: 'NON_NULL'; name: never; ofType: { kind: 'SCALAR'; name: 'String'; ofType: null; }; } }; }; };
  };
};

import * as gqlTada from 'gql.tada';
