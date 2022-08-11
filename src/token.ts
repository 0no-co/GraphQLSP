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
  const text = template.getText();
  const input = text.split('\n')
  const parser = onlineParser();
  const state = parser.startState();
  let cPos = template.pos;

  let foundToken: Token | undefined = undefined;
  for (let i = 0; i < input.length; i++) {
    const lPos = cPos;
    const stream = new CharacterStream(input[i]);
    while (!stream.eol()) {
      const token = parser.token(stream, state)
      const string = stream.current();

      if (string && lPos + stream.getStartOfToken() <= cursorPosition && lPos + stream.getCurrentPosition() <= cursorPosition) {
        foundToken = {
          line: i + 1,
          start: stream.getStartOfToken(),
          end: stream.getCurrentPosition(),
          string,
          state,
          tokenKind: token
        }
      }
    }

    cPos += input[i].length + 1
  }

  return foundToken
}
