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
  template: ts.TemplateLiteral,
  cursorPosition: number
): Token | undefined => {
  const text = template.getText().slice(1, -1);
  const input = text.split('\n');
  const parser = onlineParser();
  const state = parser.startState();
  let cPos = template.pos + 1;

  let foundToken: Token | undefined = undefined;
  for (let line = 0; line < input.length; line++) {
    const lPos = cPos - 1;
    const stream = new CharacterStream(input[line]);
    while (!stream.eol()) {
      const token = parser.token(stream, state);
      const string = stream.current();

      if (
        lPos + stream.getStartOfToken() <= cursorPosition &&
        lPos + stream.getCurrentPosition() >= cursorPosition
      ) {
        foundToken = {
          line,
          start: stream.getStartOfToken(),
          end: stream.getCurrentPosition(),
          string,
          state,
          tokenKind: token,
        };
        break;
      }
    }

    cPos += input[line].length + 1;
  }

  return foundToken;
};
