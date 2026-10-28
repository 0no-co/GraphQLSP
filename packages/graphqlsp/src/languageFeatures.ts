import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ts } from './ts';
import type { GraphQLSPHost } from './host';
import type { SchemaRef } from './graphql/getSchema';
import { getGraphQLQuickInfo } from './quickInfo';
import { getGraphQLCompletions } from './autoComplete';
import { getGraphQLDefinitionAtPosition } from './definition';
import {
  getGraphQLFragmentReferenceEntries,
  getGraphQLFragmentRenameInfo,
  getGraphQLFragmentRenameLocations,
} from './references';
import { getGraphQLCodeFixesAtPosition } from './codeFixes';
import { getExtractFragmentEdits } from './extractFragment';

export interface Position {
  line: number;
  character: number;
}
export interface Range {
  start: Position;
  end: Position;
}

/** LSP positions are UTF-16 offsets, as are TypeScript's string offsets. */
export const positionAt = (text: string, offset: number): Position => {
  offset = Math.max(0, Math.min(text.length, offset));
  const prefix = text.slice(0, offset);
  const line = (prefix.match(/\n/g) || []).length;
  return { line, character: offset - (prefix.lastIndexOf('\n') + 1) };
};

export const offsetAt = (text: string, position: Position): number => {
  let start = 0;
  for (let line = 0; line < position.line; line++) {
    const next = text.indexOf('\n', start);
    if (next < 0) return text.length;
    start = next + 1;
  }
  const newline = text.indexOf('\n', start);
  let end = newline < 0 ? text.length : newline;
  if (text[end - 1] === '\r') end--;
  return Math.min(end, start + Math.max(0, position.character));
};

export const rangeAt = (text: string, span: ts.TextSpan): Range => ({
  start: positionAt(text, span.start),
  end: positionAt(text, span.start + span.length),
});

export const featureMethods = new Set([
  'textDocument/hover',
  'textDocument/completion',
  'textDocument/definition',
  'textDocument/references',
  'textDocument/prepareRename',
  'textDocument/rename',
  'textDocument/codeAction',
]);

