import { ts } from './ts';
import { parse, visit } from 'graphql';
import type { FieldNode, SelectionSetNode } from 'graphql';

import { findAllCallExpressions, getSource } from './ast';
import {
  SEMANTIC_DIAGNOSTIC_CODE,
  USING_DEPRECATED_FIELD_CODE,
  getGraphQLDiagnostics,
} from './diagnostics';
import { UNUSED_FIELD_CODE } from './fieldUsage';
import { SchemaRef } from './graphql/getSchema';

/** Diagnostic codes we can offer a quick fix for. */
export const CODE_FIXABLE_DIAGNOSTICS: readonly number[] = [
  SEMANTIC_DIAGNOSTIC_CODE,
  USING_DEPRECATED_FIELD_CODE,
  UNUSED_FIELD_CODE,
];

/** Registers GraphQLSP's diagnostic codes with tsserver's code-fix registry.
 *
 * VS Code asks tsserver for the global list of supported fix codes before it
 * requests fixes at a position. Language-service proxies cannot change that
 * global response, so a no-op registration is needed to make VS Code request
 * the real fixes provided by `getGraphQLCodeFixesAtPosition` below. */
export const registerGraphQLCodeFixes = (): void => {
  const codefix = (ts as any).codefix as
    | {
        getSupportedErrorCodes(): readonly string[];
        registerCodeFix(registration: {
          errorCodes: readonly number[];
          getCodeActions(): undefined;
        }): void;
      }
    | undefined;
  if (!codefix) return;

  const supported = new Set(codefix.getSupportedErrorCodes());
  const missingCodes = CODE_FIXABLE_DIAGNOSTICS.filter(
    code => !supported.has(String(code))
  );
  if (!missingCodes.length) return;

  codefix.registerCodeFix({
    errorCodes: missingCodes,
    getCodeActions: () => undefined,
  });
};

/** Computes quick fixes for GraphQLSP's own diagnostics at a position.
 *
 * Editors pass along the error codes of the diagnostics that overlap the
 * requested range; these are matched against the plugin's diagnostics for
 * the file (which are LRU-cached by `getGraphQLDiagnostics`, so this
 * reuses the results the editor's request is based on). */
export function getGraphQLCodeFixesAtPosition(
  filename: string,
  start: number,
  end: number,
  errorCodes: readonly number[],
  schema: SchemaRef,
  info: ts.server.PluginCreateInfo
): ts.CodeFixAction[] {
  if (!errorCodes.some(code => CODE_FIXABLE_DIAGNOSTICS.includes(code))) {
    return [];
  }

  const source = getSource(info, filename);
  if (!source) return [];

  const diagnostics = getGraphQLDiagnostics(filename, schema, info);
  if (!diagnostics) return [];

  const fixes: ts.CodeFixAction[] = [];
  for (const diagnostic of diagnostics) {
    if (
      diagnostic.start == null ||
      diagnostic.length == null ||
      !errorCodes.includes(diagnostic.code) ||
      // The diagnostic has to overlap the requested range
      diagnostic.start > end ||
      diagnostic.start + diagnostic.length < start
    ) {
      continue;
    }

    const message = ts.flattenDiagnosticMessageText(
      diagnostic.messageText,
      '\n'
    );
    switch (diagnostic.code) {
      case SEMANTIC_DIAGNOSTIC_CODE:
        fixes.push(
          ...getDidYouMeanFixes(
            source,
            diagnostic.start,
            diagnostic.length,
            message
          )
        );
        break;
      case USING_DEPRECATED_FIELD_CODE:
        fixes.push(
          ...getDeprecatedFieldFixes(
            source,
            diagnostic.start,
            diagnostic.length,
            message
          )
        );
        break;
      case UNUSED_FIELD_CODE:
        fixes.push(
          ...getUnusedFieldFixes(source, diagnostic.start, message, info)
        );
        break;
    }
  }

  return fixes;
}

const createFix = (
  fixName: string,
  description: string,
  fileName: string,
  textChanges: ts.TextChange[]
): ts.CodeFixAction => ({
  fixName,
  description,
  changes: [{ fileName, textChanges }],
});

/** Offers one rename-fix per suggestion in a graphql-js validation message
 * ending in `Did you mean "a", "b", or "c"?`. */
