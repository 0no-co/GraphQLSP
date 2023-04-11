import { GraphQLSchema, buildSchema, buildClientSchema } from 'graphql'
import path from 'path'
import fs from 'fs'

export const loadSchema = (root: string, schema: string): { current: GraphQLSchema | null } => {
  const ref: { current: GraphQLSchema | null } = { current: null }
  const isJson = schema.endsWith('json');
  const resolvedPath = path.resolve(path.dirname(root), schema)
  const contents = fs.readFileSync(resolvedPath, 'utf-8')

  fs.watchFile(resolvedPath, () => {
    const contents = fs.readFileSync(resolvedPath, 'utf-8')
    const parsedSchema = isJson ? buildClientSchema(JSON.parse(contents)) : buildSchema(contents)
    ref.current = isJson ? buildClientSchema(JSON.parse(contents)) : buildSchema(contents)
    return ref
  })

  ref.current = isJson ? buildClientSchema(JSON.parse(contents)) : buildSchema(contents)

  return ref
}
