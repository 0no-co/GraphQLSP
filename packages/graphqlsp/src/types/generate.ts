import fs from 'fs';
import path from 'path';
import { printSchema, parse, GraphQLSchema } from 'graphql';
import { codegen } from '@graphql-codegen/core';
import * as typescriptPlugin from '@graphql-codegen/typescript';
import * as typescriptOperationsPlugin from '@graphql-codegen/typescript-operations';
import * as typedDocumentNodePlugin from '@graphql-codegen/typed-document-node';

export const generateBaseTypes = async (
  schema: GraphQLSchema | null,
  outputFile: string,
  scalars: Record<string, unknown>
) => {
  if (!schema) return;

  const config = {
    documents: [],
    config: {
      scalars,
      // nonOptionalTypename: true,
      // avoidOptionals, worth looking into
      enumsAsTypes: true,
      globalNamespace: true,
    },
    filename: outputFile,
    schema: parse(printSchema(schema)),
    plugins: [{ typescript: {} }],
    pluginMap: {
      typescript: typescriptPlugin,
    },
  };

  // @ts-ignore
  const output = await codegen(config);
  let folderParts = outputFile.split('/');
  folderParts.pop();
  const folder = path.join(folderParts.join('/'));
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder);
  }
  fs.writeFile(path.join(outputFile), output, 'utf8', err => {
    console.error(err);
  });
};

export const generateTypedDocumentNodes = async (
  schema: GraphQLSchema | null,
  outputFile: string,
  doc: string,
  scalars: Record<string, unknown>,
  baseTypesPath: string
) => {
  if (!schema) return;

  const config = {
    documents: [
      {
        location: 'operation.graphql',
        document: parse(doc),
      },
    ],
    baseTypesPath,
    presetConfig: {
      baseTypesPath,
    },
    config: {
      scalars,
      // nonOptionalTypename: true,
      // avoidOptionals, worth looking into
      enumsAsTypes: true,
      dedupeOperationSuffix: true,
      dedupeFragments: true,
      baseTypesPath,
    },
    filename: outputFile,
    schema: parse(printSchema(schema)),
    plugins: [
      { 'typescript-operations': { baseTypesPath } },
      { 'typed-document-node': { baseTypesPath } },
    ],
    pluginMap: {
      'typescript-operations': typescriptOperationsPlugin,
      'typed-document-node': typedDocumentNodePlugin,
    },
  };

  // @ts-ignore
  const output = await codegen(config);
  fs.writeFile(path.join(outputFile), output, 'utf8', err => {
    console.error(err);
  });
};
