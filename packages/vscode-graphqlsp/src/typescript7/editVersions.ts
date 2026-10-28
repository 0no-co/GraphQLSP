import { fileURLToPath } from 'node:url';

interface Document {
  uri: { toString(): string };
  version: number;
}
const key = (uri: string): string => {
  try {
    const file = fileURLToPath(uri);
    return process.platform === 'win32' ? file.toLowerCase() : file;
  } catch {
    return uri;
  }
};

export const captureDocumentVersions = (documents: readonly Document[]) =>
  new Map(
    documents.map(document => [
      key(document.uri.toString()),
      { document, version: document.version },
    ])
  );

/** Prevent edits computed for a snapshot from changing a different version. */
export function editsAreCurrent(
  result: any,
  before: ReturnType<typeof captureDocumentVersions>,
  documents: readonly Document[]
): boolean {
  const current = captureDocumentVersions(documents);
  const changes = Array.isArray(result)
    ? result.flatMap(action => Object.keys(action.edit?.changes || {}))
    : Object.keys(result?.changes || {});
  return changes.every(uri => {
    const previous = before.get(key(uri)),
      now = current.get(key(uri));
    return (
      previous?.document === now?.document && previous?.version === now?.version
    );
  });
}
