import type { ts } from '../ts';

export type CheckSeverity = 'error' | 'warning' | 'suggestion' | 'message';

/** A GraphQLSP diagnostic. Plain data, so it can be serialized as-is. */
export interface CheckDiagnostic {
  /** Absolute path of the file the diagnostic is reported in. */
  file: string;
  /** Start offset (in UTF-16 code units) into the file's text. */
  start: number;
  /** Length (in UTF-16 code units) of the reported span. */
  length: number;
  /** 1-based line of `start`. */
  line: number;
  /** 1-based column (in UTF-16 code units) of `start`. */
  column: number;
  message: string;
  /** GraphQLSP's diagnostic code, e.g. `52001` for schema validation errors. */
  code: number;
  severity: CheckSeverity;
}

const severities: Record<number, CheckSeverity> = {
  0: 'warning',
  1: 'error',
  2: 'suggestion',
  3: 'message',
};

const flattenMessage = (
  message: string | ts.DiagnosticMessageChain
): string => {
  if (typeof message === 'string') return message;
  let text = message.messageText;
  for (const next of message.next || [])
    text += '\n  ' + flattenMessage(next).replace(/\n/g, '\n  ');
  return text;
};

const getLineStarts = (text: string) => {
  const lineStarts = [0];
  for (let idx = 0; idx < text.length; idx++) {
    const char = text.charCodeAt(idx);
    if (char === 13 /*'\r'*/ && text.charCodeAt(idx + 1) === 10 /*'\n'*/) {
      continue;
    } else if (char === 10 || char === 13) {
      lineStarts.push(idx + 1);
    }
  }
  return lineStarts;
};

const toLineAndColumn = (lineStarts: number[], position: number) => {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (lineStarts[mid]! <= position) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return { line: low + 1, column: position - lineStarts[low]! + 1 };
};

/** Converts TypeScript diagnostics to plain `CheckDiagnostic`s.
 *
 * @param lineStartsByFile - caches line starts across calls, keyed by file name
 */
export const toCheckDiagnostics = (
  file: string,
  diagnostics: readonly ts.Diagnostic[],
  lineStartsByFile = new Map<string, number[]>()
): CheckDiagnostic[] =>
  diagnostics.map(diagnostic => {
    const source = diagnostic.file;
    const fileName = source ? source.fileName : file;
    const start = diagnostic.start || 0;
    let lineStarts = lineStartsByFile.get(fileName);
    if (!lineStarts) {
      lineStarts = getLineStarts(source ? source.text : '');
      lineStartsByFile.set(fileName, lineStarts);
    }
    return {
      file: fileName,
      start,
      length: diagnostic.length || 0,
      ...toLineAndColumn(lineStarts, start),
      message: flattenMessage(diagnostic.messageText),
      code: diagnostic.code,
      severity: severities[diagnostic.category] || 'error',
    };
  });
