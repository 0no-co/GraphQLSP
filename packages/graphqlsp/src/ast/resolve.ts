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

export function resolveTemplate(
  node: TaggedTemplateExpression,
  filename: string,
  info: ts.server.PluginCreateInfo
): string {
  let templateText = node.template.getText().slice(1, -1);
  if (
    isNoSubstitutionTemplateLiteral(node.template) ||
    node.template.templateSpans.length === 0
  ) {
    return templateText;
  }

  node.template.templateSpans.forEach(span => {
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
        if (
          parent.initializer &&
          isTaggedTemplateExpression(parent.initializer)
        ) {
          const text = resolveTemplate(parent.initializer, def.fileName, info);
          templateText = templateText.replace(
            '${' + span.expression.escapedText + '}',
            text
          );
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
            text
          );
        }
      }
    }
  });

  return templateText;
}
