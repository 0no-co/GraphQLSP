import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createNativeGraphQLSP } from '@0no-co/graphqlsp/native';
import { buildSchema } from 'graphql';
import * as ast from 'typescript/ast';
import * as sync from 'typescript/sync';

const { API, DiagnosticCategory } = sync;

const root = path.dirname(fileURLToPath(import.meta.url));
const configFile = path.join(root, 'tsconfig.json');
const sourceFileName = path.join(root, 'fixture/index.ts');
const schema = buildSchema(`
  type Query { todos: [Todo] }
  type Todo { id: ID!, text: String! }
`);

test('real GraphQLSP diagnostics run on a TypeScript 7.1 native snapshot', () => {
  const api = new API({ cwd: root, collectTiming: true });
  let snapshot;
  try {
    snapshot = api.createSnapshot({ openProjects: [configFile] });
    const project = snapshot.getConfiguredProject(configFile);
    assert.ok(project, 'TypeScript 7.1 should load the fixture project');

    const source = project.program.getSourceFile(sourceFileName);
    assert.ok(source, 'TypeScript 7.1 should expose the fixture source');

    const resultDeclaration = source.statements
      .flatMap(statement => statement.declarationList?.declarations || [])
      .find(declaration => declaration.name?.text === 'validResult');
    assert.ok(resultDeclaration);
    assert.equal(
      project.checker.typeToString(
        project.checker.getTypeAtLocation(resultDeclaration.name)
      ),
      '{ todos: ({ id: string; text: string; } | null)[] | null; }'
    );
    assert.deepEqual(
      project.program.getSemanticDiagnostics(sourceFileName),
      []
    );

    const nativeGraphQLSP = createNativeGraphQLSP({ sync, ast });
    const diagnostics = nativeGraphQLSP.getDiagnostics(
      project,
      sourceFileName,
      schema
    );
    assert.deepEqual(
      diagnostics.map(diagnostic => ({
        category: diagnostic.category,
        code: diagnostic.code,
      })),
      [
        { category: DiagnosticCategory.Warning, code: 52009 },
        { category: DiagnosticCategory.Error, code: 52001 },
      ]
    );

    const [dynamicDiagnostic, unknownFieldDiagnostic] = diagnostics;
    assert.equal(
      source.text.slice(
        dynamicDiagnostic.start,
        dynamicDiagnostic.start + dynamicDiagnostic.length
      ),
      '`\n  query Dynamic {\n    todos {\n      ${dynamicFields}\n    }\n  }\n`'
    );
    // GraphQLSP's core maps the validation error start past the expanded
    // static interpolation and onto the exact TypeScript token.
    assert.equal(
      source.text.slice(
        unknownFieldDiagnostic.start,
        unknownFieldDiagnostic.start + unknownFieldDiagnostic.length
      ),
      'unknownField'
    );
    assert.equal(unknownFieldDiagnostic.length, 'unknownField'.length);
    assert.equal(unknownFieldDiagnostic.file, source);

    // A second schema must not reuse diagnostics cached for the first one.
    const permissiveSchema = buildSchema(`
      type Query { todos: [Todo] }
      type Todo { id: ID!, text: String!, unknownField: String }
    `);
    const permissiveDiagnostics = nativeGraphQLSP.getDiagnostics(
      project,
      sourceFileName,
      permissiveSchema
    );
    assert.deepEqual(
      permissiveDiagnostics.map(diagnostic => diagnostic.code),
      [52009]
    );

    // An equivalent replacement snapshot must return diagnostics referencing
    // its own remote SourceFile rather than a cached object from the prior one.
    api.runWithTemporaryFileUpdate(
      snapshot,
      sourceFileName,
      source.text,
      replacementSnapshot => {
        const replacementProject =
          replacementSnapshot.getConfiguredProject(configFile);
        assert.ok(replacementProject);
        const replacementSource =
          replacementProject.program.getSourceFile(sourceFileName);
        assert.ok(replacementSource);
        const replacementDiagnostics = nativeGraphQLSP.getDiagnostics(
          replacementProject,
          sourceFileName,
          schema
        );
        assert.equal(replacementDiagnostics[1].file, replacementSource);
      }
    );

    // Changed content must invalidate diagnostics without mutating the original
    // immutable snapshot or returning SourceFiles from a previous snapshot.
    const changedText = source.text.replace('unknownField', 'text');
    assert.notEqual(changedText, source.text);
    api.runWithTemporaryFileUpdate(
      snapshot,
      sourceFileName,
      changedText,
      changedSnapshot => {
        const changedProject = changedSnapshot.getConfiguredProject(configFile);
        assert.ok(changedProject);
        const changedSource =
          changedProject.program.getSourceFile(sourceFileName);
        assert.ok(changedSource);
        assert.equal(changedSource.text, changedText);
        assert.notEqual(changedSource, source);
        const changedDiagnostics = nativeGraphQLSP.getDiagnostics(
          changedProject,
          sourceFileName,
          schema
        );
        assert.deepEqual(
          changedDiagnostics.map(diagnostic => diagnostic.code),
          [52009]
        );
        assert.equal(changedDiagnostics[0].file, changedSource);
        assert.ok(source.text.includes('unknownField'));
      }
    );
    const originalDiagnostics = nativeGraphQLSP.getDiagnostics(
      project,
      sourceFileName,
      schema
    );
    assert.deepEqual(
      originalDiagnostics.map(diagnostic => diagnostic.code),
      [52009, 52001]
    );
    assert.equal(originalDiagnostics[1].file, source);
    assert.equal(
      source.text.slice(
        originalDiagnostics[1].start,
        originalDiagnostics[1].start + originalDiagnostics[1].length
      ),
      'unknownField'
    );

    const timing = api.getTimingInfo().totals;
    assert.ok(timing.nodesMaterialized > 0);
    assert.ok(timing.sourceFilesFetched > 0);
  } finally {
    snapshot?.dispose();
    api.close();
  }
});
