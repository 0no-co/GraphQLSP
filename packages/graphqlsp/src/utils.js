'use strict';
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, '__esModule', { value: true });
exports.getSource =
  exports.findAllTaggedTemplateNodes =
  exports.findNode =
    void 0;
const tsserverlibrary_1 = __importDefault(
  require('typescript/lib/tsserverlibrary')
);
const typescript_1 = require('typescript');
function findNode(sourceFile, position) {
  function find(node) {
    if (position >= node.getStart() && position < node.getEnd()) {
      return tsserverlibrary_1.default.forEachChild(node, find) || node;
    }
  }
  return find(sourceFile);
}
exports.findNode = findNode;
function findAllTaggedTemplateNodes(sourceFile) {
  const result = [];
  function find(node) {
    if (
      (0, typescript_1.isTaggedTemplateExpression)(node) ||
      (0, typescript_1.isNoSubstitutionTemplateLiteral)(node)
    ) {
      result.push(node);
      return;
    } else {
      tsserverlibrary_1.default.forEachChild(node, find);
    }
  }
  find(sourceFile);
  return result;
}
exports.findAllTaggedTemplateNodes = findAllTaggedTemplateNodes;
function getSource(info, filename) {
  const program = info.languageService.getProgram();
  if (!program) return undefined;
  const source = program.getSourceFile(filename);
  if (!source) return undefined;
  return source;
}
exports.getSource = getSource;
