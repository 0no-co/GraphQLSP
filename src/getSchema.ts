import { GraphQLSchema, buildSchema } from 'graphql'
import path from 'path'
import fs from 'fs'

export const loadSchema = (root: string, schema: string): GraphQLSchema => {
  const resolvedPath = path.resolve(path.dirname(root), schema)
  const contents = fs.readFileSync(resolvedPath, 'utf-8')
  return buildSchema(contents)
}