const getDidYouMeanFixes = (
  source: ts.SourceFile,
  start: number,
  length: number,
  message: string
): ts.CodeFixAction[] => {
  const didYouMeanIndex = message.indexOf('Did you mean ');
  if (didYouMeanIndex === -1) return [];

  const suggestionText = message.slice(didYouMeanIndex);
  // "Did you mean to use an inline fragment on ..." isn't a plain rename of
  // the offending token
  if (suggestionText.includes('inline fragment')) return [];

  // The offending token is the first quoted name of the message, e.g.
  // `Cannot query field "nam" on type "Pokemon". Did you mean "name"?`
  const currentMatch = /"([^"]+)"/.exec(message.slice(0, didYouMeanIndex));
  if (!currentMatch) return [];
  const currentName = currentMatch[1]!;

  // The diagnostic's span may cover more than the token itself (e.g.
  // trailing whitespace); only replace the token
  const spanText = source.getText().slice(start, start + length);
  const offsetInSpan = spanText.indexOf(currentName);
  if (offsetInSpan === -1) return [];
  const span = { start: start + offsetInSpan, length: currentName.length };

  const fixes: ts.CodeFixAction[] = [];
  const suggestionRe = /"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = suggestionRe.exec(suggestionText))) {
    const suggestion = match[1]!;
    fixes.push(
      createFix(
        'graphqlDidYouMean',
        `Change '${currentName}' to '${suggestion}'`,
        source.fileName,
        [{ span, newText: suggestion }]
      )
    );
  }
  return fixes;
};

// A replacement in a deprecation reason: a backtick-quoted word or a single
// identifier after "use"/"replaced by"/"replaced with", case-insensitive
const REPLACEMENT_REASON_PATTERNS = [
  /\b(?:use|replaced\s+(?:by|with))\s+`([A-Za-z_][A-Za-z0-9_]*)`/i,
  /\b(?:use|replaced\s+(?:by|with))\s+"([A-Za-z_][A-Za-z0-9_]*)"/i,
  /\b(?:use|replaced\s+(?:by|with))\s+'([A-Za-z_][A-Za-z0-9_]*)'/i,
  /\b(?:use|replaced\s+(?:by|with))\s+([A-Za-z_][A-Za-z0-9_]*)/i,
];

/** Offers replacing a deprecated field when its deprecation reason names a
 * replacement, e.g. "Use `newField` instead" or "replaced by newField".
 * Without a parseable replacement, no fix is offered. */
const getDeprecatedFieldFixes = (
  source: ts.SourceFile,
  start: number,
  length: number,
  message: string
): ts.CodeFixAction[] => {
  const match = /^The field "?[\w.]+\.(\w+)"? is deprecated\.?\s*(.*)$/.exec(
    message
  );
  if (!match) return [];
  const fieldName = match[1]!;
  const reason = match[2] || '';

  let replacement: string | undefined;
  for (const pattern of REPLACEMENT_REASON_PATTERNS) {
    const reasonMatch = pattern.exec(reason);
    if (reasonMatch) {
      replacement = reasonMatch[1];
      break;
    }
  }
  if (!replacement || replacement === fieldName) return [];

  // The deprecated-field diagnostic's span extends past the field name;
  // only replace the name itself
  const spanText = source.getText().slice(start, start + length);
  const offsetInSpan = spanText.indexOf(fieldName);
  if (offsetInSpan === -1) return [];

  return [
    createFix(
      'graphqlReplaceDeprecatedField',
      `Replace deprecated field '${fieldName}' with '${replacement}'`,
      source.fileName,
      [
        {
          span: { start: start + offsetInSpan, length: fieldName.length },
          newText: replacement,
        },
      ]
    ),
  ];
};

/** Offers removing the field(s) an unused-field diagnostic reports. The
 * diagnostic's span points at the parent field, while the unused leaf paths
 * are listed in its message; each path is resolved back to its field node in
 * the document to delete exactly that field's text. When the removal would
 * leave a selection set empty (which is invalid GraphQL) no fix is offered. */
