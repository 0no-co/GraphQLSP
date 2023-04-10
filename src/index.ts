import ts from "typescript/lib/tsserverlibrary";
import { isNoSubstitutionTemplateLiteral, ScriptElementKind, isIdentifier, isTaggedTemplateExpression, isToken, isTemplateExpression} from "typescript";
import { getHoverInformation, getAutocompleteSuggestions, getDiagnostics, Diagnostic } from 'graphql-language-service'
import { GraphQLSchema, parse, Kind, FragmentDefinitionNode, OperationDefinitionNode } from 'graphql'

import { Cursor } from "./cursor";
import { loadSchema } from "./getSchema";
import { getToken } from "./token";
import { findAllTaggedTemplateNodes, findNode, getSource } from "./utils";
import { resolveTemplate } from "./resolve";
import { generateTypedDocumentNodes } from "./types/generate";

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

  // TODO: we have to initialize a watcher for schema changes
  const schema = loadSchema(info.project.getProjectName(), info.config.schema);

  proxy.getProgram = (): ts.Program | undefined => {
    console.log('getProgram');
    return info.languageService.getProgram();
  };

  proxy.getSemanticDiagnostics = (filename: string): ts.Diagnostic[] => {
    const originalDiagnostics = info.languageService.getSemanticDiagnostics(filename)
    const source = getSource(info, filename)
    if (!source) return originalDiagnostics

    const nodes = findAllTaggedTemplateNodes(source)

    const texts = nodes.map(node => {
      if (isNoSubstitutionTemplateLiteral(node) || isTemplateExpression(node)) {
        if (isTaggedTemplateExpression(node.parent)) {
          node = node.parent
        } else {
          return undefined
        }
      }


      return resolveTemplate(node, filename, info)
    })

    try {
      // TODO: we might only want to run this when there are no
      // diagnostic issues.
      // TODO: we might need to issue warnings for docuemnts without an operationName
      // TODO: we will need to check for renamed operations that _do contain_ a type definition
      const parts = source.fileName.split('/');
      const name = parts[parts.length - 1];
      const nameParts = name.split('.');
      nameParts[nameParts.length - 1] = 'generated.ts'
      parts[parts.length - 1] = nameParts.join('.')
      generateTypedDocumentNodes(schema, parts.join('/'), texts.join('\n')).then(() => {
        nodes.forEach((node, i) => {
          const queryText = texts[i] || '';
          const parsed = parse(queryText);
          const isFragment = parsed.definitions.every(x => x.kind === Kind.FRAGMENT_DEFINITION);
          let name = '';
          if (isFragment) {
            const fragmentNode = parsed.definitions[0] as FragmentDefinitionNode;
            name = fragmentNode.name.value;
          } else {
            const operationNode = parsed.definitions[0] as OperationDefinitionNode;
            name = operationNode.name!.value;
          }
  
          name = name.charAt(0).toUpperCase() + name.slice(1);
          const parentChildren = node.parent.getChildren();
          if (parentChildren.find(x => x.kind === 200)) {
            return;
          }
  
          // TODO: we'll have to combine writing multiple exports when we are dealing with more than
          // one tagged template in a file
          const exportName = isFragment ? `${name}FragmentDoc` : `${name}Document`;
          const imp = ` as typeof import('./${nameParts.join('.').replace('.ts', '')}').${exportName}`;
  
          const span = { length: 1, start: node.end };
          const prefix = source.text.substring(0, span.start);
          const suffix = source.text.substring(span.start + span.length, source.text.length);
          const text = prefix + imp + suffix;
  
          const scriptInfo = info.project.projectService.getScriptInfo(filename);
          const snapshot = scriptInfo!.getSnapshot();
          const length = snapshot.getLength();
  
          source.update(text, { span, newLength: imp.length })
          scriptInfo!.editContent(0, length, text);
          info.languageServiceHost.writeFile!(source.fileName, text);
          scriptInfo!.registerFileUpdate();
        })
      });
    } catch (e) {
      console.error(e)
      throw e
    }

    const diagnostics = nodes.map(x => {
      let node = x;
      if (isNoSubstitutionTemplateLiteral(node) || isTemplateExpression(node)) {
        if (isTaggedTemplateExpression(node.parent)) {
          node = node.parent
        } else {
          return undefined
        }
      }

      const text = resolveTemplate(node, filename, info)
      const lines = text.split('\n')

      // This assumes a prefix of gql`
      let startingPosition = node.pos + 4
      return getDiagnostics(text, schema).map(x => {
        const { start, end } = x.range;

        // We add the start.line to account for newline characters which are
        // split out
        let startChar = startingPosition + start.line
        for (let i = 0; i <= start.line; i++) {
          if (i === start.line) startChar += start.character
          else startChar += lines[i].length
        }

        let endChar = startingPosition + end.line
        for (let i = 0; i <= end.line; i++) {
          if (i === end.line) endChar += end.character
          else endChar += lines[i].length
        }

        // We add 1 to the start because the range is exclusive of start.character
        return { ...x, start: startChar + 1, length: endChar - startChar }
      })
    }).flat().filter(Boolean) as Array<Diagnostic & { length: number; start: number }>

    const newDiagnostics = diagnostics.map(diag => {
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

    return [
      ...newDiagnostics,
      ...originalDiagnostics
    ]
  }

  proxy.getCompletionsAtPosition = (
    filename: string,
    cursorPosition: number,
    options: any
  ): ts.WithMetadata<ts.CompletionInfo> | undefined => {
    const originalCompletions = info.languageService.getCompletionsAtPosition(
      filename,
      cursorPosition,
      options
    ) || {
      isGlobalCompletion: false,
      isMemberCompletion: false,
      isNewIdentifierLocation: false,
      entries: [],
    }
  
    const source = getSource(info, filename)
    if (!source) return originalCompletions

    let node = findNode(source, cursorPosition)
    if (!node) return originalCompletions;

    while (isNoSubstitutionTemplateLiteral(node) || isToken(node) || isTemplateExpression(node)) {
      node = node.parent
    }

    if (isTaggedTemplateExpression(node)) {
      const { template, tag } = node;
      if (!isIdentifier(tag) || tag.text !== tagTemplate) return originalCompletions;

      const text = resolveTemplate(node, filename, info)
      const foundToken = getToken(template, cursorPosition)

      if (!foundToken) return originalCompletions

      // TODO: this does not include fragmentSpread suggestions
      const suggestions = getAutocompleteSuggestions(schema, text, new Cursor(foundToken.line, foundToken.start))

      const result: ts.WithMetadata<ts.CompletionInfo> = {
        isGlobalCompletion: false,
        isMemberCompletion: false,
        isNewIdentifierLocation: false,
        entries: [...suggestions.map(suggestion => ({
          kind: ScriptElementKind.variableElement,
          name: suggestion.label,
          kindModifiers: 'declare',
          sortText: '0',
        })), ...originalCompletions.entries],
      }
      return result
    } else {
      return originalCompletions
    }
  }

  proxy.getQuickInfoAtPosition = (filename: string, cursorPosition: number) => {
    const originalInfo = info.languageService.getQuickInfoAtPosition(
      filename,
      cursorPosition
    )
  
    const source = getSource(info, filename)
    if (!source) return originalInfo

    let node = findNode(source, cursorPosition)
    if (!node) return originalInfo;

    while (isNoSubstitutionTemplateLiteral(node) || isToken(node) || isTemplateExpression(node)) {
      node = node.parent
    }

    // TODO: visualize fragment-data
    if (isTaggedTemplateExpression(node)) {
      const { template, tag } = node;
      if (!isIdentifier(tag) || tag.text !== tagTemplate) return originalInfo;

      const text = resolveTemplate(node, filename, info)
      const foundToken = getToken(template, cursorPosition)

      if (!foundToken) return originalInfo

      const hoverInfo = getHoverInformation(schema as GraphQLSchema, text, new Cursor(foundToken.line, foundToken.start))
      const result: ts.QuickInfo = {
        kind: ts.ScriptElementKind.string,
        textSpan: {
          start: cursorPosition,
          length: 1
        },
        kindModifiers: '',
        displayParts: Array.isArray(hoverInfo) ? hoverInfo.map(item => ({ kind: '', text: item as string })) : [{ kind: '', text: hoverInfo as string }]
      };

      return result;
    } else {
      return originalInfo
    }
  }

  // to research:
  // proxy.getTypeDefinitionAtPosition
  // proxy.getCompletionEntryDetails

  logger('proxy: ' + JSON.stringify(proxy));

  return proxy;
}

const init: ts.server.PluginModuleFactory = () => {
  return { create };
};

export = init;
