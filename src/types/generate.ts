// import fs from 'node:fs'
// import path from 'node:path'
import { printSchema, parse, GraphQLSchema, DocumentNode } from 'graphql'
import { codegen } from '@graphql-codegen/core'
import * as typescriptPlugin from '@graphql-codegen/typescript'
import * as typescriptOperationsPlugin from '@graphql-codegen/typescript-operations'
import * as typedDocumentNodePlugin from '@graphql-codegen/typed-document-node'

export const generateTypedDocumentNodes = async (schema: GraphQLSchema, doc: string) => {
    const outputFile = 'relative/pathTo/filename.ts'
    const config = {
        documents: [
            {
                location: outputFile,
                document: parse(doc),
            },
        ],
        config: {},
        // used by a plugin internally, although the 'typescript' plugin currently
        // returns the string output, rather than writing to a file
        filename: outputFile,
        schema: parse(printSchema(schema)),
        plugins: [
            { 'typescript': {}, 'typescript-operations': {}, 'typed-document-node': {} },
            ],
        pluginMap: {
            typescript: typescriptPlugin,
            'typescript-operations': typescriptOperationsPlugin,
            'typed-document-node': typedDocumentNodePlugin
        }
    }

    const output = await codegen(config)
    console.log(output)
}
