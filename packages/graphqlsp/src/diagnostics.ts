import ts from 'typescript/lib/tsserverlibrary';
import {
  ImportTypeNode,
  isImportTypeNode,
  isNamedImportBindings,
  isNamespaceImport,
  isNoSubstitutionTemplateLiteral,
  isTaggedTemplateExpression,
  isTemplateExpression,
} from 'typescript';
import { Diagnostic, getDiagnostics } from 'graphql-language-service';
import {
  FragmentDefinitionNode,
  GraphQLSchema,
  Kind,
  OperationDefinitionNode,
  parse,
} from 'graphql';

import {
  findAllImports,
  findAllTaggedTemplateNodes,
  getSource,
  isFileDirty,
} from './ast';
import { resolveTemplate } from './ast/resolve';
import { generateTypedDocumentNodes } from './graphql/generateTypes';

export function getGraphQLDiagnostics(
  filename: string,
  baseTypesPath: string,
  schema: { current: GraphQLSchema | null },
  info: ts.server.PluginCreateInfo
): ts.Diagnostic[] | undefined {
  const tagTemplate = info.config.template || 'gql';
  const scalars = info.config.scalars || {};
  const shouldCheckForColocatedFragments =
    info.config.shouldCheckForColocatedFragments || true;

  const source = getSource(info, filename);
  if (!source) return undefined;

  const nodes = findAllTaggedTemplateNodes(source);

  const texts = nodes.map(node => {
    if (isNoSubstitutionTemplateLiteral(node) || isTemplateExpression(node)) {
      if (isTaggedTemplateExpression(node.parent)) {
        node = node.parent;
      } else {
        return undefined;
      }
    }

    return resolveTemplate(node, filename, info);
  });

  const diagnostics = nodes
    .map(x => {
      let node = x;
      if (isNoSubstitutionTemplateLiteral(node) || isTemplateExpression(node)) {
        if (isTaggedTemplateExpression(node.parent)) {
          node = node.parent;
        } else {
          return undefined;
        }
      }

      const text = resolveTemplate(node, filename, info);
      const lines = text.split('\n');

      let startingPosition = node.pos + (tagTemplate.length + 1);
      const graphQLDiagnostics = getDiagnostics(text, schema.current).map(x => {
        const { start, end } = x.range;

        // We add the start.line to account for newline characters which are
        // split out
        let startChar = startingPosition + start.line;
        for (let i = 0; i <= start.line; i++) {
          if (i === start.line) startChar += start.character;
          else startChar += lines[i].length;
        }

        let endChar = startingPosition + end.line;
        for (let i = 0; i <= end.line; i++) {
          if (i === end.line) endChar += end.character;
          else endChar += lines[i].length;
        }

        // We add 1 to the start because the range is exclusive of start.character
        return { ...x, start: startChar + 1, length: endChar - startChar };
      });

      try {
        const parsed = parse(text);

        if (
          parsed.definitions.some(x => x.kind === Kind.OPERATION_DEFINITION)
        ) {
          const op = parsed.definitions.find(
            x => x.kind === Kind.OPERATION_DEFINITION
          ) as OperationDefinitionNode;
          if (!op.name) {
            graphQLDiagnostics.push({
              message: 'Operation needs a name for types to be generated.',
              start: node.pos,
              length: x.getText().length,
              range: {} as any,
              severity: 2,
            } as any);
          }
        }
      } catch (e) {}

      return graphQLDiagnostics;
    })
    .flat()
    .filter(Boolean) as Array<Diagnostic & { length: number; start: number }>;

  const newDiagnostics = diagnostics.map(diag => {
    const result: ts.Diagnostic = {
      file: source,
      length: diag.length,
      start: diag.start,
      category:
        diag.severity === 2
          ? ts.DiagnosticCategory.Warning
          : ts.DiagnosticCategory.Error,
      code: 51001,
      messageText: diag.message.split('\n')[0],
    };

    return result;
  });

  const imports = findAllImports(source);
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
        isNamespaceImport(imp.importClause.namedBindings)
      ) {
        // TODO: we might need to warn here when the fragment is unused as a namespace import
        return;
      } else if (
        imp.importClause.namedBindings &&
        isNamedImportBindings(imp.importClause.namedBindings)
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
              isNoSubstitutionTemplateLiteral(node) ||
              isTemplateExpression(node)
            ) {
              if (isTaggedTemplateExpression(node.parent)) {
                node = node.parent;
              } else {
                return;
              }
            }

            const text = resolveTemplate(
              node,
              node.getSourceFile().fileName,
              info
            );
            const parsed = parse(text);
            if (
              parsed.definitions.every(x => x.kind === Kind.FRAGMENT_DEFINITION)
            ) {
              return `'${exp.name}'`;
            }
          }
        })
        .filter(Boolean);

      if (missingImports.length) {
        // TODO: we could use getCodeFixesAtPosition
        // to build on this
        newDiagnostics.push({
          file: source,
          length: imp.getText().length,
          start: imp.getStart(),
          category: ts.DiagnosticCategory.Message,
          code: 51001,
          messageText: `Missing Fragment import(s) ${missingImports.join(
            ', '
          )} from ${imp.moduleSpecifier.getText()}.`,
        });
      }
    });
  }

  if (
    !newDiagnostics.filter(
      x =>
        x.category === ts.DiagnosticCategory.Error ||
        x.category === ts.DiagnosticCategory.Warning
    ).length
  ) {
    try {
      const parts = source.fileName.split('/');
      const name = parts[parts.length - 1];
      const nameParts = name.split('.');
      nameParts[nameParts.length - 1] = 'generated.ts';
      parts[parts.length - 1] = nameParts.join('.');

      if (isFileDirty(filename, source)) {
        return newDiagnostics;
      }

      generateTypedDocumentNodes(
        schema.current,
        parts.join('/'),
        texts.join('\n'),
        scalars,
        baseTypesPath
      ).then(() => {
        if (isFileDirty(filename, source)) {
          return;
        }

        nodes.forEach((node, i) => {
          const queryText = texts[i] || '';
          const parsed = parse(queryText);
          const isFragment = parsed.definitions.every(
            x => x.kind === Kind.FRAGMENT_DEFINITION
          );
          let name = '';

          if (isFragment) {
            const fragmentNode = parsed
              .definitions[0] as FragmentDefinitionNode;
            name = fragmentNode.name.value;
          } else {
            const operationNode = parsed
              .definitions[0] as OperationDefinitionNode;
            name = operationNode.name?.value || '';
          }

          if (!name) return;

          name = name.charAt(0).toUpperCase() + name.slice(1);
          const parentChildren = node.parent.getChildren();

          const exportName = isFragment
            ? `${name}FragmentDoc`
            : `${name}Document`;
          let imp = ` as typeof import('./${nameParts
            .join('.')
            .replace('.ts', '')}').${exportName}`;

          // This checks whether one of the children is an import-type
          // which is a short-circuit if there is no as
          const typeImport = parentChildren.find(x =>
            isImportTypeNode(x)
          ) as ImportTypeNode;

          if (typeImport && typeImport.getText().includes(exportName)) return;

          const span = { length: 1, start: node.end };

          let text = '';
          if (typeImport) {
            // We only want the oldExportName here to be present
            // that way we can diff its length vs the new one
            const oldExportName = typeImport.getText().split('.').pop();

            // Remove ` as ` from the beginning,
            // this because getText() gives us everything
            // but ` as ` meaning we need to keep that part
            // around.
            imp = imp.slice(4);
            text = source.text.replace(typeImport.getText(), imp);
            span.length =
              imp.length + ((oldExportName || '').length - exportName.length);
          } else {
            text =
              source.text.substring(0, span.start) +
              imp +
              source.text.substring(
                span.start + span.length,
                source.text.length
              );
          }

          const scriptInfo =
            info.project.projectService.getScriptInfo(filename);
          const snapshot = scriptInfo!.getSnapshot();

          source.update(text, { span, newLength: imp.length });
          scriptInfo!.editContent(0, snapshot.getLength(), text);
          info.languageServiceHost.writeFile!(source.fileName, text);
          if (!!typeImport) {
            // To update the types, otherwise data is stale
            scriptInfo!.reloadFromFile();
          }
          scriptInfo!.registerFileUpdate();
        });
      });
    } catch (e) {}
  }

  return newDiagnostics;
}
