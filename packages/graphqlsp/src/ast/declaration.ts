import { ts } from '../ts';

export type ValueDeclaration =
  | ts.ArrowFunction
  | ts.BindingElement
  | ts.ClassDeclaration
  | ts.ClassExpression
  | ts.ClassStaticBlockDeclaration
  | ts.ConstructorDeclaration
  | ts.EnumDeclaration
  | ts.EnumMember
  | ts.ExportSpecifier
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.GetAccessorDeclaration
  | ts.JsxAttribute
  | ts.MethodDeclaration
  | ts.ModuleDeclaration
  | ts.ParameterDeclaration
  | ts.PropertyAssignment
  | ts.PropertyDeclaration
  | ts.SetAccessorDeclaration
  | ts.ShorthandPropertyAssignment
  | ts.VariableDeclaration;

/** Checks if a node is a `ts.Declaration` and a value.
 * @remarks
 * This checks if a given node is a value declaration only,
 * excluding import/export specifiers, type declarations, and
 * ambient declarations.
 * All declarations that aren't JS(x) nodes will be discarded.
 * This is based on `ts.isDeclarationKind`.
 */
export function isValueDeclaration(node: ts.Node): node is ValueDeclaration {
  switch (node.kind) {
    case ts.SyntaxKind.ArrowFunction:
    case ts.SyntaxKind.BindingElement:
    case ts.SyntaxKind.ClassDeclaration:
    case ts.SyntaxKind.ClassExpression:
    case ts.SyntaxKind.ClassStaticBlockDeclaration:
    case ts.SyntaxKind.Constructor:
    case ts.SyntaxKind.EnumDeclaration:
    case ts.SyntaxKind.EnumMember:
    case ts.SyntaxKind.FunctionDeclaration:
    case ts.SyntaxKind.FunctionExpression:
    case ts.SyntaxKind.GetAccessor:
    case ts.SyntaxKind.JsxAttribute:
    case ts.SyntaxKind.MethodDeclaration:
    case ts.SyntaxKind.Parameter:
    case ts.SyntaxKind.PropertyAssignment:
    case ts.SyntaxKind.PropertyDeclaration:
    case ts.SyntaxKind.SetAccessor:
    case ts.SyntaxKind.ShorthandPropertyAssignment:
    case ts.SyntaxKind.VariableDeclaration:
      return true;
    default:
      return false;
  }
}

function climbPastPropertyOrElementAccess(node: ts.Node): ts.Node {
  if (
    node.parent &&
    ts.isPropertyAccessExpression(node.parent) &&
    node.parent.name === node
  ) {
    return node.parent;
  } else if (
    node.parent &&
    ts.isElementAccessExpression(node.parent) &&
    node.parent.argumentExpression === node
  ) {
    return node.parent;
  } else {
    return node;
  }
}

function isNewExpressionTarget(node: ts.Node): node is ts.NewExpression {
  const target = climbPastPropertyOrElementAccess(node).parent;
  return ts.isNewExpression(target) && target.expression === node;
}

function isCallOrNewExpressionTarget(
  node: ts.Node
): node is ts.CallExpression | ts.NewExpression {
  const target = climbPastPropertyOrElementAccess(node).parent;
  return ts.isCallOrNewExpression(target) && target.expression === node;
}

function isNameOfFunctionDeclaration(node: ts.Node): boolean {
  return (
    ts.isIdentifier(node) &&
    node.parent &&
    ts.isFunctionLike(node.parent) &&
    node.parent.name === node
  );
}

function getNameFromPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isComputedPropertyName(name)) {
    return ts.isStringLiteralLike(name.expression) ||
      ts.isNumericLiteral(name.expression)
      ? name.expression.text
      : undefined;
  } else if (ts.isPrivateIdentifier(name) || ts.isMemberName(name)) {
    return ts.idText(name);
  } else {
    return name.text;
  }
}

/** Resolves the declaration of an identifier.
 * @remarks
 * This returns the declaration node first found for an identifier by resolving an identifier's
 * symbol via the type checker.
 * @privateRemarks
 * This mirrors the implementation of `getDefinitionAtPosition` in TS' language service. However,
 * it removes all cases that aren't applicable to identifiers and removes the intermediary positional
 * data structure, instead returning raw AST nodes.
 */
export function getDeclarationOfIdentifier(
  node: ts.Identifier,
  checker: ts.TypeChecker
): ts.Declaration | undefined {
  let symbol = checker.getSymbolAtLocation(node);
  if (
    symbol?.declarations?.[0] &&
    symbol.flags & ts.SymbolFlags.Alias &&
    (node.parent === symbol?.declarations?.[0] ||
      !ts.isNamespaceImport(symbol.declarations[0]))
  ) {
    // Resolve alias symbols, excluding self-referential symbols
    const aliased = checker.getAliasedSymbol(symbol);
    if (aliased.declarations) symbol = aliased;
  }

  if (
    symbol &&
    node.parent.kind === ts.SyntaxKind.ShorthandPropertyAssignment
  ) {
    // Resolve shorthand property assignments
    const shorthandSymbol = checker.getShorthandAssignmentValueSymbol(
      symbol.valueDeclaration
    );
    return shorthandSymbol?.declarations?.[0];
  } else if (
    ts.isPropertyName(node) &&
    ts.isBindingElement(node.parent) &&
    ts.isObjectBindingPattern(node.parent.parent) &&
    node === (node.parent.propertyName || node.parent.name)
  ) {
    // Resolve symbol of property in shorthand assignments
    const name = getNameFromPropertyName(node);
    const prop = name
      ? checker.getTypeAtLocation(node.parent.parent).getProperty(name)
      : undefined;
    if (prop) symbol = prop;
  } else if (
    ts.isObjectLiteralElement(node.parent) &&
    (ts.isObjectLiteralExpression(node.parent.parent) ||
      ts.isJsxAttributes(node.parent.parent)) &&
    node.parent.name === node
  ) {
    // Resolve symbol of property in object literal destructre expressions
    const name = getNameFromPropertyName(node);
    const prop = name
      ? checker.getContextualType(node.parent.parent)?.getProperty(name)
      : undefined;
    if (prop) symbol = prop;
  }

  if (symbol && symbol.declarations?.length) {
    if (
      symbol.flags & ts.SymbolFlags.Class &&
      !(symbol.flags & (ts.SymbolFlags.Function | ts.SymbolFlags.Variable)) &&
      isNewExpressionTarget(node)
    ) {
      // Resolve first class-like declaration for new expressions
      for (const declaration of symbol.declarations) {
        if (ts.isClassLike(declaration)) return declaration;
      }
    } else if (
      isCallOrNewExpressionTarget(node) ||
      isNameOfFunctionDeclaration(node)
    ) {
      // Resolve first function-like declaration for call expressions or named functions
      for (const declaration of symbol.declarations) {
        if (
          ts.isFunctionLike(declaration) &&
          !!(declaration as ts.FunctionLikeDeclaration).body
        )
          return declaration;
      }
    }

    // Only use value declarations if they're not type/ambient declarations or imports/exports
    if (symbol.valueDeclaration && isValueDeclaration(symbol.valueDeclaration))
      return symbol.valueDeclaration;
    for (const declaration of symbol.declarations)
      if (isValueDeclaration(declaration)) return declaration;
  }

  return undefined;
}
