const vscode = require('vscode'),
  fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const config = require('../config.json');
const results = {
  startedAt: new Date().toISOString(),
  environment: { vscode: vscode.version, platform: process.platform },
  tests: [],
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const save = () =>
  fs.writeFileSync(config.results, JSON.stringify(results, null, 2));
const uri = file => vscode.Uri.file(path.join(config.project, file));
const diagnostics = document =>
  vscode.languages
    .getDiagnostics(document.uri)
    .filter(d => d.source === 'graphqlsp');
const pos = (document, text, delta = 1) =>
  document.positionAt(document.getText().indexOf(text) + delta);
async function poll(label, fn, timeout = 30000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await delay(100);
  }
  throw new Error(`Timed out: ${label}${last ? ' (' + last.stack + ')' : ''}`);
}
async function replace(document, text) {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    ),
    text
  );
  assert.equal(await vscode.workspace.applyEdit(edit), true);
}
const hoverText = hovers =>
  (hovers || [])
    .flatMap(hover =>
      hover.contents.map(content =>
        typeof content === 'string' ? content : content.value
      )
    )
    .join('\n');
async function test(name, fn) {
  const started = Date.now();
  try {
    const evidence = await fn();
    results.tests.push({
      name,
      passed: true,
      durationMs: Date.now() - started,
      evidence,
    });
    save();
  } catch (error) {
    results.tests.push({
      name,
      passed: false,
      durationMs: Date.now() - started,
      error: error.stack,
    });
    save();
    throw error;
  }
}
const restartClassic = () =>
  poll('classic restart command registered', async () => {
    try {
      await vscode.commands.executeCommand('typescript.restartTsServer');
      return true;
    } catch (error) {
      if (String(error).includes('not found')) return false;
      throw error;
    }
  });

