import {
  isAsExpression,
  isIdentifier,
  isNoSubstitutionTemplateLiteral,
  isTaggedTemplateExpression,
  TaggedTemplateExpression,
} from 'typescript';
import ts from 'typescript/lib/tsserverlibrary';
import { findNode } from '.';
import { getSource } from '../ast';

type TemplateResult = {
  combinedText: string;
  resolvedSpans: Array<{
    identifier: string;
    original: { start: number; length: number };
    new: { start: number; length: number };
  }>;
};

export function resolveTemplate(
  node: TaggedTemplateExpression,
  filename: string,
  info: ts.server.PluginCreateInfo
): TemplateResult {
  let templateText = node.template.getText().slice(1, -1);
  if (
    isNoSubstitutionTemplateLiteral(node.template) ||
    node.template.templateSpans.length === 0
  ) {
    return { combinedText: templateText, resolvedSpans: [] };
  }

  let addedCharacters = 0;
  const resolvedSpans = node.template.templateSpans
    .map(span => {
      if (isIdentifier(span.expression)) {
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
          const originalStart = span.expression.getStart();
          const originalRange = {
            start: originalStart,
            length: span.expression.end - originalStart,
          };
          if (
            parent.initializer &&
            isTaggedTemplateExpression(parent.initializer)
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
            isAsExpression(parent.initializer) &&
            isTaggedTemplateExpression(parent.initializer.expression)
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
              identifier: identifierName,
              original: originalRange,
              new: {
                start: originalRange.start + addedCharacters,
                length: text.combinedText.length,
              },
            };
            addedCharacters += text.combinedText.length - originalRange.length;
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
