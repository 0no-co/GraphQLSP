import * as vscode from 'vscode';

export interface MiddlewareAPI {
  registerLspMiddleware?(
    method: string,
    transform: (result: any, context: { params: any }) => Promise<any>
  ): vscode.Disposable;
}

type Request = (
  method: string,
  document: vscode.TextDocument,
  params: any
) => Promise<any>;
const selector = [
  'typescript',
  'typescriptreact',
  'javascript',
  'javascriptreact',
].map(language => ({ language, scheme: 'file' }));
const position = (p: any) => new vscode.Position(p.line, p.character);
const range = (r: any) => new vscode.Range(position(r.start), position(r.end));
const edit = (value: any): vscode.WorkspaceEdit => {
  const result = new vscode.WorkspaceEdit();
  for (const [uri, changes] of Object.entries<any[]>(value.changes || {}))
    result.set(
      vscode.Uri.parse(uri),
      changes.map(
        change => new vscode.TextEdit(range(change.range), change.newText)
      )
    );
  return result;
};
const paramsAt = (document: vscode.TextDocument, p: vscode.Position) => ({
  textDocument: { uri: document.uri.toString() },
  position: { line: p.line, character: p.character },
});

/** Rename uses a provider because response middleware cannot intercept an LSP error. */
export function registerFeatures(
  api: MiddlewareAPI,
  request: Request
): vscode.Disposable {
  const disposables: vscode.Disposable[] = [];
  if (api.registerLspMiddleware) {
    for (const method of ['textDocument/hover', 'textDocument/completion'])
      disposables.push(
        api.registerLspMiddleware(method, async (original, { params }) => {
          const document = vscode.workspace.textDocuments.find(
            document => document.uri.toString() === params.textDocument.uri
          );
          if (!document) return original;
          const result = await request(method, document, params);
          if (result == null) return original;
          // Native completion items are owned by TypeScript's resolver. Publish
          // GraphQL items through our provider so resolving them never reaches it.
          return method === 'textDocument/completion'
            ? { isIncomplete: false, items: [] }
            : result;
        })
      );
  } else {
    disposables.push(
      vscode.languages.registerHoverProvider(selector, {
        async provideHover(document, p, token) {
          const result = await request(
            'textDocument/hover',
            document,
            paramsAt(document, p)
          );
          return !token.isCancellationRequested && result
            ? new vscode.Hover(
                new vscode.MarkdownString(result.contents.value),
                range(result.range)
              )
            : undefined;
        },
      })
    );
  }
  disposables.push(
    vscode.languages.registerCompletionItemProvider(
      selector,
      {
        async provideCompletionItems(document, p, token) {
          const result = await request(
            'textDocument/completion',
            document,
            paramsAt(document, p)
          );
          if (!result || token.isCancellationRequested) return;
          return new vscode.CompletionList(
            result.items.map((item: any) => {
              const completion = new vscode.CompletionItem(
                item.label,
                vscode.CompletionItemKind.Field
              );
              completion.detail = item.detail;
              completion.documentation = item.documentation;
              completion.sortText = item.sortText;
              completion.range = range(item.textEdit.range);
              completion.insertText = item.textEdit.newText;
              return completion;
            }),
            result.isIncomplete
          );
        },
      },
      '.',
      '@',
      '$'
    ),
    vscode.languages.registerDefinitionProvider(selector, {
      async provideDefinition(document, p, token) {
        const result = await request(
          'textDocument/definition',
          document,
          paramsAt(document, p)
        );
        return !token.isCancellationRequested && result
          ? result.map(
              (location: any) =>
                new vscode.Location(
                  vscode.Uri.parse(location.uri),
                  range(location.range)
                )
            )
          : undefined;
      },
    }),
    vscode.languages.registerReferenceProvider(selector, {
      async provideReferences(document, p, context, token) {
        const result = await request('textDocument/references', document, {
          ...paramsAt(document, p),
          context,
        });
        return !token.isCancellationRequested && result
          ? result.map(
              (location: any) =>
                new vscode.Location(
                  vscode.Uri.parse(location.uri),
                  range(location.range)
                )
            )
          : undefined;
      },
    }),
    vscode.languages.registerRenameProvider(selector, {
      async prepareRename(document, p, token) {
        const result = await request(
          'textDocument/prepareRename',
          document,
          paramsAt(document, p)
        );
        return !token.isCancellationRequested && result
          ? { range: range(result.range), placeholder: result.placeholder }
          : undefined;
      },
      async provideRenameEdits(document, p, newName, token) {
        const result = await request('textDocument/rename', document, {
          ...paramsAt(document, p),
          newName,
        });
        return !token.isCancellationRequested && result
          ? edit(result)
          : undefined;
      },
    }),
    vscode.languages.registerCodeActionsProvider(
      selector,
      {
        async provideCodeActions(document, selection, context, token) {
          const diagnostics = context.diagnostics.map(diagnostic => ({
            source: diagnostic.source,
            code:
              typeof diagnostic.code === 'object'
                ? diagnostic.code.value
                : diagnostic.code,
          }));
          const result = await request('textDocument/codeAction', document, {
            textDocument: { uri: document.uri.toString() },
            range: { start: selection.start, end: selection.end },
            context: {
              diagnostics,
              only: context.only ? [context.only.value] : undefined,
            },
          });
          return !token.isCancellationRequested && result
            ? result.map((action: any) => {
                const converted = new vscode.CodeAction(
                  action.title,
                  action.kind === 'quickfix'
                    ? vscode.CodeActionKind.QuickFix
                    : vscode.CodeActionKind.RefactorExtract
                );
                converted.edit = edit(action.edit);
                return converted;
              })
            : undefined;
        },
      },
      {
        providedCodeActionKinds: [
          vscode.CodeActionKind.QuickFix,
          vscode.CodeActionKind.RefactorExtract,
        ],
      }
    )
  );
  return vscode.Disposable.from(...disposables);
}
