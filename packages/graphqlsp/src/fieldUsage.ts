import { ts } from './ts';
import { parse, visit } from 'graphql';

import { getValueOfIdentifier } from './ast/declaration';

export const UNUSED_FIELD_CODE = 52005;

const unwrapAbstractType = (type: ts.Type) => {
  return type.isUnionOrIntersection()
    ? type.types.find(type => type.flags & ts.TypeFlags.Object) || type
    : type;
};

const getVariableDeclaration = (
  start: ts.Node
): ts.VariableDeclaration | undefined => {
  let node: ts.Node = start;
  const seen = new Set();
  while (node.parent && !seen.has(node)) {
    seen.add(node);
    if (ts.isBlock(node)) {
      return; // NOTE: We never want to traverse up into a new function/module block
    } else if (ts.isVariableDeclaration((node = node.parent))) {
      return node;
    }
  }
};

const arrayMethods = new Set([
  'map',
  'filter',
  'forEach',
  'reduce',
  'every',
  'some',
  'find',
  'flatMap',
  'sort',
]);

/** A node in the selection-set trie of a single GraphQL document.
 * Keys are the response-shape keys, i.e. the alias when one is present. */
interface TrieNode {
  id: number;
  children: Map<string, TrieNode>;
  isLeaf: boolean;
  used: boolean;
}

interface DocumentState {
  root: TrieNode;
  /** Leaf-paths in document order, used to keep diagnostic ordering stable. */
  allPaths: string[];
  leafByPath: Map<string, TrieNode>;
  fieldToLoc: Map<string, { start: number; length: number }>;
  templateNode: ts.NoSubstitutionTemplateLiteral;
  /** Number of terminal accesses we saw; no access means the result is
   * consumed elsewhere (other files) and we stay silent. */
  accessCount: number;
}

/** A tracked binding: occurrences of `symbol` represent the data at trie
 * position `node` of document `doc`. */
interface Entry {
  symbol: ts.Symbol;
  node: TrieNode;
  doc: DocumentState;
  /** Set for array-method callback params; returning from those callbacks
   * is not an escape of the data (`list.map(x => x.field)`). */
  suppressReturnBail: boolean;
}

/** Resolves the data-type of a document, either from internally resolved
 * type-arguments or through the `__apiType` call-signature. */
const resolveDataType = (
  node: ts.Node,
  checker: ts.TypeChecker
): ts.Type | undefined => {
  let dataType: ts.Type | undefined;

  const type = checker.getTypeAtLocation(node.parent) as
    | ts.TypeReference
    | ts.Type;
  // Attempt to retrieve type from internally resolve type arguments
  if ('target' in type) {
    const typeArguments = (type as any)
      .resolvedTypeArguments as readonly ts.Type[];
    dataType =
      typeArguments && typeArguments.length > 1 ? typeArguments[0] : undefined;
  }
  // Fallback to resolving the type from scratch
  if (!dataType) {
    const apiTypeSymbol = type.getProperty('__apiType');
    if (apiTypeSymbol) {
      let apiType = checker.getTypeOfSymbol(apiTypeSymbol);
      let callSignature: ts.Signature | undefined = type.getCallSignatures()[0];
      if (apiType.isUnionOrIntersection()) {
        for (const type of apiType.types) {
          callSignature = type.getCallSignatures()[0];
          if (callSignature) {
            dataType = callSignature.getReturnType();
            break;
          }
        }
      }
      dataType = callSignature && callSignature.getReturnType();
    }
  }

  return dataType;
};

