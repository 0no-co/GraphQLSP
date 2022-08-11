import ts from "typescript/lib/tsserverlibrary";
import { isNoSubstitutionTemplateLiteral, ScriptElementKind, TaggedTemplateExpression, isIdentifier, isTaggedTemplateExpression} from "typescript";
import { getHoverInformation, getAutocompleteSuggestions, getDiagnostics } from 'graphql-language-service'
import { GraphQLSchema } from 'graphql'

import { Cursor } from "./cursor";
import { loadSchema } from "./getSchema";
import { getToken } from "./token";
import { findAllTaggedTemplateNodes, findNode, getSource } from "./utils";

function createBasicDecorator(info: ts.server.PluginCreateInfo) {
  const proxy: ts.LanguageService = Object.create(null);
  for (let k of Object.keys(info.languageService) as Array<keyof ts.LanguageService>) {
    const x = info.languageService[k]!;
    // @ts-expect-error - JS runtime trickery which is tricky to type tersely
    proxy[k] = (...args: Array<{}>) => x.apply(info.languageService, args);
  }

  return proxy;
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

  proxy.getSemanticDiagnostics = (filename: string): ts.Diagnostic[] => {
    const source = getSource(info, filename)
    if (!source) return []

    const nodes = findAllTaggedTemplateNodes(source)
    const diagnostics = nodes.map(x => {
      let node = x;
      if (isNoSubstitutionTemplateLiteral(node)) {
        node = node.parent
      }

      return getDiagnostics((node as TaggedTemplateExpression).template.getText().slice(1, -1), schema).map(x => ({ ...x, start: node.getStart(), length: node.getWidth() }))
    }).flat()

    return diagnostics.map(diag => {
      const result: ts.Diagnostic = {
        file: source,
        length: diag.length,
        start: diag.start,
        category: diag.severity === 2 ? ts.DiagnosticCategory.Warning : ts.DiagnosticCategory.Error,
        code: 51001,
        messageText: diag.message.split('\n')[0],
      }

      return result;
    })
  }

  proxy.getCompletionsAtPosition = (
    filename: string,
    cursorPosition: number,
  ): ts.WithMetadata<ts.CompletionInfo> | undefined => {
    const source = getSource(info, filename)
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

      const suggestions = getAutocompleteSuggestions(schema, text, new Cursor(foundToken.line, foundToken.start))

      const result: ts.WithMetadata<ts.CompletionInfo> = {
        isGlobalCompletion: false,
        isMemberCompletion: false,
        isNewIdentifierLocation: false,
        entries: suggestions.map(suggestion => ({
          kind: ScriptElementKind.variableElement,
          name: suggestion.label,
          kindModifiers: 'declare',
          sortText: '0',
        })),
      }
      return result
    } else {
      return undefined
    }
  }

  proxy.getQuickInfoAtPosition = (filename: string, cursorPosition: number) => {
    const source = getSource(info, filename)
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
      const result: ts.QuickInfo = {
        kind: ts.ScriptElementKind.string,
        textSpan: {
          start: cursorPosition,
          length: 1
        },
        kindModifiers: '',
        displayParts: Array.isArray(info) ? info.map(item => ({ kind: '', text: item as string })) : [{ kind: '', text: info as string }]
      };

      return result;
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
