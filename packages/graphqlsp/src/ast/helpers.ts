import { parse } from '@0no-co/graphql.web';
import { ts } from '../ts';
import * as checks from './checks';
import { SchemaRef } from '../graphql/getSchema';
import { resolveTemplate } from './resolve';
import { getToken } from './token';

/**
 * Finds the first parent node matching the given predicate, with optional stop condition
 */
export function findParentNodeOfType<T extends ts.Node>(
  node: ts.Node,
  predicate: (n: ts.Node) => n is T,
  stopCondition?: (n: ts.Node) => boolean
): T | undefined {
  let current = node.parent;
  const seen = new Set<ts.Node>();

  while (current && !seen.has(current)) {
    seen.add(current);

    if (stopCondition && stopCondition(current)) {
      return undefined;
    }

    if (predicate(current)) {
      return current;
    }

    current = current.parent;
  }

  return undefined;
}

/**
 * Finds the first parent node of a specific TypeScript node kind
 */
export function findParentOfKind(
  node: ts.Node,
  kind: ts.SyntaxKind,
  stopCondition?: (n: ts.Node) => boolean
): ts.Node | undefined {
  return findParentNodeOfType(
    node,
    (n): n is ts.Node => n.kind === kind,
    stopCondition
  );
}

/**
 * Finds the nearest variable declaration parent
 */
export function findVariableDeclaration(
  node: ts.Node
): ts.VariableDeclaration | undefined {
  return findParentNodeOfType(
    node,
    ts.isVariableDeclaration,
    // Stop if we hit a block scope (new function/module)
    n => ts.isBlock(n)
  );
}

/**
 * Finds the nearest call expression parent
 */
export function findCallExpression(
  node: ts.Node
): ts.CallExpression | undefined {
  return findParentNodeOfType(node, ts.isCallExpression);
}

/**
 * Unwraps union/intersection types to find the first object type
 */
export function unwrapToObjectType(type: ts.Type): ts.Type {
  return type.isUnionOrIntersection()
    ? type.types.find(t => t.flags & ts.TypeFlags.Object) || type
    : type;
}

/**
 * Unwraps nested AsExpression nodes to get the inner expression
 */
export function unwrapAsExpression<T extends ts.Expression>(
  node: T
): ts.Expression {
  let current: ts.Expression = node;
  while (ts.isAsExpression(current)) {
    current = current.expression;
  }
  return current;
}

/**
 * Resolves the appropriate schema for a given GraphQL node
 */
export function resolveSchemaForNode(
  node: ts.CallExpression,
  schema: SchemaRef,
  typeChecker?: ts.TypeChecker
) {
  const schemaName = checks.getSchemaName(node, typeChecker);
  return schemaName && schema.multi[schemaName]
    ? schema.multi[schemaName]?.schema
    : schema.current?.schema;
}

/**
 * Resolves template with cursor position adjustment for resolved spans
 */
export function resolveTemplateWithCursor(
  template: ts.TemplateLiteral,
  filename: string,
  cursorPosition: number,
  info: ts.server.PluginCreateInfo
) {
  const foundToken = getToken(template, cursorPosition);
  if (!foundToken) {
    return {
      combinedText: '',
      resolvedSpans: [],
      foundToken: undefined,
      amountOfLines: 0,
    };
  }

  const { combinedText, resolvedSpans } = resolveTemplate(
    { template } as ts.TaggedTemplateExpression,
    filename,
    info
  );

  // Calculate line offset from resolved spans
  const amountOfLines = resolvedSpans
    .filter(
      x =>
        x.original.start < cursorPosition &&
        x.original.start + x.original.length < cursorPosition
    )
    .reduce((acc, span) => acc + (span.lines - 1), 0);

  // Adjust token line position
  foundToken.line = foundToken.line + amountOfLines;

  return {
    combinedText,
    resolvedSpans,
    foundToken,
    amountOfLines,
  };
}

/**
 * Generic node bubbling function that can handle multiple predicates
 */
export function bubbleUpNode(
  node: ts.Node,
  predicates: Array<(n: ts.Node) => boolean>
): ts.Node {
  let current = node;
  while (current.parent && predicates.some(predicate => predicate(current))) {
    current = current.parent;
  }
  return current;
}

/**
 * Safe GraphQL parsing with error handling
 */
export function safeParseGraphQL(
  text: string,
  options?: { noLocation?: boolean }
): any | null {
  try {
    return parse(text, options || {});
  } catch (e) {
    return null;
  }
}