const getUnusedFieldFixes = (
  source: ts.SourceFile,
  diagnosticStart: number,
  message: string,
  info: ts.server.PluginCreateInfo
): ts.CodeFixAction[] => {
  const listMatch =
    /^Field\(s\) (.+) are not used\.$/.exec(message) ||
    /^Field (.+) is not used\.$/.exec(message);
  if (!listMatch) return [];
  const paths = listMatch[1]!
    .split(', ')
    .map(path => path.replace(/^'|'$/g, ''));

  // Locate the GraphQL document the diagnostic points into
  const { nodes } = findAllCallExpressions(source, info, {
    searchExternal: false,
    collectFragments: false,
  });
  const found = nodes.find(
    ({ node }) =>
      diagnosticStart >= node.getStart() && diagnosticStart <= node.getEnd()
  );
  if (!found) return [];
  const template = found.node;
  const text = template.getText().slice(1, -1);

  let document;
  try {
    document = parse(text);
  } catch (_error) {
    return [];
  }

  // Index the document's fields by response-shape path (the alias when one
  // is present), mirroring how field usage tracking builds its paths
  const fieldByPath = new Map<
    string,
    { field: FieldNode; parent: SelectionSetNode }
  >();
  const inProgress: string[] = [];
  const selectionSetStack: SelectionSetNode[] = [];
  visit(document, {
    SelectionSet: {
      enter(selectionSet) {
        selectionSetStack.push(selectionSet);
      },
      leave() {
        selectionSetStack.pop();
      },
    },
    Field: {
      enter(fieldNode) {
        const alias = fieldNode.alias
          ? fieldNode.alias.value
          : fieldNode.name.value;
        const path = inProgress.length
          ? `${inProgress.join('.')}.${alias}`
          : alias;
        const parent = selectionSetStack[selectionSetStack.length - 1]!;
        fieldByPath.set(path, { field: fieldNode, parent });
        if (fieldNode.selectionSet) inProgress.push(alias);
      },
      leave(fieldNode) {
        if (fieldNode.selectionSet) inProgress.pop();
      },
    },
  });

  const entries: Array<{ field: FieldNode; parent: SelectionSetNode }> = [];
  for (const path of paths) {
    const entry = fieldByPath.get(path);
    if (!entry || !entry.field.loc) return [];
    entries.push(entry);
  }

  // Deleting every selection of a set would produce invalid GraphQL
  const removedPerParent = new Map<SelectionSetNode, number>();
  for (const entry of entries) {
    removedPerParent.set(
      entry.parent,
      (removedPerParent.get(entry.parent) || 0) + 1
    );
  }
  for (const [parent, removed] of removedPerParent) {
    if (parent.selections.length <= removed) return [];
  }

  // GraphQL document offsets map onto the file with a one-character shift
  // for the template literal's opening quote/backtick
  const templateStart = template.getStart() + 1;
  const textChanges: ts.TextChange[] = entries.map(({ field }) => {
    const deletion = expandFieldDeletion(
      text,
      field.loc!.start,
      field.loc!.end
    );
    return {
      span: {
        start: templateStart + deletion.start,
        length: deletion.end - deletion.start,
      },
      newText: '',
    };
  });
  textChanges.sort((a, b) => a.span.start - b.span.start);

  const description =
    paths.length > 1
      ? `Remove unused fields ${paths.map(path => `'${path}'`).join(', ')}`
      : `Remove unused field '${paths[0]}'`;
  return [
    createFix(
      'graphqlRemoveUnusedField',
      description,
      source.fileName,
      textChanges
    ),
  ];
};

/** Expands a field's deletion range over the whitespace it leaves behind:
 * fields that own their line(s) take the indentation and trailing newline
 * with them, fields sharing a line only take their separating whitespace. */
const expandFieldDeletion = (
  text: string,
  start: number,
  end: number
): { start: number; end: number } => {
  // Trailing spaces and commas (commas are insignificant in GraphQL)
  let expandedEnd = end;
  while (
    text[expandedEnd] === ' ' ||
    text[expandedEnd] === '\t' ||
    text[expandedEnd] === ','
  ) {
    expandedEnd++;
  }

  // Leading indentation, up to the preceding newline
  let expandedStart = start;
  while (
    expandedStart > 0 &&
    (text[expandedStart - 1] === ' ' || text[expandedStart - 1] === '\t')
  ) {
    expandedStart--;
  }

  const atLineStart = expandedStart === 0 || text[expandedStart - 1] === '\n';
  const atLineEnd =
    expandedEnd >= text.length ||
    text[expandedEnd] === '\n' ||
    text[expandedEnd] === '\r';

  if (atLineStart && atLineEnd) {
    // The field owns its line(s): delete them entirely
    if (text[expandedEnd] === '\r') expandedEnd++;
    if (text[expandedEnd] === '\n') expandedEnd++;
    return { start: expandedStart, end: expandedEnd };
  } else if (atLineStart) {
    // Content follows on the same line: keep the indentation in place
    return { start, end: expandedEnd };
  } else {
    // The field trails other content: only take the separating whitespace
    return { start: expandedStart, end };
  }
};
