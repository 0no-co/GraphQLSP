import ts from "typescript/lib/tsserverlibrary";
import { onlineParser, State, CharacterStream } from "graphql-language-service";

export interface Token {
  start: number;
  end: number;
  string: string;
  tokenKind: string
  line: number
  state: State
}

export const getToken = (template: ts.TemplateLiteral, cursorPosition: number): Token | undefined => {
  const text = template.getText().slice(1, -1);
  const input = text.split('\n')
  const parser = onlineParser();
  const state = parser.startState();
  let cPos = template.pos + 1;

  let foundToken: Token | undefined = undefined;
  for (let i = 0; i < input.length; i++) {
    const lPos = cPos;
    const stream = new CharacterStream(input[i]);
    while (!stream.eol()) {
      const token = parser.token(stream, state)
      const string = stream.current();

      if (string && lPos + stream.getStartOfToken() <= cursorPosition && lPos + stream.getCurrentPosition() >= cursorPosition) {
        foundToken = {
          line: i,
          start: stream.getStartOfToken() + 1,
          end: stream.getCurrentPosition(),
          string,
          state,
          tokenKind: token
        }
        break;
      }
    }

    cPos += input[i].length + 1
  }

  return foundToken
}
