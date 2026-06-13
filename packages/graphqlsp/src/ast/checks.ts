import { ts } from '../ts';
import { templates } from './templates';

/** Checks for an immediately-invoked function expression */
export const isIIFE = (node: ts.Node): boolean =>
  ts.isCallExpression(node) &&
  node.arguments.length === 0 &&
  (ts.isFunctionExpression(node.expression) ||
    ts.isArrowFunction(node.expression)) &&
  !node.expression.asteriskToken &&
  !node.expression.modifiers?.length;

/** Checks if node is a known identifier of graphql functions ('graphql' or 'gql') */
export const isGraphQLFunctionIdentifier = (
  node: ts.Node
): node is ts.Identifier =>
  ts.isIdentifier(node) && templates.has(node.escapedText as string);

// The verdicts of the type probes below never change for a given function
// within one program, but are requested once per call site. Caching them per
// symbol turns the type checker work from one probe per call site into one
// per distinct callee. Keying by checker makes invalidation automatic, since
// a new program comes with a new checker.
const tadaFunctionCache = new WeakMap<
  ts.TypeChecker,
  WeakMap<ts.Symbol, boolean>
>();

const schemaNameCache = new WeakMap<
  ts.TypeChecker,
  WeakMap<ts.Symbol, string | null>
>();

const getCached = <T>(
  caches: WeakMap<ts.TypeChecker, WeakMap<ts.Symbol, T>>,
  checker: ts.TypeChecker,
  node: ts.Node,
  compute: () => T
): T => {
  const symbol = checker.getSymbolAtLocation(node);
  if (!symbol) return compute();
  let cache = caches.get(checker);
  if (!cache) caches.set(checker, (cache = new WeakMap()));
  let result = cache.get(symbol);
  if (result === undefined) cache.set(symbol, (result = compute()));
  return result;
};

/** If `checker` is passed, checks if node (as identifier/expression) is a gql.tada graphql() function */
export const isTadaGraphQLFunction = (
  node: ts.Node,
  checker: ts.TypeChecker | undefined
): node is ts.LeftHandSideExpression => {
  if (!ts.isLeftHandSideExpression(node) || !checker) return false;
  return getCached(tadaFunctionCache, checker, node, () => {
    const type = checker.getTypeAtLocation(node);
    // Any function that has both a `scalar` and `persisted` property
    // is automatically considered a gql.tada graphql() function.
    return (
      type != null &&
      type.getProperty('scalar') != null &&
      type.getProperty('persisted') != null
    );
  });
};

// A GraphQL document may only start with `{` or a definition keyword, after
// ignored tokens (whitespace, commas, comments, BOM \u2014 all covered by `\s` and
// `,`). The keyword must be followed by a token break rather than name or
// punctuator characters, so that strings like 'query.results' or 'fragments-2'
// don't match. Strings that don't match are rejected before the type probes
// above ever run, since any call with a string-ish first argument
// (translations, test titles, event names) would otherwise resolve its
// callee's type.
const graphqlDocumentPrefix =
  /^(?:[\s,]+|#[^\n\r]*)*(?:\{|(?:query|mutation|subscription|fragment)(?=[\s,{(@#]|$))/;

/** If `checker` is passed, checks if node is a gql.tada graphql() call */
export const isTadaGraphQLCall = (
  node: ts.CallExpression,
  checker: ts.TypeChecker | undefined
): boolean => {
  // We expect graphql() to be called with either a string literal
  // or a string literal and an array of fragments
  if (!ts.isCallExpression(node)) {
    return false;
  } else if (node.arguments.length < 1 || node.arguments.length > 2) {
    return false;
  } else if (!ts.isStringLiteralLike(node.arguments[0]!)) {
    return false;
  } else if (!graphqlDocumentPrefix.test(node.arguments[0]!.text)) {
    return false;
  }
  return checker ? isTadaGraphQLFunction(node.expression, checker) : false;
};

/** Checks if node is a gql.tada graphql.persisted() call */
export const isTadaPersistedCall = (
  node: ts.Node | undefined,
  checker: ts.TypeChecker | undefined
): node is ts.CallExpression => {
  if (!node) {
    return false;
  } else if (!ts.isCallExpression(node)) {
    return false;
  } else if (!ts.isPropertyAccessExpression(node.expression)) {
    return false; // rejecting non property access calls: <expression>.<name>()
  } else if (
    !ts.isIdentifier(node.expression.name) ||
    node.expression.name.escapedText !== 'persisted'
  ) {
    return false; // rejecting calls on anyting but 'persisted': <expression>.persisted()
  } else if (isGraphQLFunctionIdentifier(node.expression.expression)) {
    return true;
  } else {
    return isTadaGraphQLFunction(node.expression.expression, checker);
  }
};

// As per check in `isGraphQLCall()` below, enforces arguments length
export type GraphQLCallNode = ts.CallExpression & {
  arguments: [ts.Expression] | [ts.Expression, ts.Expression];
};

/** Checks if node is a gql.tada or regular graphql() call */
export const isGraphQLCall = (
  node: ts.Node,
  checker: ts.TypeChecker | undefined
): node is GraphQLCallNode => {
  return (
    ts.isCallExpression(node) &&
    node.arguments.length >= 1 &&
    node.arguments.length <= 2 &&
    (isGraphQLFunctionIdentifier(node.expression) ||
      isTadaGraphQLCall(node, checker))
  );
};

/** Checks if node is a gql/graphql tagged template literal */
export const isGraphQLTag = (
  node: ts.Node
): node is ts.TaggedTemplateExpression =>
  ts.isTaggedTemplateExpression(node) && isGraphQLFunctionIdentifier(node.tag);

/** Retrieves the `__name` branded tag from gql.tada `graphql()` or `graphql.persisted()` calls */
export const getSchemaName = (
  node: ts.CallExpression,
  typeChecker: ts.TypeChecker | undefined,
  isTadaPersistedCall = false
): string | null => {
  if (!typeChecker) return null;
  // When calling `graphql.persisted`, we need to access the `graphql` part of
  // the expression; `node.expression` is the `.persisted` part
  const expression = isTadaPersistedCall
    ? node.getChildAt(0).getChildAt(0)
    : node.expression;
  return getCached(schemaNameCache, typeChecker, expression, () => {
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
  });
};
