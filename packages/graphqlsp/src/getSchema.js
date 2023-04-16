'use strict';
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, '__esModule', { value: true });
exports.loadSchema = void 0;
const graphql_1 = require('graphql');
const path_1 = __importDefault(require('path'));
const fs_1 = __importDefault(require('fs'));
const loadSchema = (root, schema) => {
  const ref = { current: null };
  const isJson = schema.endsWith('json');
  const resolvedPath = path_1.default.resolve(
    path_1.default.dirname(root),
    schema
  );
  const contents = fs_1.default.readFileSync(resolvedPath, 'utf-8');
  fs_1.default.watchFile(resolvedPath, () => {
    const contents = fs_1.default.readFileSync(resolvedPath, 'utf-8');
    const parsedSchema = isJson
      ? (0, graphql_1.buildClientSchema)(JSON.parse(contents))
      : (0, graphql_1.buildSchema)(contents);
    ref.current = isJson
      ? (0, graphql_1.buildClientSchema)(JSON.parse(contents))
      : (0, graphql_1.buildSchema)(contents);
    return ref;
  });
  ref.current = isJson
    ? (0, graphql_1.buildClientSchema)(JSON.parse(contents))
    : (0, graphql_1.buildSchema)(contents);
  return ref;
};
exports.loadSchema = loadSchema;