export const checkFieldUsageInFile = (
  source: ts.SourceFile,
  nodes: ts.NoSubstitutionTemplateLiteral[],
  info: ts.server.PluginCreateInfo
) => {
  const diagnostics: ts.Diagnostic[] = [];
  const shouldTrackFieldUsage = info.config.trackFieldUsage ?? true;
  if (!shouldTrackFieldUsage) return diagnostics;

  const defaultReservedKeys = ['id', '_id', '__typename'];
  const additionalKeys = info.config.reservedKeys ?? [];
  const reservedKeys = new Set([...defaultReservedKeys, ...additionalKeys]);
  const checker = info.languageService.getProgram()?.getTypeChecker();
  if (!checker) return;

  try {
    let trieId = 0;
    const makeTrieNode = (isLeaf: boolean): TrieNode => ({
      id: trieId++,
      children: new Map(),
      isLeaf,
      used: false,
    });

    // Phase A: collect the selection-set trie for every document in the file
    const docStates: DocumentState[] = [];
    for (const node of nodes) {
      const nodeText = node.getText();
      // Bailing for mutations/subscriptions as these could have small details
      // for normalised cache interactions
      if (nodeText.includes('mutation') || nodeText.includes('subscription'))
        continue;

      let document;
      try {
        document = parse(nodeText.slice(1, -1));
      } catch (_e) {
        continue;
      }

      const root = makeTrieNode(false);
      const allPaths: string[] = [];
      const leafByPath = new Map<string, TrieNode>();
      const fieldToLoc = new Map<string, { start: number; length: number }>();
      const inProgress: string[] = [];
      const trieStack: TrieNode[] = [root];
      // This visitor gets all the leaf-paths in the document
      // as well as all fields that are part of the document.
      // We need the leaf-paths to check usage and the trie to
      // resolve whether an access on a given reference is valid
      // for the current document...
      visit(document, {
        Field: {
          enter(fieldNode) {
            const alias = fieldNode.alias
              ? fieldNode.alias.value
              : fieldNode.name.value;
            const path = inProgress.length
              ? `${inProgress.join('.')}.${alias}`
              : alias;
            const parent = trieStack[trieStack.length - 1];

            if (
              !fieldNode.selectionSet &&
              !reservedKeys.has(fieldNode.name.value)
            ) {
              allPaths.push(path);
              fieldToLoc.set(path, {
                start: fieldNode.name.loc!.start,
                length: fieldNode.name.loc!.end - fieldNode.name.loc!.start,
              });
              let trieNode = parent.children.get(alias);
              if (!trieNode) {
                parent.children.set(alias, (trieNode = makeTrieNode(true)));
              } else {
                trieNode.isLeaf = true;
              }
              leafByPath.set(path, trieNode);
            } else if (fieldNode.selectionSet) {
              inProgress.push(alias);
              fieldToLoc.set(path, {
                start: fieldNode.name.loc!.start,
                length: fieldNode.name.loc!.end - fieldNode.name.loc!.start,
              });
              let trieNode = parent.children.get(alias);
              if (!trieNode) {
                parent.children.set(alias, (trieNode = makeTrieNode(false)));
              }
              trieStack.push(trieNode);
            }
          },
          leave(fieldNode) {
            if (fieldNode.selectionSet) {
              inProgress.pop();
              trieStack.pop();
            }
          },
        },
      });

      docStates.push({
        root,
        allPaths,
        leafByPath,
        fieldToLoc,
        templateNode: node,
        accessCount: 0,
      });
    }

    if (!docStates.length) return diagnostics;

    // Phase B1: one pass over the file collecting identifier occurrences by
    // name (value positions only) and call-initialized declarations. This
    // replaces per-binding find-all-references searches.
    const identifiersByName = new Map<string, ts.Identifier[]>();
    const callInitializedDecls: ts.VariableDeclaration[] = [];
    const indexWalk = (node: ts.Node) => {
      if (ts.isTypeNode(node)) return;

      if (ts.isIdentifier(node)) {
        const parent = node.parent;
        // Skip declaration names (a declaration is not a use of itself)
        // and property-name positions (they resolve to unrelated symbols).
        const isDeclarationName =
          parent &&
          (ts.isVariableDeclaration(parent) ||
            ts.isBindingElement(parent) ||
            ts.isParameter(parent) ||
            ts.isFunctionDeclaration(parent) ||
            ts.isFunctionExpression(parent) ||
            ts.isClassDeclaration(parent) ||
            ts.isImportSpecifier(parent) ||
            ts.isImportClause(parent) ||
            ts.isNamespaceImport(parent) ||
            ts.isExportSpecifier(parent)) &&
          parent.name === node;
        const isPropertyName =
          parent &&
          ((ts.isPropertyAccessExpression(parent) && parent.name === node) ||
            (ts.isQualifiedName(parent) && parent.right === node) ||
            (ts.isPropertyAssignment(parent) && parent.name === node) ||
            (ts.isBindingElement(parent) && parent.propertyName === node) ||
            (ts.isJsxAttribute(parent) && parent.name === node) ||
            (ts.isPropertyDeclaration(parent) && parent.name === node) ||
            (ts.isMethodDeclaration(parent) && parent.name === node) ||
            (ts.isPropertySignature(parent) && parent.name === node) ||
            (ts.isMethodSignature(parent) && parent.name === node) ||
            (ts.isEnumMember(parent) && parent.name === node));
        if (!isDeclarationName && !isPropertyName) {
          let list = identifiersByName.get(node.text);
          if (!list) identifiersByName.set(node.text, (list = []));
          list.push(node);
        }
        return;
      }

      if (ts.isVariableDeclaration(node) && node.initializer) {
        let init: ts.Expression = node.initializer;
        while (
          ts.isParenthesizedExpression(init) ||
          ts.isAwaitExpression(init) ||
          ts.isNonNullExpression(init) ||
          ts.isAsExpression(init)
        ) {
          init = init.expression;
        }
        if (ts.isCallExpression(init)) callInitializedDecls.push(node);
      }

      ts.forEachChild(node, indexWalk);
    };
    indexWalk(source);

    const symbolCache = new Map<ts.Identifier, ts.Symbol | undefined>();
    const getRefSymbol = (id: ts.Identifier): ts.Symbol | undefined => {
      if (symbolCache.has(id)) return symbolCache.get(id);
      const sym =
        ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id
          ? checker.getShorthandAssignmentValueSymbol(id.parent)
          : checker.getSymbolAtLocation(id);
      symbolCache.set(id, sym);
      return sym;
    };

    // Phase B2: the tracker holds bindings whose occurrences we still have to
    // visit. The seen-set makes the worklist converge on alias cycles.
    const queue: Entry[] = [];
    const seenEntries = new Map<ts.Symbol, Set<string>>();
    const addEntry = (
      symbol: ts.Symbol | undefined,
      node: TrieNode,
      doc: DocumentState,
      suppressReturnBail: boolean
    ) => {
      if (!symbol) return;
      let keys = seenEntries.get(symbol);
      if (!keys) seenEntries.set(symbol, (keys = new Set()));
      const key = `${node.id}${suppressReturnBail ? 's' : ''}`;
      if (keys.has(key)) return;
      keys.add(key);
      queue.push({ symbol, node, doc, suppressReturnBail });
    };

    /** Registers a binding-name at a trie position: identifiers become
     * tracked entries, destructuring patterns descend through the trie.
     * Keys that aren't part of the document (`data`, tuple wrappers) are
     * passed through without descending. */
    const trackBinding = (
      name: ts.BindingName,
      trieNode: TrieNode,
      doc: DocumentState,
      suppressReturnBail: boolean
    ) => {
      if (ts.isIdentifier(name)) {
        addEntry(
          checker.getSymbolAtLocation(name),
          trieNode,
          doc,
          suppressReturnBail
        );
      } else if (ts.isObjectBindingPattern(name)) {
        for (const element of name.elements) {
          let key: string | undefined;
          if (element.propertyName) {
            if (
              ts.isIdentifier(element.propertyName) ||
              ts.isStringLiteral(element.propertyName)
            ) {
              key = element.propertyName.text;
            }
          } else if (ts.isIdentifier(element.name)) {
            key = element.name.text;
          }
          const next = (key && trieNode.children.get(key)) || trieNode;
          trackBinding(element.name, next, doc, suppressReturnBail);
        }
      } else {
        for (const element of name.elements) {
          if (ts.isOmittedExpression(element)) continue;
          // Array/tuple wrappers don't influence the field path
          trackBinding(element.name, trieNode, doc, suppressReturnBail);
        }
      }
    };

    const markSubtreeUsed = (trieNode: TrieNode) => {
      for (const child of trieNode.children.values()) {
        child.used = true;
        markSubtreeUsed(child);
      }
    };

    /** Seeds the callbacks of an array-method chain
     * (`x.filter(a => ...).map(b => ...)`) and, when the chain result is
     * assigned, tracks that binding at the same trie position. */
    const handleArrayChain = (
      firstCall: ts.CallExpression,
      firstMethod: string,
      trieNode: TrieNode,
      doc: DocumentState
    ) => {
      let call = firstCall;
      while (true) {
        const method = (call.expression as ts.PropertyAccessExpression).name
          .text;
        let func: ts.Node | undefined = call.arguments[0];
        if (func && ts.isIdentifier(func)) {
          const value = getValueOfIdentifier(func, checker);
          if (
            value &&
            (ts.isFunctionDeclaration(value) ||
              ts.isFunctionExpression(value) ||
              ts.isArrowFunction(value))
          ) {
            func = value;
          }
        }
        if (
          func &&
          (ts.isFunctionDeclaration(func) ||
            ts.isFunctionExpression(func) ||
            ts.isArrowFunction(func))
        ) {
          const param = func.parameters[method === 'reduce' ? 1 : 0];
          if (param) trackBinding(param.name, trieNode, doc, true);
        }

        const access = call.parent;
        if (
          ts.isPropertyAccessExpression(access) &&
          access.expression === call &&
          arrayMethods.has(access.name.text) &&
          ts.isCallExpression(access.parent) &&
          access.parent.expression === access
        ) {
          call = access.parent;
          continue;
        }
        break;
      }

      if (
        ts.isVariableDeclaration(firstCall.parent) &&
        firstMethod !== 'some' &&
        firstMethod !== 'every'
      ) {
        trackBinding(firstCall.parent.name, trieNode, doc, true);
      }
    };

    /** Walks up the parent chain from one identifier occurrence, descending
     * through the trie for each property access, until the use terminates:
     * - leaf access: mark the leaf used
     * - aliased into a new binding or assignment: track that binding
     * - escapes (returned, passed to a call, spread): mark the subtree used
     */
    const walkUseChain = (start: ts.Identifier, entry: Entry) => {
      const doc = entry.doc;
      let cursor: ts.Node = start;
      let trieNode = entry.node;
      // True while the cursor still IS the tracked value (only accesses and
      // value-preserving wrappers in between). Once the value is folded into
      // a larger expression (`a.b && ...`, `cond ? a.b : ...`) it no longer
      // escapes through calls/spreads as-is.
      let pureChain = true;

      while (true) {
        const parent: ts.Node | undefined = cursor.parent;
        if (!parent) break;

        if (ts.isPropertyAccessExpression(parent)) {
          if (parent.expression !== cursor) break;
          const name = parent.name.text;
          const grand = parent.parent;
          if (ts.isCallExpression(grand) && grand.expression === parent) {
            if (name === 'at') {
              // `.at(...)` is an array element pass-through
              cursor = grand;
              continue;
            } else if (arrayMethods.has(name)) {
              handleArrayChain(grand, name, trieNode, doc);
              doc.accessCount++;
              return;
            }
          }
          trieNode = trieNode.children.get(name) || trieNode;
          cursor = parent;
          continue;
        }

        if (ts.isElementAccessExpression(parent)) {
          if (parent.expression !== cursor) break;
          if (ts.isStringLiteral(parent.argumentExpression)) {
            trieNode =
              trieNode.children.get(parent.argumentExpression.text) || trieNode;
          }
          // Numeric/computed element access is an array pass-through
          cursor = parent;
          continue;
        }

        if (
          ts.isNonNullExpression(parent) ||
          ts.isParenthesizedExpression(parent) ||
          ts.isAsExpression(parent) ||
          ts.isAwaitExpression(parent) ||
          (ts.isSatisfiesExpression && ts.isSatisfiesExpression(parent))
        ) {
          cursor = parent;
          continue;
        }

        if (ts.isBinaryExpression(parent)) {
          if (parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
            // Write target of an assignment, not a use
            if (parent.left === cursor) return;
            if (ts.isIdentifier(parent.left)) {
              // `existing = result.data.pokemon` aliases like a declaration
              addEntry(
                checker.getSymbolAtLocation(parent.left),
                trieNode,
                doc,
                false
              );
              doc.accessCount++;
              return;
            }
            if (pureChain) {
              // The value escapes into a property/element write
              if (trieNode.isLeaf) trieNode.used = true;
              markSubtreeUsed(trieNode);
              doc.accessCount++;
              return;
            }
            break;
          }
          // `||`/`??` pass the operand's value through to the result
          // (`fn(a.b || fallback)` still escapes `a.b`), so they keep the
          // chain pure. `&&` and the rest fold the value into a test or a
          // derived value: `a?.b && a?.b.c` keeps its leaf precision.
          if (
            parent.operatorToken.kind !== ts.SyntaxKind.BarBarToken &&
            parent.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken
          ) {
            pureChain = false;
          }
          cursor = parent;
          continue;
        }

        if (ts.isConditionalExpression(parent)) {
          // The branches carry the value onward, the condition is only a test
          if (parent.condition === cursor) break;
          pureChain = false;
          cursor = parent;
          continue;
        }

        if (ts.isVariableDeclaration(parent)) {
          trackBinding(parent.name, trieNode, doc, false);
          return;
        }

        if (ts.isForOfStatement(parent) && parent.expression === cursor) {
          // `for (const p of result.data.pokemons)`: the loop binding holds
          // an element of the iterated value
          if (ts.isVariableDeclarationList(parent.initializer)) {
            for (const declaration of parent.initializer.declarations) {
              trackBinding(declaration.name, trieNode, doc, false);
            }
          } else if (ts.isIdentifier(parent.initializer)) {
            addEntry(
              checker.getSymbolAtLocation(parent.initializer),
              trieNode,
              doc,
              false
            );
          }
          doc.accessCount++;
          return;
        }

        if (
          ts.isReturnStatement(parent) ||
          (ts.isArrowFunction(parent) && parent.body === cursor)
        ) {
          // The data escapes through a return; everything below the current
          // position has to be considered used — unless we're returning from
          // an array-method callback, which stays within the chain.
          if (trieNode.isLeaf) trieNode.used = true;
          if (!entry.suppressReturnBail) markSubtreeUsed(trieNode);
          doc.accessCount++;
          return;
        }

        if (ts.isCallExpression(parent) && parent.expression !== cursor) {
          // Passed as an argument to an external function: when the tracked
          // value itself escapes we consider its whole subtree used.
          if (trieNode.isLeaf) trieNode.used = true;
          if (pureChain) markSubtreeUsed(trieNode);
          doc.accessCount++;
          return;
        }

        if (
          pureChain &&
          (ts.isSpreadElement(parent) ||
            ts.isSpreadAssignment(parent) ||
            ts.isJsxSpreadAttribute(parent) ||
            ts.isShorthandPropertyAssignment(parent) ||
            (ts.isPropertyAssignment(parent) && parent.initializer === cursor))
        ) {
          // The tracked value escapes into an object/array/JSX spread
          if (trieNode.isLeaf) trieNode.used = true;
          markSubtreeUsed(trieNode);
          doc.accessCount++;
          return;
        }

        break;
      }

      // Terminal use without escape: a leaf read counts as usage, an
      // intermediate read (e.g. passing `data.pokemon` to JSX) does not
      // mark any fields but proves the result is consumed in this file.
      if (trieNode.isLeaf) trieNode.used = true;
      doc.accessCount++;
    };

    // Phase B3: seed the tracker for every document.
    const declTypeCache = new Map<
      ts.VariableDeclaration,
      { type: ts.Type; tupleType?: ts.Type; dataType?: ts.Type }
    >();
    for (const state of docStates) {
      const template = state.templateNode;
      const graphqlCallNode = template.parent;

      let docDeclaration: ts.VariableDeclaration | undefined;
      let wrapper: ts.Node = graphqlCallNode.parent;
      while (
        ts.isParenthesizedExpression(wrapper) ||
        ts.isAsExpression(wrapper) ||
        ts.isNonNullExpression(wrapper) ||
        (ts.isSatisfiesExpression && ts.isSatisfiesExpression(wrapper))
      ) {
        wrapper = wrapper.parent;
      }
      if (ts.isVariableDeclaration(wrapper)) docDeclaration = wrapper;

      if (docDeclaration && ts.isIdentifier(docDeclaration.name)) {
        // `const Doc = graphql(...)`: every value-occurrence of `Doc` that
        // sits inside a variable declaration (`const [result] = useQuery(...)`)
        // identifies the result binding of that query.
        const docSymbol = checker.getSymbolAtLocation(docDeclaration.name);
        if (docSymbol) {
          const occurrences =
            identifiersByName.get(docDeclaration.name.text) || [];
          for (const occurrence of occurrences) {
            if (getRefSymbol(occurrence) !== docSymbol) continue;
            const declaration = getVariableDeclaration(occurrence);
            if (!declaration || declaration === docDeclaration) continue;
            trackBinding(declaration.name, state.root, state, false);
          }
        }
      } else if (!docDeclaration) {
        // Inline document (`useQuery({ query: graphql(...) })`): the
        // enclosing declaration holds the query result directly.
        const declaration = getVariableDeclaration(template);
        if (declaration && ts.isIdentifier(declaration.name)) {
          addEntry(
            checker.getSymbolAtLocation(declaration.name),
            state.root,
            state,
            false
          );
        }
      }

      // Type-driven fallback: find result bindings whose type derives from
      // the document's data type (covers wrappers we can't see lexically,
      // e.g. react-query's `useQuery({ queryFn })` patterns).
      const dataType = resolveDataType(template, checker);
      if (dataType) {
        for (const declaration of callInitializedDecls) {
          if (declaration === docDeclaration) continue;
          let cached = declTypeCache.get(declaration);
          if (!cached) {
            const type = unwrapAbstractType(
              checker.getTypeAtLocation(declaration.initializer!)
            );
            cached = { type };
            if (type.flags & ts.TypeFlags.Object) {
              const tupleProperty = type.getProperty('0');
              if (tupleProperty) {
                cached.tupleType = checker.getTypeOfSymbol(tupleProperty);
              }
              const dataProperty = (cached.tupleType || type).getProperty(
                'data'
              );
              if (dataProperty) {
                cached.dataType = unwrapAbstractType(
                  checker.getTypeOfSymbol(dataProperty)
                );
              }
            }
            declTypeCache.set(declaration, cached);
          }
          if (
            cached.type === dataType ||
            cached.tupleType === dataType ||
            cached.dataType === dataType
          ) {
            trackBinding(declaration.name, state.root, state, false);
          }
        }
      }
    }

    // Phase B4: drain the worklist; entries enqueued while walking
    // (aliases, destructured bindings, callback params) are picked up here.
    for (let i = 0; i < queue.length; i++) {
      const entry = queue[i];
      const occurrences = identifiersByName.get(entry.symbol.name);
      if (!occurrences) continue;
      for (const occurrence of occurrences) {
        if (getRefSymbol(occurrence) !== entry.symbol) continue;
        walkUseChain(occurrence, entry);
      }
    }

    // Phase C: report fields whose leaf was never read, aggregated on the
    // parent field.
    for (const state of docStates) {
      if (!state.accessCount) continue;

      const node = state.templateNode;
      const fieldToLoc = state.fieldToLoc;
      const unused = state.allPaths.filter(
        path => !state.leafByPath.get(path)!.used
      );

      const aggregatedUnusedFields = new Set<string>();
      const unusedChildren: { [key: string]: Set<string> } = {};
      const unusedFragmentLeaf = new Set<string>();
      unused.forEach(unusedField => {
        const split = unusedField.split('.');
        split.pop();
        const parentField = split.join('.');
        const loc = fieldToLoc.get(parentField);

        if (loc) {
          aggregatedUnusedFields.add(parentField);
          if (unusedChildren[parentField]) {
            unusedChildren[parentField]!.add(unusedField);
          } else {
            unusedChildren[parentField] = new Set([unusedField]);
          }
        } else {
          unusedFragmentLeaf.add(unusedField);
        }
      });

      aggregatedUnusedFields.forEach(field => {
        const loc = fieldToLoc.get(field)!;
        const unusedFields = unusedChildren[field]!;
        diagnostics.push({
          file: source,
          length: loc.length,
          start: node.getStart() + loc.start + 1,
          category: ts.DiagnosticCategory.Warning,
          code: UNUSED_FIELD_CODE,
          messageText: `Field(s) ${[...unusedFields]
            .map(x => `'${x}'`)
            .join(', ')} are not used.`,
        });
      });

      unusedFragmentLeaf.forEach(field => {
        const loc = fieldToLoc.get(field)!;
        diagnostics.push({
          file: source,
          length: loc.length,
          start: node.getStart() + loc.start + 1,
          category: ts.DiagnosticCategory.Warning,
          code: UNUSED_FIELD_CODE,
          messageText: `Field ${field} is not used.`,
        });
      });
    }
  } catch (e: any) {
    console.error('[GraphQLSP]: ', e.message, e.stack);
  }

  return diagnostics;
};
