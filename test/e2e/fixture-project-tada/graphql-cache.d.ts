/* eslint-disable */
/* prettier-ignore */
import type { TadaDocumentNode } from 'gql.tada';

declare module 'gql.tada' {
  interface setupCache {
    '\n  query DefinitionQuery($id: ID!) {\n    pokemon(id: $id) {\n      id\n      name\n      weight {\n        minimum\n        maximum\n      }\n    }\n  }\n': TadaDocumentNode<
      {
        pokemon: {
          id: string;
          name: string;
          weight: {
            minimum: string;
            maximum: string;
          };
        } | null;
      },
      { id: string },
      void
    >;
  }
}
