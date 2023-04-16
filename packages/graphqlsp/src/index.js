'use strict';
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
const tsserverlibrary_1 = __importDefault(
  require('typescript/lib/tsserverlibrary')
);
const typescript_1 = require('typescript');
const graphql_language_service_1 = require('graphql-language-service');
const graphql_1 = require('graphql');
const fs_1 = __importDefault(require('fs'));
const cursor_1 = require('./cursor');
const getSchema_1 = require('./getSchema');
const token_1 = require('./token');
const utils_1 = require('./utils');
const resolve_1 = require('./resolve');
const generate_1 = require('./types/generate');
function createBasicDecorator(info) {
  const proxy = Object.create(null);
  for (let k of Object.keys(info.languageService)) {
    const x = info.languageService[k];
    // @ts-expect-error - JS runtime trickery which is tricky to type tersely
    proxy[k] = (...args) => x.apply(info.languageService, args);
  }
  return proxy;
}
function create(info) {
  const logger = msg =>
    info.project.projectService.logger.info(`[ts-graphql-plugin] ${msg}`);
  logger('config: ' + JSON.stringify(info.config));
  if (!info.config.schema) {
    throw new Error('Please provide a GraphQL Schema!');
  }
  info.project.projectService.logger.info('Setting up the GraphQL Plugin');
  const tagTemplate = info.config.template || 'gql';
  const basePath = info.project.getCurrentDirectory() + '/__generated/base.ts';
  const proxy = createBasicDecorator(info);
  // TODO: check out interesting stuff on ts.factory
  const schema = (0, getSchema_1.loadSchema)(
    info.project.getProjectName(),
    info.config.schema
  );
  (0, generate_1.generateBaseTypes)(schema.current, basePath);
  proxy.getSemanticDiagnostics = filename => {
    const originalDiagnostics =
      info.languageService.getSemanticDiagnostics(filename);
    const source = (0, utils_1.getSource)(info, filename);
    if (!source) return originalDiagnostics;
    const nodes = (0, utils_1.findAllTaggedTemplateNodes)(source);
    const texts = nodes.map(node => {
      if (
        (0, typescript_1.isNoSubstitutionTemplateLiteral)(node) ||
        (0, typescript_1.isTemplateExpression)(node)
      ) {
        if ((0, typescript_1.isTaggedTemplateExpression)(node.parent)) {
          node = node.parent;
        } else {
          return undefined;
        }
      }
      return (0, resolve_1.resolveTemplate)(node, filename, info);
    });
    const diagnostics = nodes
      .map(x => {
        let node = x;
        if (
          (0, typescript_1.isNoSubstitutionTemplateLiteral)(node) ||
          (0, typescript_1.isTemplateExpression)(node)
        ) {
          if ((0, typescript_1.isTaggedTemplateExpression)(node.parent)) {
            node = node.parent;
          } else {
            return undefined;
          }
        }
        const text = (0, resolve_1.resolveTemplate)(node, filename, info);
        const lines = text.split('\n');
        let startingPosition = node.pos + (tagTemplate.length + 1);
        return (0, graphql_language_service_1.getDiagnostics)(
          text,
          schema.current
        ).map(x => {
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
          return Object.assign(Object.assign({}, x), {
            start: startChar + 1,
            length: endChar - startChar,
          });
        });
      })
      .flat()
      .filter(Boolean);
    const newDiagnostics = diagnostics.map(diag => {
      const result = {
        file: source,
        length: diag.length,
        start: diag.start,
        category:
          diag.severity === 2
            ? tsserverlibrary_1.default.DiagnosticCategory.Warning
            : tsserverlibrary_1.default.DiagnosticCategory.Error,
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
        const contents = fs_1.default.readFileSync(filename, 'utf-8');
        const currentText = source.getFullText();
        if (contents !== currentText) {
          return [...newDiagnostics, ...originalDiagnostics];
        }
        (0, generate_1.generateTypedDocumentNodes)(
          schema.current,
          parts.join('/'),
          texts.join('\n'),
          basePath
        ).then(() => {
          nodes.forEach((node, i) => {
            var _a;
            const queryText = texts[i] || '';
            const parsed = (0, graphql_1.parse)(queryText);
            const isFragment = parsed.definitions.every(
              x => x.kind === graphql_1.Kind.FRAGMENT_DEFINITION
            );
            let name = '';
            if (isFragment) {
              const fragmentNode = parsed.definitions[0];
              name = fragmentNode.name.value;
            } else {
              const operationNode = parsed.definitions[0];
              name =
                ((_a = operationNode.name) === null || _a === void 0
                  ? void 0
                  : _a.value) || '';
            }
            if (!name) return;
            name = name.charAt(0).toUpperCase() + name.slice(1);
            const parentChildren = node.parent.getChildren();
            const exportName = isFragment
              ? `${name}FragmentDoc`
              : `${name}Document`;
            const imp = ` as typeof import('./${nameParts
              .join('.')
              .replace('.ts', '')}').${exportName}`;
            // This checks whether one of the children is an import-type
            // which is a short-circuit if there is no as
            const typeImport = parentChildren.find(x =>
              (0, typescript_1.isImportTypeNode)(x)
            );
            if (typeImport && typeImport.getText().includes(exportName)) return;
            const span = { length: 1, start: node.end };
            const text =
              source.text.substring(0, span.start) +
              imp +
              source.text.substring(
                span.start + span.length,
                source.text.length
              );
            const scriptInfo =
              info.project.projectService.getScriptInfo(filename);
            const snapshot = scriptInfo.getSnapshot();
            // TODO: potential optimisation is to write only one script-update
            source.update(text, { span, newLength: imp.length });
            scriptInfo.editContent(0, snapshot.getLength(), text);
            info.languageServiceHost.writeFile(source.fileName, text);
            scriptInfo.registerFileUpdate();
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
  proxy.getCompletionsAtPosition = (filename, cursorPosition, options) => {
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
    const source = (0, utils_1.getSource)(info, filename);
    if (!source) return originalCompletions;
    let node = (0, utils_1.findNode)(source, cursorPosition);
    if (!node) return originalCompletions;
    while (
      (0, typescript_1.isNoSubstitutionTemplateLiteral)(node) ||
      (0, typescript_1.isToken)(node) ||
      (0, typescript_1.isTemplateExpression)(node)
    ) {
      node = node.parent;
    }
    if ((0, typescript_1.isTaggedTemplateExpression)(node)) {
      const { template, tag } = node;
      if (!(0, typescript_1.isIdentifier)(tag) || tag.text !== tagTemplate)
        return originalCompletions;
      const text = (0, resolve_1.resolveTemplate)(node, filename, info);
      const foundToken = (0, token_1.getToken)(template, cursorPosition);
      if (!foundToken || !schema.current) return originalCompletions;
      const suggestions = (0,
      graphql_language_service_1.getAutocompleteSuggestions)(
        schema.current,
        text,
        new cursor_1.Cursor(foundToken.line, foundToken.start)
      );
      const parsed = (0, graphql_1.parse)(text);
      const fragments = parsed.definitions.filter(
        x => x.kind === graphql_1.Kind.FRAGMENT_DEFINITION
      );
      const result = {
        isGlobalCompletion: false,
        isMemberCompletion: false,
        isNewIdentifierLocation: false,
        // TODO: check whether we can add descriptions to the entries
        entries: [
          ...suggestions.map(suggestion => ({
            kind: typescript_1.ScriptElementKind.variableElement,
            name: suggestion.label,
            kindModifiers: 'declare',
            sortText: suggestion.sortText || '0',
          })),
          ...fragments.map(fragment => ({
            kind: typescript_1.ScriptElementKind.variableElement,
            name: fragment.name.value,
            insertText: '...' + fragment.name.value,
            kindModifiers: 'declare',
            sortText: '0',
          })),
          ...originalCompletions.entries,
        ],
      };
      return result;
    } else {
      return originalCompletions;
    }
  };
  proxy.getQuickInfoAtPosition = (filename, cursorPosition) => {
    const originalInfo = info.languageService.getQuickInfoAtPosition(
      filename,
      cursorPosition
    );
    const source = (0, utils_1.getSource)(info, filename);
    if (!source) return originalInfo;
    let node = (0, utils_1.findNode)(source, cursorPosition);
    if (!node) return originalInfo;
    while (
      (0, typescript_1.isNoSubstitutionTemplateLiteral)(node) ||
      (0, typescript_1.isToken)(node) ||
      (0, typescript_1.isTemplateExpression)(node)
    ) {
      node = node.parent;
    }
    if ((0, typescript_1.isTaggedTemplateExpression)(node)) {
      const { template, tag } = node;
      if (!(0, typescript_1.isIdentifier)(tag) || tag.text !== tagTemplate)
        return originalInfo;
      const text = (0, resolve_1.resolveTemplate)(node, filename, info);
      const foundToken = (0, token_1.getToken)(template, cursorPosition);
      if (!foundToken || !schema.current) return originalInfo;
      const hoverInfo = (0, graphql_language_service_1.getHoverInformation)(
        schema.current,
        text,
        new cursor_1.Cursor(foundToken.line, foundToken.start)
      );
      const result = {
        kind: tsserverlibrary_1.default.ScriptElementKind.string,
        textSpan: {
          start: cursorPosition,
          length: 1,
        },
        kindModifiers: '',
        displayParts: Array.isArray(hoverInfo)
          ? hoverInfo.map(item => ({ kind: '', text: item }))
          : [{ kind: '', text: hoverInfo }],
      };
      return result;
    } else {
      return originalInfo;
    }
  };
  logger('proxy: ' + JSON.stringify(proxy));
  return proxy;
}
const init = () => {
  return { create };
};
module.exports = init;
