import {
  BREAK,
  DocumentNode,
  Kind,
  TypeInfo,
  parse,
  visit,
  visitWithTypeInfo,
} from 'graphql';

import { ts } from './ts';
import { findAllCallExpressions, getSource } from './ast';
import { SchemaRef, getSchemaForName } from './graphql/getSchema';

/** Tokens GraphQL ignores between selections: whitespace and commas. */
const IGNORED_CHARACTER = /[\s,]/;
const WHITESPACE_ONLY = /^[ \t]*$/;

interface ExtractableSelection {
  source: ts.SourceFile;
  /** The `graphql()`/`gql()` call whose document contains the selection. */
  call: ts.CallExpression;
  /** The document string literal, i.e. the call's first argument. */
  document: ts.StringLiteralLike;
  /** The document's text as written in the file, without its quotes. */
  documentText: string;
  /** Position of `documentText` in the file. */
  documentOffset: number;
  /** Selection range relative to `documentText`, trimmed of surrounding
   * ignored tokens and validated to cover complete sibling fields. */
  start: number;
  end: number;
  /** The GraphQL type the selected fields are selected on. */
  parentTypeName: string;
  /** All GraphQL documents in the file, for fragment-name uniqueness. */
  documentNodes: readonly ts.StringLiteralLike[];
}

/** Unwraps `as T`/`as const` around the call's fragment-array argument. */
const getFragmentArrayLiteral = (
  call: ts.CallExpression
): ts.Expression | undefined => {
  let node: ts.Expression | undefined = call.arguments[1];
  while (node && ts.isAsExpression(node)) node = node.expression;
  return node;
};

const findExtractableSelection = (
  filename: string,
  positionOrRange: number | ts.TextRange,
  schema: SchemaRef,
  info: ts.server.PluginCreateInfo
): ExtractableSelection | undefined => {
  // The refactor is only supported for call-expression documents; in
  // tagged-template mode fragments aren't composed via a fragment array
  const isCallExpression = info.config.templateIsCallExpression ?? true;
  if (!isCallExpression) return undefined;

  // A collapsed cursor position can never cover a complete field selection
  if (
    typeof positionOrRange === 'number' ||
    positionOrRange.pos >= positionOrRange.end
  ) {
    return undefined;
  }

  const source = getSource(info, filename);
  if (!source) return undefined;

  const { nodes } = findAllCallExpressions(source, info, {
    searchExternal: false,
    collectFragments: false,
  });

  for (const { node, schema: schemaName } of nodes) {
    const documentOffset = node.getStart() + 1;
    const documentText = node.getText().slice(1, -1);
    if (
      positionOrRange.pos < documentOffset ||
      positionOrRange.end > documentOffset + documentText.length
    ) {
      continue;
    }

    if (!ts.isCallExpression(node.parent) || node.parent.arguments[0] !== node)
      return undefined;
    const call = node.parent;

    // The new fragment is referenced through the call's fragment array, so
    // a second argument that isn't an array literal disqualifies the call
    const fragmentArray = getFragmentArrayLiteral(call);
    if (fragmentArray && !ts.isArrayLiteralExpression(fragmentArray))
      return undefined;

    let start = positionOrRange.pos - documentOffset;
    let end = positionOrRange.end - documentOffset;
    while (start < end && IGNORED_CHARACTER.test(documentText[start]!)) start++;
    while (end > start && IGNORED_CHARACTER.test(documentText[end - 1]!)) end--;
    if (start >= end) return undefined;

    const schemaToUse = getSchemaForName(schema, schemaName);
    if (!schemaToUse) return undefined;

    let document: DocumentNode;
    try {
      document = parse(documentText);
    } catch (_error) {
      return undefined;
    }

    // The trimmed selection is only extractable when it exactly tiles one
    // or more complete sibling field selections: it must begin at a field's
    // start and consecutive siblings must line up with the selection's end
    let parentTypeName: string | undefined;
    const typeInfo = new TypeInfo(schemaToUse);
    visit(
      document,
      visitWithTypeInfo(typeInfo, {
        SelectionSet(selectionSet) {
          const index = selectionSet.selections.findIndex(
            selection => selection.loc && selection.loc.start === start
          );
          if (index === -1) return undefined;
          for (let i = index; i < selectionSet.selections.length; i++) {
            const selection = selectionSet.selections[i]!;
            if (
              selection.kind !== Kind.FIELD ||
              !selection.loc ||
              selection.loc.end > end
            ) {
              break;
            } else if (selection.loc.end === end) {
              // `TypeInfo` has already entered this selection set, so the
              // parent type here is the type the selections apply to
              parentTypeName = typeInfo.getParentType()?.name;
              break;
            }
          }
          // A selection can only start at one field in the whole document,
          // so whether the run matched or not, the search is over
          return BREAK;
        },
      })
    );
    if (!parentTypeName) return undefined;

    return {
      source,
      call,
      document: node,
      documentText,
      documentOffset,
      start,
      end,
      parentTypeName,
      documentNodes: nodes.map(x => x.node),
    };
  }

  return undefined;
};

