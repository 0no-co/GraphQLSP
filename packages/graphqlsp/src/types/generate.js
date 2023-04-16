'use strict';
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (
          !desc ||
          ('get' in desc ? !m.__esModule : desc.writable || desc.configurable)
        ) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            },
          };
        }
        Object.defineProperty(o, k2, desc);
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create
    ? function (o, v) {
        Object.defineProperty(o, 'default', { enumerable: true, value: v });
      }
    : function (o, v) {
        o['default'] = v;
      });
var __importStar =
  (this && this.__importStar) ||
  function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null)
      for (var k in mod)
        if (k !== 'default' && Object.prototype.hasOwnProperty.call(mod, k))
          __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
  };
var __awaiter =
  (this && this.__awaiter) ||
  function (thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P
        ? value
        : new P(function (resolve) {
            resolve(value);
          });
    }
    return new (P || (P = Promise))(function (resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator['throw'](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done
          ? resolve(result.value)
          : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, '__esModule', { value: true });
exports.generateBaseTypes = exports.generateTypedDocumentNodes = void 0;
const fs_1 = __importDefault(require('fs'));
const path_1 = __importDefault(require('path'));
const graphql_1 = require('graphql');
const core_1 = require('@graphql-codegen/core');
const typescriptPlugin = __importStar(require('@graphql-codegen/typescript'));
const typescriptOperationsPlugin = __importStar(
  require('@graphql-codegen/typescript-operations')
);
const typedDocumentNodePlugin = __importStar(
  require('@graphql-codegen/typed-document-node')
);
const generateTypedDocumentNodes = (schema, outputFile, doc, basePath) =>
  __awaiter(void 0, void 0, void 0, function* () {
    if (!schema) return;
    const config = {
      documents: [
        {
          location: 'operation.graphql',
          document: (0, graphql_1.parse)(doc),
        },
      ],
      config: {
        baseTypesPath: basePath,
      },
      // used by a plugin internally, although the 'typescript' plugin currently
      // returns the string output, rather than writing to a file
      filename: outputFile,
      schema: (0, graphql_1.parse)((0, graphql_1.printSchema)(schema)),
      plugins: [
        // TODO: there's optimisations to be had here where we move the typescript and typescript-operations
        // to a global __generated__ folder and import from it.
        { 'typescript-operations': { baseTypesPath: basePath } },
        { 'typed-document-node': { baseTypesPath: basePath } },
      ],
      pluginMap: {
        'typescript-operations': typescriptOperationsPlugin,
        'typed-document-node': typedDocumentNodePlugin,
      },
    };
    // @ts-ignore
    const output = yield (0, core_1.codegen)(config);
    fs_1.default.writeFile(
      path_1.default.join(outputFile),
      output,
      'utf8',
      err => {
        console.error(err);
      }
    );
  });
exports.generateTypedDocumentNodes = generateTypedDocumentNodes;
const generateBaseTypes = (schema, outputFile) =>
  __awaiter(void 0, void 0, void 0, function* () {
    if (!schema) return;
    const config = {
      config: {},
      // used by a plugin internally, although the 'typescript' plugin currently
      // returns the string output, rather than writing to a file
      filename: outputFile,
      schema: (0, graphql_1.parse)((0, graphql_1.printSchema)(schema)),
      plugins: [{ typescript: {} }],
      pluginMap: {
        typescript: typescriptPlugin,
      },
    };
    // @ts-ignore
    const output = yield (0, core_1.codegen)(config);
    fs_1.default.writeFile(
      path_1.default.join(outputFile),
      output,
      'utf8',
      err => {
        console.error(err);
      }
    );
  });
exports.generateBaseTypes = generateBaseTypes;
