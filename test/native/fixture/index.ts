import { graphql } from './graphql.js';
import type { ResultOf } from 'gql.tada';

const staticFields = 'id text' as const;

export const Todos = graphql(`
  query Todos {
    todos {
      ${staticFields}
    }
  }
`);

export type TodosResult = ResultOf<typeof Todos>;
export const validResult: TodosResult = {
  todos: [{ id: '1', text: 'native' }],
};

export const Invalid = graphql(`
  query Invalid {
    todos {
      ${staticFields}
      unknownField
    }
  }
`);

declare const dynamicFields: string;
export const Dynamic = graphql(`
  query Dynamic {
    todos {
      ${dynamicFields}
    }
  }
`);