/** Checks whether the selected range covers complete field selections that
 * can be extracted into a co-located fragment. */
export const canExtractFragment = (
  filename: string,
  positionOrRange: number | ts.TextRange,
  schema: SchemaRef,
  info: ts.server.PluginCreateInfo
): boolean =>
  !!findExtractableSelection(filename, positionOrRange, schema, info);

const toVariableName = (fragmentName: string): string =>
  fragmentName.charAt(0).toLowerCase() + fragmentName.slice(1);

/** Picks `<ParentType>Fields` (or a numbered variant) such that neither the
 * fragment name is taken by a document in the file, nor the derived variable
 * name occurs in the file's text. */
const pickFragmentName = (
  source: ts.SourceFile,
  documentNodes: readonly ts.StringLiteralLike[],
  parentTypeName: string
): string => {
  const takenFragmentNames = new Set<string>();
  for (const node of documentNodes) {
    try {
      const parsed = parse(node.getText().slice(1, -1), { noLocation: true });
      for (const definition of parsed.definitions) {
        if (definition.kind === Kind.FRAGMENT_DEFINITION)
          takenFragmentNames.add(definition.name.value);
      }
    } catch (_error) {}
  }

  const fileText = source.getText();
  const isTaken = (name: string): boolean =>
    takenFragmentNames.has(name) ||
    new RegExp(`\\b${toVariableName(name)}\\b`).test(fileText);

  let fragmentName = `${parentTypeName}Fields`;
  for (let counter = 2; isTaken(fragmentName); counter++)
    fragmentName = `${parentTypeName}Fields${counter}`;
  return fragmentName;
};

const getLineStart = (text: string, position: number): number =>
  text.lastIndexOf('\n', position - 1) + 1;

/** Guesses the file's indentation unit from the document's own lines,
 * relative to the statement's base indentation. */
const detectIndentUnit = (documentText: string, baseIndent: string): string => {
  for (const line of documentText.split('\n')) {
    if (!line.trim()) continue;
    const match = /^[ \t]+/.exec(line);
    if (!match) continue;
    let indent = match[0];
    if (indent.startsWith(baseIndent)) indent = indent.slice(baseIndent.length);
    if (indent) return indent;
  }
  return '  ';
};

/** The position the new fragment statement is inserted at: the start of the
 * line of the statement containing the call, above any leading comments
 * that are on their own lines. */
const getInsertionPoint = (
  source: ts.SourceFile,
  call: ts.CallExpression
): { position: number; indent: string } => {
  const fileText = source.getText();

  let statement: ts.Node = call;
  while (
    statement.parent &&
    !ts.isSourceFile(statement.parent) &&
    !ts.isBlock(statement.parent)
  ) {
    statement = statement.parent;
  }

  let reference = statement.getStart();
  const comments = ts.getLeadingCommentRanges(
    fileText,
    statement.getFullStart()
  );
  if (comments && comments.length) {
    const commentLineStart = getLineStart(fileText, comments[0]!.pos);
    if (
      WHITESPACE_ONLY.test(fileText.slice(commentLineStart, comments[0]!.pos))
    )
      reference = comments[0]!.pos;
  }

  const lineStart = getLineStart(fileText, reference);
  const linePrefix = fileText.slice(lineStart, reference);
  return WHITESPACE_ONLY.test(linePrefix)
    ? { position: lineStart, indent: linePrefix }
    : { position: reference, indent: '' };
};

