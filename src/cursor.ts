import { IPosition } from "graphql-language-service";

export class Cursor implements IPosition {
  line: number;
  character: number;

  constructor(line: number, char: number) {
    this.line = line;
    this.character = char;
  }

  setLine(line: number) {
    this.line = line;
  }

  setCharacter(character: number) {
    this.character = character;
  }

  lessThanOrEqualTo(position: IPosition) {
    return this.line < position.line ||
      (this.line === position.line && this.character <= position.character);
  }
}