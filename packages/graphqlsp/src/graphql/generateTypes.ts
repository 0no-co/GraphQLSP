import fs from 'fs';
import { posix as path } from 'path';
import { printSchema, parse, GraphQLSchema } from 'graphql';
import { codegen } from '@graphql-codegen/core';
import * as typescriptPlugin from '@graphql-codegen/typescript';
import * as typescriptOperationsPlugin from '@graphql-codegen/typescript-operations';
import * as typedDocumentNodePlugin from '@graphql-codegen/typed-document-node';
import * as addPlugin from '@graphql-codegen/add';

export const generateBaseTypes = async (
  schema: GraphQLSchema | null,
  outputFile: string,
  scalars: Record<string, unknown>,
  extraImports?: string
) => {
  if (!schema) return;

  const config = {
    documents: [],
    config: {
      scalars,
      avoidOptionals: false,
      enumsAsTypes: true,
      globalNamespace: true,
      nonOptionalTypename: true,
    },
    filename: outputFile,
    schema: parse(printSchema(schema)),
    plugins: [
      { typescript: {} },
      extraImports && { add: { content: extraImports } },
    ].filter(Boolean),
    pluginMap: extraImports
      ? {
          typescript: typescriptPlugin,
          add: addPlugin,
        }
      : {
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
): Promise<{ success: boolean }> => {
  try {
    if (!schema) return { success: false };

    const parts = outputFile.split('/');
    parts.pop();
    let basePath = path
      .relative(parts.join('/'), baseTypesPath)
      .replace('.ts', '');
    // case where files are declared globally, we need to prefix with ./
    if (basePath === '__generated__/baseGraphQLSP') {
      basePath = './' + basePath;
    }

    const config = {
      documents: [
        {
          location: 'operation.graphql',
          document: parse(doc),
        },
      ],
      config: {
        scalars,
        avoidOptionals: false,
        enumsAsTypes: true,
        nonOptionalTypename: true,
        namespacedImportName: 'Types',
      },
      filename: outputFile,
      schema: parse(printSchema(schema)),
      plugins: [
        { 'typescript-operations': {} },
        { 'typed-document-node': {} },
        { add: { content: `import * as Types from "${basePath}"` } },
      ],
      pluginMap: {
        'typescript-operations': typescriptOperationsPlugin,
        'typed-document-node': typedDocumentNodePlugin,
        add: addPlugin,
      },
    };

    // @ts-ignore
    const output = await codegen(config);
    fs.writeFile(path.join(outputFile), output, 'utf8', err => {
      console.error(err);
    });

    return { success: true };
  } catch (e) {
    return { success: false };
  }
};
