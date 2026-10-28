import type { ts } from '../ts';
import type { CompilerModules } from './modules';

/** Creates the subset of the `typescript` (5/6) namespace that GraphQLSP's
 * diagnostics use from the TypeScript 7.1 API's AST modules.
 *
 * @remarks
 * The TypeScript 7.1 API's nodes mirror the shape of TypeScript 5/6's nodes
 * (`kind`, `parent`, `getStart()`, `getText()`, named children, ...), but its
 * `SyntaxKind` values differ (and differ between TypeScript and tsrs too), and
 * a few type guards are missing or were renamed. Enums are therefore always
 * taken from the loaded compiler.
 */
export const createTypeScriptNamespace = (
  modules: CompilerModules
): typeof ts => {
  const { ast, is, sync } = modules;
  const SyntaxKind = ast.SyntaxKind;
  const kindIs =
    (...kinds: number[]) =>
    (node: ts.Node | undefined): boolean =>
      !!node && kinds.includes(node.kind);

  const isFunctionLike = (node: ts.Node | undefined): boolean =>
    !!node &&
    (is.isFunctionLikeDeclaration(node) || is.isSignatureDeclaration(node));

  const namespace = {
    ...is,

    SyntaxKind,
    ScriptElementKind: {
      label: 'label',
      variableElement: 'var',
      constElement: 'const',
      unknown: '',
      memberVariableElement: 'property',
      interfaceElement: 'interface',
      scriptElement: 'script',
    },
    ScriptElementKindModifier: { none: '' },
    flattenDiagnosticMessageText: (message: any, newline: string): string =>
      typeof message === 'string'
        ? message
        : [
            message.messageText,
            ...(message.next || []).map((part: any) =>
              namespace.flattenDiagnosticMessageText(part, newline)
            ),
          ].join(newline),
    getLeadingCommentRanges: ast.getLeadingCommentRanges,
    SymbolFlags: sync.SymbolFlags,
    TypeFlags: sync.TypeFlags,
    DiagnosticCategory: sync.DiagnosticCategory,

    forEachChild: <T>(
      node: ts.Node,
      cbNode: (node: ts.Node) => T | undefined,
      cbNodes?: (nodes: ts.NodeArray<ts.Node>) => T | undefined
    ): T | undefined => (node as any).forEachChild(cbNode, cbNodes),
    idText: (identifier: ts.Identifier | ts.PrivateIdentifier) =>
      identifier.text,

    // Missing from the TypeScript 7.1 API, or renamed
    isStringLiteralLike: kindIs(
      SyntaxKind.StringLiteral,
      SyntaxKind.NoSubstitutionTemplateLiteral
    ),
    isFunctionLike,
    isClassLike: is.isClassLikeDeclaration,
    isObjectLiteralElement: (node: ts.Node | undefined) =>
      !!node &&
      (is.isObjectLiteralElementLike(node) ||
        is.isJsxAttribute(node) ||
        is.isJsxSpreadAttribute(node)),
    isParameter: is.isParameterDeclaration,
    isMethodSignature: is.isMethodSignatureDeclaration,
    isPropertySignature: is.isPropertySignatureDeclaration,
    // TypeScript 7 doesn't have a `CommaListExpression` node
    isCommaListExpression: () => false,
  };

  return namespace as unknown as typeof ts;
};