const printFragmentStatement = (
  found: ExtractableSelection,
  fragmentName: string,
  baseIndent: string
): string => {
  const { source, call, document, documentText, documentOffset, start, end } =
    found;
  const fileText = source.getText();
  const variableName = toVariableName(fragmentName);
  const callee = call.expression.getText();
  const quote = document.getText().charAt(0);
  const selectedText = documentText.slice(start, end);

  if (quote !== '`') {
    // Regular string literals can't span lines, so the fragment document
    // is emitted on a single line, mirroring the current call's style
    const fields = selectedText.trim();
    return (
      `${baseIndent}const ${variableName} = ${callee}(${quote}` +
      `fragment ${fragmentName} on ${found.parentTypeName} { ${fields} }` +
      `${quote});\n\n`
    );
  }

  const indentUnit = detectIndentUnit(documentText, baseIndent);
  const fieldIndent = baseIndent + indentUnit + indentUnit;

  // The indentation the selected fields currently have: the whitespace
  // preceding the first selected field on its own line
  const selectionLineStart = getLineStart(fileText, documentOffset + start);
  const selectionLinePrefix = fileText.slice(
    selectionLineStart,
    documentOffset + start
  );
  const selectionIndent = WHITESPACE_ONLY.test(selectionLinePrefix)
    ? selectionLinePrefix
    : '';

  const fields = selectedText.split('\n').map((line, index) => {
    if (index === 0) return fieldIndent + line;
    line = line.replace(/\r$/, '');
    if (!line.trim()) return '';
    return selectionIndent && line.startsWith(selectionIndent)
      ? fieldIndent + line.slice(selectionIndent.length)
      : fieldIndent + line.trimStart();
  });

  return (
    [
      `${baseIndent}const ${variableName} = ${callee}(${quote}`,
      `${baseIndent}${indentUnit}fragment ${fragmentName} on ${found.parentTypeName} {`,
      ...fields,
      `${baseIndent}${indentUnit}}`,
      `${baseIndent}${quote});`,
    ].join('\n') + '\n\n'
  );
};

/** Computes the edits for the 'Extract to fragment' refactor: a new
 * fragment statement above the current one, a fragment spread replacing the
 * selected fields, and the new variable added to the call's fragment array. */
export const getExtractFragmentEdits = (
  filename: string,
  positionOrRange: number | ts.TextRange,
  schema: SchemaRef,
  info: ts.server.PluginCreateInfo
): ts.RefactorEditInfo | undefined => {
  const found = findExtractableSelection(
    filename,
    positionOrRange,
    schema,
    info
  );
  if (!found) return undefined;

  const fragmentName = pickFragmentName(
    found.source,
    found.documentNodes,
    found.parentTypeName
  );
  const variableName = toVariableName(fragmentName);

  const insertion = getInsertionPoint(found.source, found.call);
  const textChanges: ts.TextChange[] = [
    {
      span: { start: insertion.position, length: 0 },
      newText: printFragmentStatement(found, fragmentName, insertion.indent),
    },
    {
      span: {
        start: found.documentOffset + found.start,
        length: found.end - found.start,
      },
      newText: `...${fragmentName}`,
    },
  ];

  const fragmentArray = getFragmentArrayLiteral(found.call);
  if (fragmentArray && ts.isArrayLiteralExpression(fragmentArray)) {
    if (fragmentArray.elements.length) {
      const lastElement =
        fragmentArray.elements[fragmentArray.elements.length - 1]!;
      textChanges.push({
        span: { start: lastElement.getEnd(), length: 0 },
        newText: `, ${variableName}`,
      });
    } else {
      textChanges.push({
        span: { start: fragmentArray.getEnd() - 1, length: 0 },
        newText: variableName,
      });
    }
  } else {
    textChanges.push({
      span: { start: found.document.getEnd(), length: 0 },
      newText: `, [${variableName}]`,
    });
  }

  return { edits: [{ fileName: filename, textChanges }] };
};
