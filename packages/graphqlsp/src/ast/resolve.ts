import { print } from '@0no-co/graphql.web';
import { ts } from '../ts';
import {
  getDeclarationOfIdentifier,
  getValueOfValueDeclaration,
} from './declaration';

type TemplateResult = {
  combinedText: string;
  isStatic: boolean;
  resolvedSpans: Array<{
    lines: number;
    identifier: string;
    original: { start: number; length: number };
    new: { start: number; length: number };
  }>;
};

export function resolveTemplate(
  node:
    ts.TaggedTemplateExpression | ts.StringLiteralLike | ts.TemplateExpression,
  filename: string,
  info: ts.server.PluginCreateInfo
): TemplateResult {
  if (ts.isStringLiteralLike(node)) {
    return {
      combinedText: node.getText().slice(1, -1),
      isStatic: true,
      resolvedSpans: [],
    };
  }

  if (ts.isTemplateExpression(node)) {
    const typeChecker = info.languageService.getProgram()?.getTypeChecker();
    if (!typeChecker) {
      return { combinedText: '', isStatic: false, resolvedSpans: [] };
    }

    let combinedText = node.head.text;
    let addedCharacters = 0;
    const resolvedSpans: TemplateResult['resolvedSpans'] = [];

    for (const span of node.templateSpans) {
      const expressionType = typeChecker.getTypeAtLocation(span.expression);
      if (!(expressionType.flags & ts.TypeFlags.StringLiteral)) {
        return { combinedText: '', isStatic: false, resolvedSpans: [] };
      }

      const originalStart = span.expression.getStart() - 2;
      const original = {
        start: originalStart,
        length: span.expression.end - originalStart + 1,
      };
      const replacement = (expressionType as ts.StringLiteralType).value;
      resolvedSpans.push({
        lines: replacement.split('\n').length,
        identifier: span.expression.getText(),
        original,
        new: {
          // GraphQL diagnostic offsets are measured from the first character
          // inside the opening backtick, while source spans include it.
          start: original.start - 1 + addedCharacters,
          length: replacement.length,
        },
      });
      addedCharacters += replacement.length - original.length;
      combinedText += replacement + span.literal.text;
    }

    return { combinedText, isStatic: true, resolvedSpans };
  }

  let templateText = node.template.getText().slice(1, -1);
  if (
    ts.isNoSubstitutionTemplateLiteral(node.template) ||
    node.template.templateSpans.length === 0
  ) {
    return { combinedText: templateText, isStatic: true, resolvedSpans: [] };
  }

  let addedCharacters = 0;
  const resolvedSpans = node.template.templateSpans
    .map(span => {
      if (ts.isIdentifier(span.expression)) {
        const typeChecker = info.languageService.getProgram()?.getTypeChecker();
        if (!typeChecker) return;

        const declaration = getDeclarationOfIdentifier(
          span.expression,
          typeChecker
        );
        if (!declaration) return;

        const parent = declaration;
        if (ts.isVariableDeclaration(parent)) {
          const identifierName = span.expression.escapedText;
          const value = getValueOfValueDeclaration(parent);
          if (!value) return;

          // we reduce by two to account for the "${"
          const originalStart = span.expression.getStart() - 2;
          const originalRange = {
            start: originalStart,
            // we add 1 to account for the "}"
            length: span.expression.end - originalStart + 1,
          };

          if (ts.isTaggedTemplateExpression(value)) {
            const text = resolveTemplate(
              value,
              parent.getSourceFile().fileName,
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
            ts.isAsExpression(value) &&
            ts.isTaggedTemplateExpression(value.expression)
          ) {
            const text = resolveTemplate(
              value.expression,
              parent.getSourceFile().fileName,
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
            ts.isAsExpression(value) &&
            ts.isAsExpression(value.expression) &&
            ts.isObjectLiteralExpression(value.expression.expression)
          ) {
            const astObject = JSON.parse(value.expression.expression.getText());
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

  return { combinedText: templateText, isStatic: true, resolvedSpans };
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
