import ts from "typescript/lib/tsserverlibrary";
import { isTaggedTemplateExpression, isIdentifier } from 'tsutils'
import { getHoverInformation } from 'graphql-language-service'
import { GraphQLSchema } from 'graphql'
import { Cursor } from "./cursor";
import { loadSchema } from "./getSchema";
import { getToken } from "./token";
import { isNoSubstitutionTemplateLiteral } from "typescript";

function createBasicDecorator(info: ts.server.PluginCreateInfo) {
  const proxy: ts.LanguageService = Object.create(null);
  for (let k of Object.keys(info.languageService) as Array<keyof ts.LanguageService>) {
    const x = info.languageService[k]!;
    // @ts-expect-error - JS runtime trickery which is tricky to type tersely
    proxy[k] = (...args: Array<{}>) => x.apply(info.languageService, args);
  }

  return proxy;
}

function findNode(sourceFile: ts.SourceFile, position: number): ts.Node | undefined {
  function find(node: ts.Node): ts.Node | undefined {
    if (position >= node.getStart() && position < node.getEnd()) {
      return ts.forEachChild(node, find) || node;
    }
  }
  return find(sourceFile);
}


function create(info: ts.server.PluginCreateInfo) {
  const logger = (msg: string) => info.project.projectService.logger.info(`[ts-graphql-plugin] ${msg}`);
  logger('config: ' + JSON.stringify(info.config));
  if (!info.config.schema) {
    throw new Error('Please provide a GraphQL Schema!');
  }

  info.project.projectService.logger.info(
    "Setting up the GraphQL Plugin"
  );
  const tagTemplate = info.config.template || 'gql';

  const proxy = createBasicDecorator(info);
  const schema = loadSchema(info.config.schema);

  proxy.getQuickInfoAtPosition = (filename: string, cursorPosition: number) => {
    info.project.projectService.logger.info(
      "Got the schema."
    );
    const program = info.languageService.getProgram();
    if (!program) return undefined

    const source = program.getSourceFile(filename)
    if (!source) return undefined

    let node = findNode(source, cursorPosition)
    if (!node) return undefined;

    if (isNoSubstitutionTemplateLiteral(node)) {
      node = node.parent
    }

    if (isTaggedTemplateExpression(node)) {
      const { template, tag } = node;
      if (!isIdentifier(tag) || tag.text !== tagTemplate) return undefined;

      const text = template.getText().slice(1, -1)
      const foundToken = getToken(template, cursorPosition)

      if (!foundToken) return undefined

      const info = getHoverInformation(schema as GraphQLSchema, text, new Cursor(foundToken.line, foundToken.start))
      return {
        kind: ts.ScriptElementKind.string,
        textSpan: {
          start: cursorPosition,
          length: 1
        },
        kindModifiers: '',
        displayParts: Array.isArray(info) ? info.map(item => ({ kind: '', text: item })) : [{ kind: '', text: info }]
      } as ts.QuickInfo;
    } else {
      return undefined
    }
  }

  logger('proxy: ' + JSON.stringify(proxy));

  return proxy;
}

const init: ts.server.PluginModuleFactory = () => {
  return { create };
};

export = init;
