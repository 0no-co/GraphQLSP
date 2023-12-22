import ts from 'typescript/lib/tsserverlibrary';
import { Kind, parse } from 'graphql';

import { findAllImports, findAllTaggedTemplateNodes } from './ast';
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

      const missingImports = moduleExports
        .map(exp => {
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
                parsed.definitions.every(
                  x => x.kind === Kind.FRAGMENT_DEFINITION
                )
              ) {
                return `'${exp.name}'`;
              }
            } catch (e) {
              return;
            }
          }
        })
        .filter(Boolean);

      if (missingImports.length) {
        tsDiagnostics.push({
          file: source,
          length: imp.getText().length,
          start: imp.getStart(),
          category: ts.DiagnosticCategory.Message,
          code: MISSING_FRAGMENT_CODE,
          messageText: `Missing Fragment import(s) ${missingImports.join(
            ', '
          )} from ${imp.moduleSpecifier.getText()}.`,
        });
      }
    });
  }

  return tsDiagnostics;
};
