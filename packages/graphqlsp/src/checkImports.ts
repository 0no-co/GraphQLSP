import { ts } from './ts';
import { FragmentDefinitionNode, Kind, parse } from 'graphql';

import { findAllCallExpressions, findAllImports, getSource } from './ast';
import { resolveTemplate } from './ast/resolve';
import {
  VariableDeclaration,
  VariableStatement,
  isSourceFile,
} from 'typescript';

export const MISSING_FRAGMENT_CODE = 52003;

export const getColocatedFragmentNames = (
  source: ts.SourceFile,
  info: ts.server.PluginCreateInfo
): Record<
  string,
  { start: number; length: number; fragments: Array<string> }
> => {
  const imports = findAllImports(source);
  const typeChecker = info.languageService.getProgram()?.getTypeChecker();

  const importSpecifierToFragments: Record<
    string,
    { start: number; length: number; fragments: Array<string> }
  > = {};

  if (!typeChecker) return importSpecifierToFragments;

  if (imports.length) {
    imports.forEach(imp => {
      if (!imp.importClause) return;

      if (imp.importClause.name) {
        const definitions = info.languageService.getDefinitionAtPosition(
          source.fileName,
          imp.importClause.name.getStart()
        );
        const def = definitions && definitions[0];
        if (def) {
          if (def.fileName.includes('node_modules')) return;

          const externalSource = getSource(info, def.fileName);
          if (!externalSource) return;

          const fragmentsForImport = getFragmentsInSource(
            externalSource,
            typeChecker,
            info
          );

          const names = fragmentsForImport.map(fragment => fragment.name.value);
          const key = imp.moduleSpecifier.getText();
          let fragmentsEntry = importSpecifierToFragments[key];
          if (names.length && fragmentsEntry) {
            fragmentsEntry.fragments = fragmentsEntry.fragments.concat(names);
          } else if (names.length && !fragmentsEntry) {
            importSpecifierToFragments[key] = fragmentsEntry = {
              start: imp.moduleSpecifier.getStart(),
              length: imp.moduleSpecifier.getText().length,
              fragments: names,
            };
          }
        }
      }

      if (
        imp.importClause.namedBindings &&
        ts.isNamespaceImport(imp.importClause.namedBindings)
      ) {
        const definitions = info.languageService.getDefinitionAtPosition(
          source.fileName,
          imp.importClause.namedBindings.getStart()
        );
        const def = definitions && definitions[0];
        if (def) {
          if (def.fileName.includes('node_modules')) return;

          const externalSource = getSource(info, def.fileName);
          if (!externalSource) return;

          const fragmentsForImport = getFragmentsInSource(
            externalSource,
            typeChecker,
            info
          );
          const names = fragmentsForImport.map(fragment => fragment.name.value);
          const key = imp.moduleSpecifier.getText();
          let fragmentsEntry = importSpecifierToFragments[key];
          if (names.length && fragmentsEntry) {
            fragmentsEntry.fragments = fragmentsEntry.fragments.concat(names);
          } else if (names.length && !fragmentsEntry) {
            importSpecifierToFragments[key] = fragmentsEntry = {
              start: imp.moduleSpecifier.getStart(),
              length: imp.moduleSpecifier.getText().length,
              fragments: names,
            };
          }
        }
      } else if (
        imp.importClause.namedBindings &&
        ts.isNamedImportBindings(imp.importClause.namedBindings)
      ) {
        imp.importClause.namedBindings.elements.forEach(el => {
          const definitions = info.languageService.getDefinitionAtPosition(
            source.fileName,
            el.getStart()
          );
          const def = definitions && definitions[0];
          if (def) {
            if (def.fileName.includes('node_modules')) return;

            const externalSource = getSource(info, def.fileName);
            if (!externalSource) return;

            const fragmentsForImport = getFragmentsInSource(
              externalSource,
              typeChecker,
              info
            );
            const names = fragmentsForImport.map(
              fragment => fragment.name.value
            );
            const key = imp.moduleSpecifier.getText();
            let fragmentsEntry = importSpecifierToFragments[key];
            if (names.length && fragmentsEntry) {
              fragmentsEntry.fragments = fragmentsEntry.fragments.concat(names);
            } else if (names.length && !fragmentsEntry) {
              importSpecifierToFragments[key] = fragmentsEntry = {
                start: imp.moduleSpecifier.getStart(),
                length: imp.moduleSpecifier.getText().length,
                fragments: names,
              };
            }
          }
        });
      }
    });
  }

  return importSpecifierToFragments;
};

function getFragmentsInSource(
  src: ts.SourceFile,
  typeChecker: ts.TypeChecker,
  info: ts.server.PluginCreateInfo
): Array<FragmentDefinitionNode> {
  let fragments: Array<FragmentDefinitionNode> = [];
  const callExpressions = findAllCallExpressions(src, info, false);

  const symbol = typeChecker.getSymbolAtLocation(src);
  if (!symbol) return [];

  const exports = typeChecker.getExportsOfModule(symbol);
  const exportedNames = exports.map(symb => symb.name);
  const nodes = callExpressions.nodes.filter(x => {
    let parent = x.node.parent;
    while (
      parent &&
      !ts.isSourceFile(parent) &&
      !ts.isVariableDeclaration(parent)
    ) {
      parent = parent.parent;
    }

    if (ts.isVariableDeclaration(parent)) {
      return exportedNames.includes(parent.name.getText());
    } else {
      return false;
    }
  });

  nodes.forEach(node => {
    const text = resolveTemplate(node.node, src.fileName, info).combinedText;
    try {
      const parsed = parse(text, { noLocation: true });
      if (parsed.definitions.every(x => x.kind === Kind.FRAGMENT_DEFINITION)) {
        fragments = fragments.concat(parsed.definitions as any);
      }
    } catch (e) {
      return;
    }
  });

  return fragments;
}
