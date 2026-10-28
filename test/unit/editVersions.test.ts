import { expect, it } from 'vitest';
import {
  captureDocumentVersions,
  editsAreCurrent,
} from '../../packages/vscode-graphqlsp/src/typescript7/editVersions';

it('rejects cross-file edits if a referenced document changes, closes or reopens', () => {
  const first = {
    uri: { toString: () => 'file:///project/query.ts' },
    version: 1,
  };
  const other = {
    uri: { toString: () => 'file:///project/fragment.ts' },
    version: 2,
  };
  const edits = {
    changes: { 'file:///project/fragment.ts': [{ newText: 'Details' }] },
  };
  const captured = captureDocumentVersions([first, other]);
  expect(editsAreCurrent(edits, captured, [first, other])).toBe(true);
  other.version++;
  expect(editsAreCurrent(edits, captured, [first, other])).toBe(false);
  other.version--;
  expect(editsAreCurrent(edits, captured, [first])).toBe(false);
  expect(editsAreCurrent(edits, captured, [first, { ...other }])).toBe(false);
  expect(
    editsAreCurrent([{ edit: edits }], captured, [first, { ...other }])
  ).toBe(false);
});

it('normalizes escaped URI forms and ignores unrelated document edits', () => {
  const document = {
    uri: { toString: () => 'file:///project/my%20fragment.ts' },
    version: 1,
  };
  const before = captureDocumentVersions([document]);
  expect(
    editsAreCurrent(
      { changes: { 'file:///project/my fragment.ts': [] } },
      before,
      [document]
    )
  ).toBe(true);
  expect(editsAreCurrent({ contents: 'hover' }, before, [])).toBe(true);
});
