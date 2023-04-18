import ts from 'typescript/lib/tsserverlibrary';
import {
  isNoSubstitutionTemplateLiteral,
  ScriptElementKind,
  isIdentifier,
  isTaggedTemplateExpression,
  isToken,
  isTemplateExpression,
  isImportTypeNode,
  ImportTypeNode,
  CompletionEntry,
} from 'typescript';
import {
  getHoverInformation,
  getAutocompleteSuggestions,
  getDiagnostics,
  Diagnostic,
  getTokenAtPosition,
  getTypeInfo,
} from 'graphql-language-service';
import {
  parse,
  Kind,
  FragmentDefinitionNode,
  OperationDefinitionNode,
} from 'graphql';

import { Cursor } from './cursor';
import { loadSchema } from './getSchema';
import { getToken } from './token';
import {
  findAllTaggedTemplateNodes,
  findNode,
  getSource,
  getSuggestionsForFragmentSpread,
  isFileDirty,
} from './utils';
import { resolveTemplate } from './resolve';
import { generateTypedDocumentNodes } from './types/generate';

function createBasicDecorator(info: ts.server.PluginCreateInfo) {
  const proxy: ts.LanguageService = Object.create(null);
  for (let k of Object.keys(info.languageService) as Array<
    keyof ts.LanguageService
  >) {
    const x = info.languageService[k]!;
    // @ts-expect-error - JS runtime trickery which is tricky to type tersely
    proxy[k] = (...args: Array<{}>) => x.apply(info.languageService, args);
  }

  return proxy;
}

export type Logger = (msg: string) => void;

