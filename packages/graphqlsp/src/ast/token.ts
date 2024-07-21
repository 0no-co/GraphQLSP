import { ts } from '../ts';
import { onlineParser, State, CharacterStream } from 'graphql-language-service';

export interface Token {
  start: number;
  end: number;
  string: string;
  tokenKind: string;
  line: number;
  state: State;
}

export const getToken = (
  template: ts.Expression,
  cursorPosition: number
): Token | undefined => {
  if (!ts.isTemplateLiteral(template) && !ts.isStringLiteralLike(template)) {
    return undefined;
  }

  const text = template.getText().slice(1, -1);
  const input = text.split('\n');
  const parser = onlineParser();
  const state = parser.startState();
  let cPos = template.getStart() + 1;

  let foundToken: Token | undefined = undefined;
  let prevToken: Token | undefined = undefined;
  for (let line = 0; line < input.length; line++) {
    if (foundToken) continue;
    const lPos = cPos - 1;
    const stream = new CharacterStream(input[line] + '\n');
    while (!stream.eol()) {
      const token = parser.token(stream, state);
      const string = stream.current();

      if (
        lPos + stream.getStartOfToken() + 1 <= cursorPosition &&
        lPos + stream.getCurrentPosition() >= cursorPosition
      ) {
        foundToken = prevToken
          ? prevToken
          : {
              line,
              start: stream.getStartOfToken() + 1,
              end: stream.getCurrentPosition(),
              string,
              state,
              tokenKind: token,
            };
        break;
      } else if (string === 'on') {
        prevToken = {
          line,
          start: stream.getStartOfToken() + 1,
          end: stream.getCurrentPosition(),
          string,
          state,
          tokenKind: token,
        };
      } else if (string === '.' || string === '..') {
        prevToken = {
          line,
          start: stream.getStartOfToken() + 1,
          end: stream.getCurrentPosition(),
          string,
          state,
          tokenKind: token,
        };
      } else {
        prevToken = undefined;
      }
    }

    cPos += input[line].length + 1;
  }

  return foundToken;
};
