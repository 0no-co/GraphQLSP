'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.getToken = void 0;
const graphql_language_service_1 = require('graphql-language-service');
const getToken = (template, cursorPosition) => {
  const text = template.getText().slice(1, -1);
  const input = text.split('\n');
  const parser = (0, graphql_language_service_1.onlineParser)();
  const state = parser.startState();
  let cPos = template.pos + 1;
  let foundToken = undefined;
  for (let i = 0; i < input.length; i++) {
    const lPos = cPos;
    const stream = new graphql_language_service_1.CharacterStream(input[i]);
    while (!stream.eol()) {
      const token = parser.token(stream, state);
      const string = stream.current();
      if (
        string &&
        lPos + stream.getStartOfToken() <= cursorPosition &&
        lPos + stream.getCurrentPosition() >= cursorPosition
      ) {
        foundToken = {
          line: i,
          start: stream.getStartOfToken() + 1,
          end: stream.getCurrentPosition(),
          string,
          state,
          tokenKind: token,
        };
        break;
      }
    }
    cPos += input[i].length + 1;
  }
  return foundToken;
};
exports.getToken = getToken;
