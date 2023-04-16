'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.Cursor = void 0;
class Cursor {
  constructor(line, char) {
    this.line = line;
    this.character = char;
  }
  setLine(line) {
    this.line = line;
  }
  setCharacter(character) {
    this.character = character;
  }
  lessThanOrEqualTo(position) {
    return (
      this.line < position.line ||
      (this.line === position.line && this.character <= position.character)
    );
  }
}
exports.Cursor = Cursor;