/** Returns undefined when GraphQLSP does not own this position. */
export function getLanguageFeature(
  method: string,
  params: any,
  fileName: string,
  text: string,
  schema: SchemaRef,
  host: GraphQLSPHost
): any {
  const program = host.languageService.getProgram();
  const sourceText = (file: string) =>
    program?.getSourceFile(file)?.text ?? fs.readFileSync(file, 'utf8');
  const location = (file: string, span: ts.TextSpan) => ({
    uri: pathToFileURL(file).href,
    range: rangeAt(sourceText(file), span),
  });
  const workspaceEdit = (changes: readonly ts.FileTextChanges[]) => ({
    changes: Object.fromEntries(
      changes.map(change => [
        pathToFileURL(change.fileName).href,
        change.textChanges.map(edit => ({
          range: rangeAt(sourceText(change.fileName), edit.span),
          newText: edit.newText,
        })),
      ])
    ),
  });
  const offset = params.position ? offsetAt(text, params.position) : 0;
  switch (method) {
    case 'textDocument/hover': {
      const info = getGraphQLQuickInfo(fileName, offset, schema, host);
      if (!info) return;
      return {
        contents: {
          kind: 'markdown',
          value:
            '```graphql\n' +
            (info.displayParts || []).map(part => part.text).join('') +
            '\n```\n\n' +
            (info.documentation || []).map(part => part.text).join(''),
        },
        range: rangeAt(text, info.textSpan),
      };
    }
    case 'textDocument/completion': {
      const info = getGraphQLCompletions(fileName, offset, schema, host);
      if (!info) return;
      const prefix = /[_0-9A-Za-z]*$/.exec(text.slice(0, offset))![0];
      const suffix = /^[_0-9A-Za-z]*/.exec(text.slice(offset))![0];
      const replacement = rangeAt(text, {
        start: offset - prefix.length,
        length: prefix.length + suffix.length,
      });
      return {
        isIncomplete: false,
        items: info.entries.map(entry => ({
          label: entry.name,
          kind: 5,
          sortText: entry.sortText,
          detail: entry.labelDetails?.detail,
          documentation: entry.labelDetails?.description,
          textEdit: {
            range: entry.replacementSpan
              ? rangeAt(text, entry.replacementSpan)
              : replacement,
            newText:
              entry.insertText?.startsWith('...') &&
              text.slice(0, offset - prefix.length).endsWith('...')
                ? entry.insertText.slice(3)
                : entry.insertText || entry.name,
          },
        })),
      };
    }
    case 'textDocument/definition': {
      const definitions = getGraphQLDefinitionAtPosition(
        fileName,
        offset,
        schema,
        host,
        undefined
      );
      if (definitions !== undefined)
        return definitions.map(definition =>
          location(definition.fileName, definition.textSpan)
        );
      const references = getGraphQLFragmentReferenceEntries(
        fileName,
        offset,
        host
      );
      return references
        ?.filter(ref => ref.isWriteAccess)
        .map(ref => location(ref.fileName, ref.textSpan));
    }
    case 'textDocument/references': {
      const references = getGraphQLFragmentReferenceEntries(
        fileName,
        offset,
        host
      );
      return references
        ?.filter(
          ref => params.context?.includeDeclaration || !ref.isWriteAccess
        )
        .map(ref => location(ref.fileName, ref.textSpan));
    }
    case 'textDocument/prepareRename': {
      const info = getGraphQLFragmentRenameInfo(fileName, offset, host);
      if (info)
        return {
          range: rangeAt(text, info.triggerSpan),
          placeholder: info.displayName,
        };
      return;
    }
    case 'textDocument/rename': {
      if (
        typeof params.newName !== 'string' ||
        !/^[_A-Za-z][_0-9A-Za-z]*$/.test(params.newName)
      )
        return;
      const references = getGraphQLFragmentRenameLocations(
        fileName,
        offset,
        host
      );
      if (!references) return;
      const changes = new Map<string, ts.TextChange[]>();
      for (const reference of references) {
        const edits = changes.get(reference.fileName) || [];
        edits.push({ span: reference.textSpan, newText: params.newName });
        changes.set(reference.fileName, edits);
      }
      return workspaceEdit(
        [...changes].map(([fileName, textChanges]) => ({
          fileName,
          textChanges,
        }))
      );
    }
    case 'textDocument/codeAction': {
      if (!params.range) return;
      const start = offsetAt(text, params.range.start),
        end = offsetAt(text, params.range.end);
      const only: string[] | undefined = params.context?.only;
      const wants = (kind: string) =>
        !only ||
        only.some(value => kind === value || kind.startsWith(value + '.'));
      const actions: any[] = [];
      if (wants('quickfix')) {
        const codes = (params.context?.diagnostics || [])
          .filter((diagnostic: any) => diagnostic.source === 'graphqlsp')
          .map((diagnostic: any) => Number(diagnostic.code));
        for (const fix of getGraphQLCodeFixesAtPosition(
          fileName,
          start,
          end,
          codes,
          schema,
          host
        ))
          actions.push({
            title: fix.description,
            kind: 'quickfix',
            edit: workspaceEdit(fix.changes),
          });
      }
      if (wants('refactor.extract')) {
        const edits = getExtractFragmentEdits(
          fileName,
          { pos: start, end },
          schema,
          host
        );
        if (edits)
          actions.push({
            title: 'Extract to fragment',
            kind: 'refactor.extract',
            edit: workspaceEdit(edits.edits),
          });
      }
      return actions.length ? actions : undefined;
    }
  }
}

export const fileNameFromURI = (uri: string): string | undefined => {
  try {
    return uri.startsWith('file:') ? fileURLToPath(uri) : undefined;
  } catch {
    return undefined;
  }
};