exports.run = async () => {
  try {
    const native = vscode.extensions.getExtension(
      'TypeScriptTeam.native-preview'
    );
    const graphqlsp = vscode.extensions.getExtension('0no-co.vscode-graphqlsp');
    assert(native && graphqlsp, 'Both installed extensions must exist');
    results.environment.nativeExtension = native.packageJSON.version;
    results.environment.graphqlsp = graphqlsp.packageJSON.version;
    const api = await native.activate();
    results.environment.nativeApiKeys = Object.keys(api || {});
    await graphqlsp.activate();
    let initializations = 0;
    const subscription = api.onLanguageServerInitialized(
      () => initializations++
    );
    const doc = await vscode.workspace.openTextDocument(uri('src/invalid.ts'));
    await vscode.window.showTextDocument(doc);
    const savedInvalid = doc.getText(),
      savedValid = fs.readFileSync(
        path.join(config.project, 'src/valid.ts'),
        'utf8'
      );
    await test('installed VSIX publishes GraphQL diagnostics with native TypeScript', async () => {
      const errors = await poll('GraphQL diagnostics', () => {
        const ds = diagnostics(doc);
        return ds.some(d => d.message.includes('nmae')) && ds;
      });
      return errors.map(d => ({
        source: d.source,
        code: d.code,
        message: d.message,
        range: [d.range.start.line, d.range.start.character],
      }));
    });
    await test('unsaved fixes clear diagnostics and new typos reappear', async () => {
      await replace(doc, savedValid);
      await poll('clear errors', () => diagnostics(doc).length === 0);
      const start = Date.now();
      await replace(doc, savedValid.replace('        id', '        nmae'));
      await poll('unsaved typo', () =>
        diagnostics(doc).some(d => d.message.includes('nmae'))
      );
      const latencyMs = Date.now() - start;
      await replace(doc, savedValid);
      await poll('clear again', () => diagnostics(doc).length === 0);
      return { dirty: doc.isDirty, latencyMs };
    });
    await test('GraphQL hover through the real editor provider pipeline', async () => {
      await replace(doc, savedValid.replace('        id', '        name'));
      const content = await poll('GraphQL hover', async () => {
        const text = hoverText(
          await vscode.commands.executeCommand(
            'vscode.executeHoverProvider',
            doc.uri,
            pos(doc, '        name', 10)
          )
        );
        return text.includes('Pokemon.name') && text;
      });
      return { contents: content };
    });
    await test('GraphQL completion replaces a partial field correctly', async () => {
      await replace(doc, savedValid.replace('        id', '        maxC'));
      const p = pos(doc, 'maxC', 4);
      const item = await poll('completion maxCP', async () => {
        const list = await vscode.commands.executeCommand(
          'vscode.executeCompletionItemProvider',
          doc.uri,
          p,
          undefined,
          20
        );
        return list?.items.find(
          item =>
            (typeof item.label === 'string' ? item.label : item.label.label) ===
            'maxCP'
        );
      });
      let range = item.range;
      if (range && !('start' in range)) range = range.replacing;
      range = range || item.textEdit?.range;
      assert(range, 'Completion replacement range is required');
      assert.equal(doc.getText(range), 'maxC');
      const insert =
        typeof item.insertText === 'string'
          ? item.insertText
          : item.insertText?.value || 'maxCP';
      const edit = new vscode.WorkspaceEdit();
      edit.replace(doc.uri, range, insert);
      assert(await vscode.workspace.applyEdit(edit));
      assert(doc.getText().includes('        maxCP'));
      await poll(
        'completion clears typo',
        () => !diagnostics(doc).some(d => d.message.includes('maxC'))
      );
      return { label: item.label, insertText: insert, replacement: 'maxC' };
    });
    await test('schema definition and cross-file fragment references', async () => {
      await replace(doc, savedValid);
      const locations = await poll('definition', async () => {
        const result = await vscode.commands.executeCommand(
          'vscode.executeDefinitionProvider',
          doc.uri,
          pos(doc, '        id', 9)
        );
        return (
          result?.some(location =>
            (location.targetUri || location.uri).fsPath.endsWith(
              'schema.graphql'
            )
          ) && result
        );
      });
      const references = await poll('references', async () => {
        const refs = await vscode.commands.executeCommand(
          'vscode.executeReferenceProvider',
          doc.uri,
          pos(doc, '...pokemonFields', 4)
        );
        return refs?.length >= 2 && refs;
      });
      return {
        definitions: locations.map(
          location => (location.targetUri || location.uri).fsPath
        ),
        references: references.map(location => location.uri.fsPath),
      };
    });
    await test('fragment rename through the editor and across documents', async () => {
      const fragment = await vscode.workspace.openTextDocument(
        uri('src/fragment.ts')
      );
      const saved = fragment.getText();
      const commands = await vscode.commands.getCommands(true);
      results.environment.renameCommands = commands.filter(command =>
        /prepareRename|executeDocumentRename/i.test(command)
      );
      const position = pos(doc, '...pokemonFields', 4);
      if (commands.includes('vscode.prepareRename')) {
        const prepared = await vscode.commands.executeCommand(
          'vscode.prepareRename',
          doc.uri,
          position
        );
        assert(prepared, 'Prepare rename failed');
      }
      const edit = await vscode.commands.executeCommand(
        'vscode.executeDocumentRenameProvider',
        doc.uri,
        position,
        'PokemonDetails'
      );
      assert(edit, 'No fragment rename edits');
      const entries = edit.entries();
      assert(entries.length >= 2, 'Rename must include both files');
      assert(await vscode.workspace.applyEdit(edit));
      assert(doc.getText().includes('...PokemonDetails'));
      assert(fragment.getText().includes('fragment PokemonDetails'));
      const evidence = entries.map(([uri, edits]) => ({
        file: uri.fsPath,
        edits: edits.length,
      }));
      await replace(fragment, saved);
      await replace(doc, savedValid);
      return evidence;
    });
    await test('quick fix and fragment extraction are offered and applicable', async () => {
      await replace(doc, savedValid.replace('        id', '        nmae'));
      const diagnostic = await poll('typo diagnostic', () =>
        diagnostics(doc).find(d => d.message.includes('nmae'))
      );
      const fixes = await vscode.commands.executeCommand(
        'vscode.executeCodeActionProvider',
        doc.uri,
        diagnostic.range,
        'quickfix'
      );
      const fix = fixes?.find(
        action => action.title.includes('name') && action.edit
      );
      assert(fix, 'No GraphQL typo fix');
      assert(await vscode.workspace.applyEdit(fix.edit));
      assert(doc.getText().includes('        name'));
      await replace(doc, savedValid);
      const start = pos(doc, '        id', 8),
        end = start.translate(0, 2);
      const actions = await vscode.commands.executeCommand(
        'vscode.executeCodeActionProvider',
        doc.uri,
        new vscode.Range(start, end),
        'refactor.extract'
      );
      const extract = actions?.find(
        action => action.title === 'Extract to fragment'
      );
      assert(extract?.edit, 'No extraction action');
      assert(await vscode.workspace.applyEdit(extract.edit));
      assert(doc.getText().includes('fragment PokemonFields'));
      const evidence = {
        quickFix: fix.title,
        refactor: extract.title,
        result: doc.getText(),
      };
      await replace(doc, savedValid);
      return evidence;
    });
    await test('schema changes recheck unchanged editor documents', async () => {
      const schema = await vscode.workspace.openTextDocument(
        uri('schema.graphql')
      );
      const original = schema.getText();
      try {
        await replace(
          doc,
          savedValid.replace('        id', '        newEditorField')
        );
        await poll('unknown new field', () =>
          diagnostics(doc).some(d => d.message.includes('newEditorField'))
        );
        await replace(
          schema,
          original.replace(
            '  name: String!',
            '  newEditorField: String\n  name: String!'
          )
        );
        await schema.save();
        await poll(
          'schema reload clears error',
          () =>
            !diagnostics(doc).some(d => d.message.includes('newEditorField'))
        );
        return { schemaReloaded: true };
      } finally {
        await replace(schema, original);
        await schema.save();
        await replace(doc, savedValid);
      }
    });
    await test('native server restart restores diagnostics without duplicates', async () => {
      await replace(doc, savedInvalid);
      await poll('baseline typo', () =>
        diagnostics(doc).some(d => d.message.includes('nmae'))
      );
      const before = initializations;
      await vscode.commands.executeCommand('typescript.native-preview.restart');
      await poll('native restarted', () => initializations > before);
      const errors = await poll('diagnostics after restart', () => {
        const ds = diagnostics(doc);
        return ds.some(d => d.message.includes('nmae')) && ds;
      });
      const keys = errors.map(
        d => `${d.code}:${d.range.start.line}:${d.range.start.character}`
      );
      assert.equal(
        new Set(keys).size,
        keys.length,
        'Duplicate diagnostics after restart'
      );
      return { initializations, diagnosticCount: errors.length };
    });
    await test('schema deletion and recreation recover in the editor', async () => {
      await replace(doc, savedInvalid);
      const schemaPath = path.join(config.project, 'schema.graphql'),
        original = fs.readFileSync(schemaPath, 'utf8');
      try {
        fs.unlinkSync(schemaPath);
        await poll('deleted schema error', () =>
          diagnostics(doc).some(d => d.message.includes('Failed to load'))
        );
        fs.writeFileSync(schemaPath, original);
        await poll(
          'recreated schema recovery',
          () =>
            diagnostics(doc).some(d => d.message.includes('nmae')) &&
            !diagnostics(doc).some(d => d.message.includes('Failed to load'))
        );
        return { recovered: true };
      } finally {
        fs.writeFileSync(schemaPath, original);
      }
    });
    await test('switching to classic TypeScript and back avoids stale or duplicate diagnostics', async () => {
      const settings = vscode.workspace.getConfiguration('js/ts');
      await settings.update(
        'tsdk.path',
        path.join(config.legacy, 'lib'),
        vscode.ConfigurationTarget.Global
      );
      await settings.update(
        'experimental.useTsgo',
        false,
        vscode.ConfigurationTarget.Global
      );
      await restartClassic();
      await replace(doc, savedValid);
      await replace(doc, savedInvalid);
      const legacy = await poll('classic TypeScript diagnostic', () => {
        const ds = vscode.languages.getDiagnostics(doc.uri);
        return (
          ds.some(d => d.source === 'ts' && d.message.includes('nmae')) && ds
        );
      });
      assert.equal(
        legacy.filter(d => d.source === 'graphqlsp').length,
        0,
        'Native diagnostics must clear when switching to TypeScript 6'
      );
      await settings.update(
        'tsdk.path',
        config.native,
        vscode.ConfigurationTarget.Global
      );
      const before = initializations;
      await settings.update(
        'experimental.useTsgo',
        true,
        vscode.ConfigurationTarget.Global
      );
      await poll(
        'native TypeScript re-enabled',
        () => initializations > before
      );
      await poll('native GraphQL diagnostics restored', () =>
        diagnostics(doc).some(d => d.message.includes('nmae'))
      );
      return { classic: true, nativeRestored: true };
    });
    await test('workspace legacy setting takes precedence over global native mode', async () => {
      const current = vscode.workspace.getConfiguration('js/ts'),
        legacy = vscode.workspace.getConfiguration('typescript');
      await legacy.update(
        'experimental.useTsgo',
        false,
        vscode.ConfigurationTarget.Workspace
      );
      await poll(
        'native diagnostics cleared under workspace alias',
        () => diagnostics(doc).length === 0
      );
      assert.equal(
        diagnostics(doc).length,
        0,
        'Workspace legacy disable must clear native GraphQL diagnostics'
      );
      const before = initializations;
      await legacy.update(
        'experimental.useTsgo',
        undefined,
        vscode.ConfigurationTarget.Workspace
      );
      await poll(
        'native restored after workspace override removal',
        () =>
          initializations > before &&
          diagnostics(doc).some(d => d.message.includes('nmae'))
      );
      return { scopePrecedence: true, nativeRestored: true };
    });
    await test('resetting native mode to unset clears the native integration', async () => {
      const settings = vscode.workspace.getConfiguration('js/ts');
      await settings.update(
        'experimental.useTsgo',
        undefined,
        vscode.ConfigurationTarget.Global
      );
      await poll(
        'native diagnostics cleared after resetting setting',
        () => diagnostics(doc).length === 0
      );
      assert.equal(
        diagnostics(doc).length,
        0,
        'Resetting the only explicit setting must clear GraphQL native diagnostics'
      );
      const before = initializations;
      await settings.update(
        'experimental.useTsgo',
        true,
        vscode.ConfigurationTarget.Global
      );
      await poll(
        'native restored after explicit enable',
        () =>
          initializations > before &&
          diagnostics(doc).some(d => d.message.includes('nmae'))
      );
      return { unsetHandled: true, nativeRestored: true };
    });
    subscription.dispose();
    results.passed = true;
    results.finishedAt = new Date().toISOString();
    save();
  } catch (error) {
    results.passed = false;
    results.finishedAt = new Date().toISOString();
    save();
    throw error;
  }
};
