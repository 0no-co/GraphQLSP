export type Schema = {
  __schema: {
    queryType: { name: 'Query' };
    mutationType: null;
    subscriptionType: null;
    types: [
      {
        kind: 'OBJECT';
        name: 'Query';
        fields: [
          {
            name: 'todos';
            args: [];
            type: {
              kind: 'LIST';
              name: null;
              ofType: { kind: 'OBJECT'; name: 'Todo'; ofType: null };
            };
          },
        ];
        inputFields: null;
        interfaces: [];
        enumValues: null;
        possibleTypes: null;
      },
      {
        kind: 'OBJECT';
        name: 'Todo';
        fields: [
          {
            name: 'id';
            args: [];
            type: {
              kind: 'NON_NULL';
              name: null;
              ofType: { kind: 'SCALAR'; name: 'ID'; ofType: null };
            };
          },
          {
            name: 'text';
            args: [];
            type: {
              kind: 'NON_NULL';
              name: null;
              ofType: { kind: 'SCALAR'; name: 'String'; ofType: null };
            };
          },
        ];
        inputFields: null;
        interfaces: [];
        enumValues: null;
        possibleTypes: null;
      },
      {
        kind: 'SCALAR';
        name: 'ID';
        fields: null;
        inputFields: null;
        interfaces: null;
        enumValues: null;
        possibleTypes: null;
      },
      {
        kind: 'SCALAR';
        name: 'String';
        fields: null;
        inputFields: null;
        interfaces: null;
        enumValues: null;
        possibleTypes: null;
      },
    ];
  };
};
