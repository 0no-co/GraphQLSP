'use strict';
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, '__esModule', { value: true });
exports.resolveTemplate = void 0;
const typescript_1 = require('typescript');
const tsserverlibrary_1 = __importDefault(
  require('typescript/lib/tsserverlibrary')
);
const utils_1 = require('./utils');
function resolveTemplate(node, filename, info) {
  let templateText = node.template.getText().slice(1, -1);
  if (
    (0, typescript_1.isNoSubstitutionTemplateLiteral)(node.template) ||
    node.template.templateSpans.length === 0
  ) {
    return templateText;
  }
  node.template.templateSpans.forEach(span => {
    if ((0, typescript_1.isIdentifier)(span.expression)) {
      const definitions = info.languageService.getDefinitionAtPosition(
        filename,
        span.expression.getStart()
      );
      if (!definitions) return;
      const def = definitions[0];
      const src = (0, utils_1.getSource)(info, def.fileName);
      if (!src) return;
      const node = (0, utils_1.findNode)(src, def.textSpan.start);
      if (!node || !node.parent) return;
      const parent = node.parent;
      if (tsserverlibrary_1.default.isVariableDeclaration(parent)) {
        if (
          parent.initializer &&
          (0, typescript_1.isTaggedTemplateExpression)(parent.initializer)
        ) {
          const text = resolveTemplate(parent.initializer, def.fileName, info);
          templateText = templateText.replace(
            '${' + span.expression.escapedText + '}',
            text
          );
        } else if (
          parent.initializer &&
          (0, typescript_1.isAsExpression)(parent.initializer) &&
          (0, typescript_1.isTaggedTemplateExpression)(
            parent.initializer.expression
          )
        ) {
          const text = resolveTemplate(
            parent.initializer.expression,
            def.fileName,
            info
          );
          templateText = templateText.replace(
            '${' + span.expression.escapedText + '}',
            text
          );
        }
      }
    }
  });
  return templateText;
}
exports.resolveTemplate = resolveTemplate;