function create(info: ts.server.PluginCreateInfo) {
  const logger: Logger = (msg: string) =>
    info.project.projectService.logger.info(`[GraphQLSP] ${msg}`);
  logger('config: ' + JSON.stringify(info.config));
  if (!info.config.schema) {
    throw new Error('Please provide a GraphQL Schema!');
  }

  logger('Setting up the GraphQL Plugin');

  const tagTemplate = info.config.template || 'gql';
  const scalars = info.config.scalars || {};

  const proxy = createBasicDecorator(info);

  const baseTypesPath =
    info.project.getCurrentDirectory() + '/__generated__/baseGraphQLSP.ts';
  const schema = loadSchema(
    info.project.getProjectName(),
    info.config.schema,
    logger,
    baseTypesPath,
    scalars
  );

  proxy.getSemanticDiagnostics = (filename: string): ts.Diagnostic[] => {
    const originalDiagnostics =
      info.languageService.getSemanticDiagnostics(filename);
    const source = getSource(info, filename);
    if (!source) return originalDiagnostics;

    const nodes = findAllTaggedTemplateNodes(source);

    const texts = nodes.map(node => {
      if (isNoSubstitutionTemplateLiteral(node) || isTemplateExpression(node)) {
        if (isTaggedTemplateExpression(node.parent)) {
          node = node.parent;
        } else {
          return undefined;
        }
      }

      return resolveTemplate(node, filename, info);
    });

    const diagnostics = nodes
      .map(x => {
        let node = x;
        if (
          isNoSubstitutionTemplateLiteral(node) ||
          isTemplateExpression(node)
        ) {
          if (isTaggedTemplateExpression(node.parent)) {
            node = node.parent;
          } else {
            return undefined;
          }
        }

        const text = resolveTemplate(node, filename, info);
        const lines = text.split('\n');

        let startingPosition = node.pos + (tagTemplate.length + 1);
        const graphQLDiagnostics = getDiagnostics(text, schema.current).map(
          x => {
            const { start, end } = x.range;

            // We add the start.line to account for newline characters which are
            // split out
            let startChar = startingPosition + start.line;
            for (let i = 0; i <= start.line; i++) {
              if (i === start.line) startChar += start.character;
              else startChar += lines[i].length;
            }

            let endChar = startingPosition + end.line;
            for (let i = 0; i <= end.line; i++) {
              if (i === end.line) endChar += end.character;
              else endChar += lines[i].length;
            }

            // We add 1 to the start because the range is exclusive of start.character
            return { ...x, start: startChar + 1, length: endChar - startChar };
          }
        );

        const parsed = parse(text);

        if (
          parsed.definitions.some(x => x.kind === Kind.OPERATION_DEFINITION)
        ) {
          const op = parsed.definitions.find(
            x => x.kind === Kind.OPERATION_DEFINITION
          ) as OperationDefinitionNode;
          if (!op.name) {
            graphQLDiagnostics.push({
              message: 'Operation needs a name for types to be generated.',
              start: node.pos,
              length: x.getText().length,
              range: {} as any,
              severity: 2,
            } as any);
          }
        }

        return graphQLDiagnostics;
      })
      .flat()
      .filter(Boolean) as Array<Diagnostic & { length: number; start: number }>;

    const newDiagnostics = diagnostics.map(diag => {
      const result: ts.Diagnostic = {
        file: source,
        length: diag.length,
        start: diag.start,
        category:
          diag.severity === 2
            ? ts.DiagnosticCategory.Warning
            : ts.DiagnosticCategory.Error,
        code: 51001,
        messageText: diag.message.split('\n')[0],
      };

      return result;
    });

    if (!newDiagnostics.length) {
      try {
        const parts = source.fileName.split('/');
        const name = parts[parts.length - 1];
        const nameParts = name.split('.');
        nameParts[nameParts.length - 1] = 'generated.ts';
        parts[parts.length - 1] = nameParts.join('.');

        if (isFileDirty(filename, source)) {
          return [...newDiagnostics, ...originalDiagnostics];
        }

        generateTypedDocumentNodes(
          schema.current,
          parts.join('/'),
          texts.join('\n'),
          scalars,
          baseTypesPath
        ).then(() => {
          if (isFileDirty(filename, source)) {
            return;
          }

          nodes.forEach((node, i) => {
            const queryText = texts[i] || '';
            const parsed = parse(queryText);
            const isFragment = parsed.definitions.every(
              x => x.kind === Kind.FRAGMENT_DEFINITION
            );
            let name = '';

            if (isFragment) {
              const fragmentNode = parsed
                .definitions[0] as FragmentDefinitionNode;
              name = fragmentNode.name.value;
            } else {
              const operationNode = parsed
                .definitions[0] as OperationDefinitionNode;
              name = operationNode.name?.value || '';
            }

            if (!name) return;

            name = name.charAt(0).toUpperCase() + name.slice(1);
            const parentChildren = node.parent.getChildren();

            const exportName = isFragment
              ? `${name}FragmentDoc`
              : `${name}Document`;
            let imp = ` as typeof import('./${nameParts
              .join('.')
              .replace('.ts', '')}').${exportName}`;

            // This checks whether one of the children is an import-type
            // which is a short-circuit if there is no as
            const typeImport = parentChildren.find(x =>
              isImportTypeNode(x)
            ) as ImportTypeNode;

            if (typeImport && typeImport.getText().includes(exportName)) return;

            const span = { length: 1, start: node.end };

            let text = '';
            if (typeImport) {
              // We only want the oldExportName here to be present
              // that way we can diff its length vs the new one
              const oldExportName = typeImport
                .getText()
                .split('.')
                .pop()

              // Remove ` as ` from the beginning,
              // this because getText() gives us everything
              // but ` as ` meaning we need to keep that part
              // around.
              imp = imp.slice(4);
              text = source.text.replace(typeImport.getText(), imp);
              span.length = imp.length + ((oldExportName || '').length - exportName.length);
            } else {
              text =
                source.text.substring(0, span.start) +
                imp +
                source.text.substring(
                  span.start + span.length,
                  source.text.length
                );
            }

            const scriptInfo =
              info.project.projectService.getScriptInfo(filename);
            const snapshot = scriptInfo!.getSnapshot();

            // TODO: potential optimisation is to write only one script-update
            source.update(text, { span, newLength: imp.length });
            scriptInfo!.editContent(0, snapshot.getLength(), text);
            info.languageServiceHost.writeFile!(source.fileName, text);
            if (!!typeImport) {
              // To update the types, otherwise data is stale
              scriptInfo!.reloadFromFile();
            }
            scriptInfo!.registerFileUpdate();
            // script info contains a lot of utils that might come in handy here
            // to save even if the user has local changes, if we could make that work
            // that would be a win. If not we should check if we can figure it out through
            // the script-info whether there are unsaved changes and not run this
            // scriptInfo!.open(text);
          });
        });
      } catch (e) {}
    }

    return [...newDiagnostics, ...originalDiagnostics];
  };

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
    };

    const source = getSource(info, filename);
    if (!source) return originalCompletions;

    let node = findNode(source, cursorPosition);
    if (!node) return originalCompletions;

    while (
      isNoSubstitutionTemplateLiteral(node) ||
      isToken(node) ||
      isTemplateExpression(node)
    ) {
      node = node.parent;
    }

    if (isTaggedTemplateExpression(node)) {
      const { template, tag } = node;
      if (!isIdentifier(tag) || tag.text !== tagTemplate)
        return originalCompletions;

      const text = resolveTemplate(node, filename, info);
      const foundToken = getToken(template, cursorPosition);

      if (!foundToken || !schema.current) return originalCompletions;

      let fragments: Array<FragmentDefinitionNode> = [];
      try {
        const parsed = parse(text);
        fragments = parsed.definitions.filter(
          x => x.kind === Kind.FRAGMENT_DEFINITION
        ) as Array<FragmentDefinitionNode>;
      } catch (e) {}

      const cursor = new Cursor(foundToken.line, foundToken.start);
      const suggestions = getAutocompleteSuggestions(
        schema.current,
        text,
        cursor
      );

      const token = getTokenAtPosition(text, cursor);
      const spreadSuggestions = getSuggestionsForFragmentSpread(
        token,
        getTypeInfo(schema.current, token.state),
        schema.current,
        text,
        fragments
      );

      const result: ts.WithMetadata<ts.CompletionInfo> = {
        isGlobalCompletion: false,
        isMemberCompletion: false,
        isNewIdentifierLocation: false,
        entries: [
          ...suggestions.map(suggestion => ({
            ...suggestion,
            kind: ScriptElementKind.variableElement,
            name: suggestion.label,
            kindModifiers: 'declare',
            sortText: suggestion.sortText || '0',
            labelDetails: {
              detail: suggestion.type
                ? ' ' + suggestion.type?.toString()
                : undefined,
              description: suggestion.documentation,
            },
          })),
          ...spreadSuggestions.map(suggestion => ({
            ...suggestion,
            kind: ScriptElementKind.variableElement,
            name: suggestion.label,
            insertText: '...' + suggestion.label,
            kindModifiers: 'declare',
            sortText: '0',
            labelDetails: {
              description: suggestion.documentation,
            },
          })),
          ...originalCompletions.entries,
        ],
      };
      return result;
    } else {
      return originalCompletions;
    }
  };

  proxy.getQuickInfoAtPosition = (filename: string, cursorPosition: number) => {
    const originalInfo = info.languageService.getQuickInfoAtPosition(
      filename,
      cursorPosition
    );

    const source = getSource(info, filename);
    if (!source) return originalInfo;

    let node = findNode(source, cursorPosition);
    if (!node) return originalInfo;

    while (
      isNoSubstitutionTemplateLiteral(node) ||
      isToken(node) ||
      isTemplateExpression(node)
    ) {
      node = node.parent;
    }

    if (isTaggedTemplateExpression(node)) {
      const { template, tag } = node;
      if (!isIdentifier(tag) || tag.text !== tagTemplate) return originalInfo;

      const text = resolveTemplate(node, filename, info);
      const foundToken = getToken(template, cursorPosition);

      if (!foundToken || !schema.current) return originalInfo;

      const hoverInfo = getHoverInformation(
        schema.current,
        text,
        new Cursor(foundToken.line, foundToken.start)
      );
      const result: ts.QuickInfo = {
        kind: ts.ScriptElementKind.string,
        textSpan: {
          start: cursorPosition,
          length: 1,
        },
        kindModifiers: '',
        displayParts: Array.isArray(hoverInfo)
          ? hoverInfo.map(item => ({ kind: '', text: item as string }))
          : [{ kind: '', text: hoverInfo as string }],
      };

      return result;
    } else {
      return originalInfo;
    }
  };

  logger('proxy: ' + JSON.stringify(proxy));

  return proxy;
}

const init: ts.server.PluginModuleFactory = () => {
  return { create };
};

export default init;
