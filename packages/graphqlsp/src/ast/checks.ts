import { ts } from '../ts';

export const isIIFE = (node: ts.Node): boolean =>
  ts.isCallExpression(node) &&
  node.arguments.length === 0 &&
  (ts.isFunctionExpression(node.expression) ||
    ts.isArrowFunction(node.expression)) &&
  !node.expression.asteriskToken &&
  !node.expression.modifiers?.length;

export const isTadaGraphQLFunction = (
  node: ts.Node,
  checker: ts.TypeChecker | undefined
): node is ts.LeftHandSideExpression => {
  if (!ts.isLeftHandSideExpression(node)) return false;
  const type = checker?.getTypeAtLocation(node);
  // Any function that has both a `scalar` and `persisted` property
  // is automatically considered a gql.tada graphql() function.
  return (
    type != null &&
    type.getProperty('scalar') != null &&
    type.getProperty('persisted') != null
  );
};

export const isTadaGraphQLCall = (
  node: ts.Node,
  checker: ts.TypeChecker | undefined
): node is ts.CallExpression => {
  // We expect graphql() to be called with either a string literal
  // or a string literal and an array of fragments
  if (!ts.isCallExpression(node)) {
    return false;
  } else if (node.arguments.length < 1 || node.arguments.length > 2) {
    return false;
  } else if (!ts.isStringLiteralLike(node.arguments[0])) {
    return false;
  } else if (!/[{}]/.test(node.arguments[0].getText())) {
    return false;
  }
  return checker ? isTadaGraphQLFunction(node.expression, checker) : false;
};

export const getSchemaName = (
  node: ts.CallExpression,
  typeChecker: ts.TypeChecker | undefined
): string | null => {
  if (!typeChecker) return null;
  const expression = ts.isPropertyAccessExpression(node.expression)
    ? node.expression.expression
    : node.expression;
  const type = typeChecker.getTypeAtLocation(expression);
  if (type) {
    const brandTypeSymbol = type.getProperty('__name');
    if (brandTypeSymbol) {
      const brand = typeChecker.getTypeOfSymbol(brandTypeSymbol);
      if (brand.isUnionOrIntersection()) {
        const found = brand.types.find(x => x.isStringLiteral());
        return found && found.isStringLiteral() ? found.value : null;
      } else if (brand.isStringLiteral()) {
        return brand.value;
      }
    }
  }
  return null;
};
