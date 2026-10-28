import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  providers: new Map<string, any>(),
  registrations: [] as any[],
  documents: [] as any[],
}));
vi.mock('vscode', () => {
  class Position {
    constructor(
      public line: number,
      public character: number
    ) {}
  }
  class Range {
    constructor(
      public start: Position,
      public end: Position
    ) {}
  }
  class WorkspaceEdit {
    changes = new Map();
    set(uri: any, edits: any) {
      this.changes.set(uri, edits);
    }
  }
  class Disposable {
    static from(...items: any[]) {
      return { dispose: () => items.forEach(item => item.dispose()) };
    }
  }
  const register =
    (name: string) =>
    (...args: any[]) => {
      mocks.providers.set(name, args[1]);
      const dispose = vi.fn();
      mocks.registrations.push({ name, args, dispose });
      return { dispose };
    };
  return {
    Position,
    Range,
    WorkspaceEdit,
    Disposable,
    Uri: { parse: (value: string) => value },
    Hover: class {
      constructor(
        public contents: any,
        public range: any
      ) {}
    },
    MarkdownString: class {
      constructor(public value: string) {}
    },
    CompletionItem: class {
      constructor(
        public label: string,
        public kind: any
      ) {}
    },
    CompletionList: class {
      constructor(
        public items: any[],
        public isIncomplete: boolean
      ) {}
    },
    TextEdit: class {
      constructor(
        public range: any,
        public newText: string
      ) {}
    },
    Location: class {
      constructor(
        public uri: string,
        public range: any
      ) {}
    },
    CodeAction: class {
      constructor(
        public title: string,
        public kind: any
      ) {}
    },
    CodeActionKind: {
      QuickFix: 'quickfix',
      RefactorExtract: 'refactor.extract',
    },
    CompletionItemKind: { Field: 4 },
    workspace: { textDocuments: mocks.documents },
    languages: Object.fromEntries(
      [
        'Hover',
        'CompletionItem',
        'Definition',
        'Reference',
        'Rename',
        'CodeActions',
      ].map(name => ['register' + name + 'Provider', register(name)])
    ),
  };
});

import { registerFeatures } from '../../packages/vscode-graphqlsp/src/typescript7/features';

const uri = 'file:///project/query.ts';
const document = { uri: { toString: () => uri } } as any;
const position = { line: 1, character: 3 } as any;
const range = { start: { line: 1, character: 0 }, end: position };
const token = { isCancellationRequested: false } as any;

beforeEach(() => {
  mocks.providers.clear();
  mocks.registrations.length = 0;
  mocks.documents.splice(0, Infinity, document);
});

it('augments middleware responses and preserves TypeScript results elsewhere', async () => {
  const middleware = new Map<string, any>();
  const request = vi
    .fn()
    .mockResolvedValueOnce({
      contents: { kind: 'markdown', value: 'Pokemon.name' },
    })
    .mockResolvedValueOnce(undefined);
  const disposable = registerFeatures(
    {
      registerLspMiddleware: (method, transform) => {
        middleware.set(method, transform);
        return { dispose: vi.fn() };
      },
    },
    request
  );
  const params = { textDocument: { uri }, position };
  expect(await middleware.get('textDocument/hover')(null, { params })).toEqual({
    contents: { kind: 'markdown', value: 'Pokemon.name' },
  });
  const original = { items: [{ label: 'TypeScript' }] };
  expect(
    await middleware.get('textDocument/completion')(original, { params })
  ).toBe(original);
  expect(mocks.providers.has('Hover')).toBe(false);
  expect(mocks.providers.has('CompletionItem')).toBe(true);
  expect(
    mocks.providers.get('CompletionItem').resolveCompletionItem
  ).toBeUndefined();
  // Rename is always registered directly, independently of response middleware.
  expect(mocks.providers.has('Rename')).toBe(true);
  disposable.dispose();
  expect(
    mocks.registrations.every(
      registration => registration.dispose.mock.calls.length === 1
    )
  ).toBe(true);
});

it('suppresses native completions even when a recognized GraphQL context has no suggestions', async () => {
  const middleware = new Map<string, any>();
  const request = vi.fn().mockResolvedValue({ isIncomplete: false, items: [] });
  registerFeatures(
    {
      registerLspMiddleware: (method, transform) => {
        middleware.set(method, transform);
        return { dispose: vi.fn() };
      },
    },
    request
  );
  expect(
    await middleware.get('textDocument/completion')(
      { items: [{ label: 'native' }] },
      { params: { textDocument: { uri }, position } }
    )
  ).toEqual({ isIncomplete: false, items: [] });
});

it('registers hover and completion fallbacks for older TypeScript extensions', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({ contents: { value: 'Pokemon.name' }, range })
    .mockResolvedValueOnce({
      items: [{ label: 'name', textEdit: { range, newText: 'name' } }],
      isIncomplete: false,
    });
  registerFeatures({}, request);
  const hover = await mocks.providers
    .get('Hover')
    .provideHover(document, position, token);
  expect(hover.contents.value).toBe('Pokemon.name');
  const completion = await mocks.providers
    .get('CompletionItem')
    .provideCompletionItems(document, position, token);
  expect(completion.items[0].insertText).toBe('name');
  expect(completion.items[0].range.start.character).toBe(0);
});

it('converts fragment rename edits across files and respects cancellation', async () => {
  const changes = {
    [uri]: [{ range, newText: 'Details' }],
    'file:///project/fragment.ts': [{ range, newText: 'Details' }],
  };
  const request = vi
    .fn()
    .mockResolvedValueOnce({ range, placeholder: 'Fields' })
    .mockResolvedValue({ changes });
  registerFeatures({}, request);
  const provider = mocks.providers.get('Rename');
  expect(
    (await provider.prepareRename(document, position, token)).placeholder
  ).toBe('Fields');
  const edits = await provider.provideRenameEdits(
    document,
    position,
    'Details',
    token
  );
  expect(edits.changes.size).toBe(2);
  expect(
    await provider.provideRenameEdits(document, position, 'Details', {
      isCancellationRequested: true,
    })
  ).toBeUndefined();
});
