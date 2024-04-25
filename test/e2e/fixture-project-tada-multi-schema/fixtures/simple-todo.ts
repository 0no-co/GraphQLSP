import { graphql } from './todo';

// prettier-ignore
const x = graphql(`
  query Todo($id: ID!) {
    todo(id: $id) {
      id

    }
  }
`);
