import ts from 'typescript/lib/tsserverlibrary';
import { FragmentDefinitionNode, Kind, parse } from 'graphql';

import {
  findAllCallExpressions,
  findAllImports,
  findAllTaggedTemplateNodes,
  getSource,
} from './ast';
import { resolveTemplate } from './ast/resolve';

export const MISSING_FRAGMENT_CODE = 52003;

export const checkImportsForFragments = (
  source: ts.SourceFile,
  info: ts.server.PluginCreateInfo
) => {
  const imports = findAllImports(source);

  const shouldCheckForColocatedFragments =
    info.config.shouldCheckForColocatedFragments ?? false;
  const tsDiagnostics: ts.Diagnostic[] = [];
  if (imports.length && shouldCheckForColocatedFragments) {
    const typeChecker = info.languageService.getProgram()?.getTypeChecker();
    imports.forEach(imp => {
      if (!imp.importClause) return;

      const importedNames: string[] = [];
      if (imp.importClause.name) {
        importedNames.push(imp.importClause?.name.text);
      }

      if (
        imp.importClause.namedBindings &&
        ts.isNamespaceImport(imp.importClause.namedBindings)
      ) {
        // TODO: we might need to warn here when the fragment is unused as a namespace import
        return;
      } else if (
        imp.importClause.namedBindings &&
        ts.isNamedImportBindings(imp.importClause.namedBindings)
      ) {
        imp.importClause.namedBindings.elements.forEach(el => {
          importedNames.push(el.name.text);
        });
      }

      const symbol = typeChecker?.getSymbolAtLocation(imp.moduleSpecifier);
      if (!symbol) return;

      const moduleExports = typeChecker?.getExportsOfModule(symbol);
      if (!moduleExports) return;

      const missingImports = new Set<string>();
      moduleExports.forEach(exp => {
        if (importedNames.includes(exp.name)) {
          return;
        }

        const declarations = exp.getDeclarations();
        const declaration = declarations?.find(x => {
          // TODO: check whether the sourceFile.fileName resembles the module
          // specifier
          return true;
        });

        if (!declaration) return;

        const [template] = findAllTaggedTemplateNodes(declaration);
        if (template) {
          let node = template;
          if (
            ts.isNoSubstitutionTemplateLiteral(node) ||
            ts.isTemplateExpression(node)
          ) {
            if (ts.isTaggedTemplateExpression(node.parent)) {
              node = node.parent;
            } else {
              return;
            }
          }

          const text = resolveTemplate(
            node,
            node.getSourceFile().fileName,
            info
          ).combinedText;
          try {
            const parsed = parse(text, { noLocation: true });
            if (
              parsed.definitions.every(x => x.kind === Kind.FRAGMENT_DEFINITION)
            ) {
              missingImports.add(`'${exp.name}'`);
            }
          } catch (e) {
            return;
          }
        }
      });

      const missing = Array.from(missingImports);
      if (missing.length) {
        tsDiagnostics.push({
          file: source,
          length: imp.getText().length,
          start: imp.getStart(),
          category: ts.DiagnosticCategory.Message,
          code: MISSING_FRAGMENT_CODE,
          messageText: `Missing Fragment import(s) ${missing.join(
            ', '
          )} from ${imp.moduleSpecifier.getText()}.`,
        });
      }
    });
  }

  return tsDiagnostics;
};

export const getColocatedFragmentNames = (
  source: ts.SourceFile,
  info: ts.server.PluginCreateInfo
): Record<
  string,
  { start: number; length: number; fragments: Array<string> }
> => {
  const imports = findAllImports(source);
  const importSpecifierToFragments: Record<
    string,
    { start: number; length: number; fragments: Array<string> }
  > = {};

  if (imports.length) {
    imports.forEach(imp => {
      if (!imp.importClause) return;

      if (imp.importClause.name) {
        const definitions = info.languageService.getDefinitionAtPosition(
          source.fileName,
          imp.importClause.name.getStart()
        );
        if (definitions && definitions.length) {
          const [def] = definitions;
          if (def.fileName.includes('node_modules')) return;

          const externalSource = getSource(info, def.fileName);
          if (!externalSource) return;

          const fragmentsForImport = getFragmentsInSource(externalSource, info);

          const names = fragmentsForImport.map(fragment => fragment.name.value);
          if (
            names.length &&
            !importSpecifierToFragments[imp.moduleSpecifier.getText()]
          ) {
            importSpecifierToFragments[imp.moduleSpecifier.getText()] = {
              start: imp.moduleSpecifier.getStart(),
              length: imp.moduleSpecifier.getText().length,
              fragments: names,
            };
          } else if (names.length) {
            importSpecifierToFragments[
              imp.moduleSpecifier.getText()
            ].fragments =
              importSpecifierToFragments[
                imp.moduleSpecifier.getText()
              ].fragments.concat(names);
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
        if (definitions && definitions.length) {
          const [def] = definitions;
          if (def.fileName.includes('node_modules')) return;

          const externalSource = getSource(info, def.fileName);
          if (!externalSource) return;

          const fragmentsForImport = getFragmentsInSource(externalSource, info);
          const names = fragmentsForImport.map(fragment => fragment.name.value);
          if (
            names.length &&
            !importSpecifierToFragments[imp.moduleSpecifier.getText()]
          ) {
            importSpecifierToFragments[imp.moduleSpecifier.getText()] = {
              start: imp.moduleSpecifier.getStart(),
              length: imp.moduleSpecifier.getText().length,
              fragments: names,
            };
          } else if (names.length) {
            importSpecifierToFragments[
              imp.moduleSpecifier.getText()
            ].fragments =
              importSpecifierToFragments[
                imp.moduleSpecifier.getText()
              ].fragments.concat(names);
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
          if (definitions && definitions.length) {
            const [def] = definitions;
            if (def.fileName.includes('node_modules')) return;

            const externalSource = getSource(info, def.fileName);
            if (!externalSource) return;

            const fragmentsForImport = getFragmentsInSource(
              externalSource,
              info
            );
            const names = fragmentsForImport.map(
              fragment => fragment.name.value
            );
            if (
              names.length &&
              !importSpecifierToFragments[imp.moduleSpecifier.getText()]
            ) {
              importSpecifierToFragments[imp.moduleSpecifier.getText()] = {
                start: imp.moduleSpecifier.getStart(),
                length: imp.moduleSpecifier.getText().length,
                fragments: names,
              };
            } else if (names.length) {
              importSpecifierToFragments[
                imp.moduleSpecifier.getText()
              ].fragments =
                importSpecifierToFragments[
                  imp.moduleSpecifier.getText()
                ].fragments.concat(names);
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
  info: ts.server.PluginCreateInfo
): Array<FragmentDefinitionNode> {
  let fragments: Array<FragmentDefinitionNode> = [];
  const callExpressions = findAllCallExpressions(src, info, false);

  callExpressions.nodes.forEach(node => {
    const text = resolveTemplate(node, src.fileName, info).combinedText;
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
