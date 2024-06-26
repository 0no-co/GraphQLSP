import { print } from '@0no-co/graphql.web';
import { ts } from '../ts';
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
  node: ts.TaggedTemplateExpression | ts.StringLiteralLike,
  filename: string,
  info: ts.server.PluginCreateInfo
): TemplateResult {
  if (ts.isStringLiteralLike(node)) {
    return { combinedText: node.getText().slice(1, -1), resolvedSpans: [] };
  }

  let templateText = node.template.getText().slice(1, -1);
  if (
    ts.isNoSubstitutionTemplateLiteral(node.template) ||
    node.template.templateSpans.length === 0
  ) {
    return { combinedText: templateText, resolvedSpans: [] };
  }

  let addedCharacters = 0;
  const resolvedSpans = node.template.templateSpans
    .map(span => {
      if (ts.isIdentifier(span.expression)) {
        const definitions = info.languageService.getDefinitionAtPosition(
          filename,
          span.expression.getStart()
        );

        const def = definitions && definitions[0];
        if (!def) return;

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

export const resolveTadaFragmentArray = (
  node: ts.Expression | undefined
): undefined | readonly ts.Identifier[] => {
  if (!node) return undefined;
  // NOTE: Remove `as T`, users may commonly use `as const` for no reason
  while (ts.isAsExpression(node)) node = node.expression;
  if (!ts.isArrayLiteralExpression(node)) return undefined;
  // NOTE: Let's avoid the allocation of another array here if we can
  if (node.elements.every(ts.isIdentifier)) return node.elements;
  const identifiers: ts.Identifier[] = [];
  for (let element of node.elements) {
    while (ts.isPropertyAccessExpression(element)) element = element.name;
    if (ts.isIdentifier(element)) identifiers.push(element);
  }
  return identifiers;
};
