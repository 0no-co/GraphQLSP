import { print } from 'graphql';
import ts from 'typescript/lib/tsserverlibrary';
import { findNode } from '.';
import { getSource } from '../ast';

type TemplateResult = {
  combinedText: string;
  resolvedSpans: Array<{
    lines: number;
    identifier: string;
    original: { start: number; length: number };
    new: { start: number; length: number };
  }>;
};

export function resolveTemplate(
  node:
    | ts.TaggedTemplateExpression
    | ts.NoSubstitutionTemplateLiteral
    | ts.TemplateExpression,
  filename: string,
  info: ts.server.PluginCreateInfo
): TemplateResult {
  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return { combinedText: node.getText().slice(1, -1), resolvedSpans: [] };
  }

  let templateText = ts.isTemplateExpression(node)
    ? node.getText().slice(1, -1)
    : node.template.getText().slice(1, -1);
  if (
    ts.isTaggedTemplateExpression(node) &&
    (ts.isNoSubstitutionTemplateLiteral(node.template) ||
      node.template.templateSpans.length === 0)
  ) {
    return { combinedText: templateText, resolvedSpans: [] };
  }

  let addedCharacters = 0;
  const resolvedSpans = (
    ts.isTemplateExpression(node)
      ? node.templateSpans
      : (node.template as any).templateSpans
  )
    .map((span: ts.TemplateSpan) => {
      if (ts.isIdentifier(span.expression)) {
        const definitions = info.languageService.getDefinitionAtPosition(
          filename,
          span.expression.getStart()
        );
        if (!definitions) return;

        const def = definitions[0];
        const src = getSource(info, def.fileName);
        if (!src) return;

        const node = findNode(src, def.textSpan.start);
        if (!node || !node.parent) return;

        const parent = node.parent;
        if (ts.isVariableDeclaration(parent)) {
          const identifierName = span.expression.escapedText;
          // we reduce by two to account for the "${"
          const originalStart = span.expression.getStart() - 2;
          const originalRange = {
            start: originalStart,
            // we add 1 to account for the "}"
            length: span.expression.end - originalStart + 1,
          };
          if (
            parent.initializer &&
            ts.isTaggedTemplateExpression(parent.initializer)
          ) {
            const text = resolveTemplate(
              parent.initializer,
              def.fileName,
              info
            );
            templateText = templateText.replace(
              '${' + span.expression.escapedText + '}',
              text.combinedText
            );

            const alteredSpan = {
              lines: text.combinedText.split('\n').length,
              identifier: identifierName,
              original: originalRange,
              new: {
                start: originalRange.start + addedCharacters,
                length: text.combinedText.length,
              },
            };
            addedCharacters += text.combinedText.length - originalRange.length;
            return alteredSpan;
          } else if (
            parent.initializer &&
            ts.isAsExpression(parent.initializer) &&
            ts.isTaggedTemplateExpression(parent.initializer.expression)
          ) {
            const text = resolveTemplate(
              parent.initializer.expression,
              def.fileName,
              info
            );
            templateText = templateText.replace(
              '${' + span.expression.escapedText + '}',
              text.combinedText
            );
            const alteredSpan = {
              lines: text.combinedText.split('\n').length,
              identifier: identifierName,
              original: originalRange,
              new: {
                start: originalRange.start + addedCharacters,
                length: text.combinedText.length,
              },
            };
            addedCharacters += text.combinedText.length - originalRange.length;
            return alteredSpan;
          } else if (
            parent.initializer &&
            ts.isAsExpression(parent.initializer) &&
            ts.isAsExpression(parent.initializer.expression) &&
            ts.isObjectLiteralExpression(
              parent.initializer.expression.expression
            )
          ) {
            const astObject = JSON.parse(
              parent.initializer.expression.expression.getText()
            );
            const resolvedTemplate = print(astObject);
            templateText = templateText.replace(
              '${' + span.expression.escapedText + '}',
              resolvedTemplate
            );
            const alteredSpan = {
              lines: resolvedTemplate.split('\n').length,
              identifier: identifierName,
              original: originalRange,
              new: {
                start: originalRange.start + addedCharacters,
                length: resolvedTemplate.length,
              },
            };
            addedCharacters += resolvedTemplate.length - originalRange.length;
            return alteredSpan;
          }

          return undefined;
        }
      }

      return undefined;
    })
    .filter(Boolean) as TemplateResult['resolvedSpans'];

  return { combinedText: templateText, resolvedSpans };
}
