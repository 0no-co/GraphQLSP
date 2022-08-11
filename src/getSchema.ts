import { GraphQLSchema } from 'graphql'
import { loadSchemaSync } from '@graphql-tools/load'
import { UrlLoader } from '@graphql-tools/url-loader'
import { JsonFileLoader } from '@graphql-tools/json-file-loader'
import { GraphQLFileLoader } from '@graphql-tools/graphql-file-loader'

export const loadSchema = (schema: string): GraphQLSchema => {
  return loadSchemaSync(schema, {
    loaders: [
      new JsonFileLoader(),
      new GraphQLFileLoader(),
      new UrlLoader()
    ]
  })
}
