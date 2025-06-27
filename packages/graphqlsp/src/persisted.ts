import { ts } from './ts';

import { createHash } from 'crypto';

import * as checks from './ast/checks';
import {
  findAllCallExpressions,
  findNode,
  getSource,
  unrollTadaFragments,
} from './ast';
import { resolveTemplate } from './ast/resolve';
import {
  FragmentDefinitionNode,
  parse,
  print,
  visit,
} from '@0no-co/graphql.web';
import {
  getDeclarationOfIdentifier,
  getValueOfIdentifier,
} from './ast/declaration';

type PersistedAction = {
  span: {
    start: number;
    length: number;
  };
  replacement: string;
};

export function getPersistedCodeFixAtPosition(
  filename: string,
  position: number,
  info: ts.server.PluginCreateInfo
): PersistedAction | undefined {
  const isCallExpression = info.config.templateIsCallExpression ?? true;
  const typeChecker = info.languageService.getProgram()?.getTypeChecker();
  if (!isCallExpression) return undefined;

  let source = getSource(info, filename);
  if (!source) return undefined;

  const node = findNode(source, position);
  if (!node) return undefined;

  let callExpression: ts.Node = node;
  // We found a node and need to check where on the path we are
  // we expect this to look a little bit like
  // const persistedDoc = graphql.persisted<typeof x>()
  // When we are on the left half of this statement we bubble down
  // looking for the correct call-expression and on the right hand
  // we bubble up.
  if (ts.isVariableStatement(callExpression)) {
    callExpression =
      callExpression.declarationList.declarations.find(declaration => {
        return (
          ts.isVariableDeclaration(declaration) &&
          declaration.initializer &&
          ts.isCallExpression(declaration.initializer)
        );
      }) || node;
  } else if (ts.isVariableDeclarationList(callExpression)) {
    callExpression =
      callExpression.declarations.find(declaration => {
        return (
          ts.isVariableDeclaration(declaration) &&
          declaration.initializer &&
          ts.isCallExpression(declaration.initializer)
        );
      }) || node;
  } else if (
    ts.isVariableDeclaration(callExpression) &&
    callExpression.initializer &&
    ts.isCallExpression(callExpression.initializer)
  ) {
    callExpression = callExpression.initializer;
  } else {
    while (callExpression && !ts.isCallExpression(callExpression)) {
      callExpression = callExpression.parent;
    }
  }

  // We want to ensure that we found a call-expression and that it looks
  // like "graphql.persisted", in a future iteration when the API surface
  // is more defined we will need to use the ts.Symbol to support re-exporting
  // this function by means of "export const peristed = graphql.persisted".
  if (!checks.isTadaPersistedCall(callExpression, typeChecker)) {
    return undefined;
  }

  let foundNode,
    foundFilename = filename;
  if (callExpression.typeArguments) {
    const [typeQuery] = callExpression.typeArguments;
    if (!typeQuery || !ts.isTypeQueryNode(typeQuery)) return undefined;
    const { node: found, filename: fileName } =
      getDocumentReferenceFromTypeQuery(typeQuery, filename, info);
    foundNode = found;
    foundFilename = fileName;
  } else if (callExpression.arguments[1]) {
    if (
      !ts.isIdentifier(callExpression.arguments[1]) &&
      !ts.isCallExpression(callExpression.arguments[1])
    )
      return undefined;
    const { node: found, filename: fileName } =
      getDocumentReferenceFromDocumentNode(
        callExpression.arguments[1],
        filename,
        info
      );
    foundNode = found;
    foundFilename = fileName;
  }

  if (!foundNode) return undefined;

  const initializer = foundNode;
  if (
    !initializer ||
    !ts.isCallExpression(initializer) ||
    !initializer.arguments[0] ||
    !ts.isStringLiteralLike(initializer.arguments[0])
  ) {
    return undefined;
  }

  const hash = generateHashForDocument(
    info,
    initializer.arguments[0],
    foundFilename,
    initializer.arguments[1] &&
      ts.isArrayLiteralExpression(initializer.arguments[1])
      ? initializer.arguments[1]
      : undefined
  );
  const existingHash = callExpression.arguments[0];
  // We assume for now that this is either undefined or an existing string literal
  if (!existingHash) {
    // We have no persisted-identifier yet, suggest adding in a new one
    return {
      span: {
        start: callExpression.arguments.pos,
        length: 1,
      },
      replacement: `"sha256:${hash}")`,
    };
  } else if (
    ts.isStringLiteral(existingHash) &&
    existingHash.getText() !== `"sha256:${hash}"`
  ) {
    // We are out of sync, suggest replacing this with the updated hash
    return {
      span: {
        start: existingHash.getStart(),
        length: existingHash.end - existingHash.getStart(),
      },
      replacement: `"sha256:${hash}"`,
    };
  } else if (ts.isIdentifier(existingHash)) {
    // Suggest replacing a reference with a static one
    // this to make these easier to statically analyze
    return {
      span: {
        start: existingHash.getStart(),
        length: existingHash.end - existingHash.getStart(),
      },
      replacement: `"sha256:${hash}"`,
    };
  } else {
    return undefined;
  }
}

export const generateHashForDocument = (
  info: ts.server.PluginCreateInfo,
  templateLiteral: ts.StringLiteralLike | ts.TaggedTemplateExpression,
  foundFilename: string,
  referencedFragments: ts.ArrayLiteralExpression | undefined
): string | undefined => {
  if (referencedFragments) {
    const fragments: Array<FragmentDefinitionNode> = [];
    unrollTadaFragments(referencedFragments, fragments, info);
    let text = resolveTemplate(
      templateLiteral,
      foundFilename,
      info
    ).combinedText;
    const deduplicatedFragments = fragments
      .map(fragment => print(fragment))
      .filter((fragment, index, array) => array.indexOf(fragment) === index);

    deduplicatedFragments.forEach(fragmentDefinition => {
      text = `${text}\n\n${fragmentDefinition}`;
    });
    const fullText = print(parse(text));
    return createHash('sha256').update(fullText).digest('hex');
  } else {
    const externalSource = getSource(info, foundFilename)!;
    const { fragments } = findAllCallExpressions(externalSource, info);

    const text = resolveTemplate(
      templateLiteral,
      foundFilename,
      info
    ).combinedText;

    const parsed = parse(text);
    const spreads = new Set<string>();
    visit(parsed, {
      FragmentSpread: node => {
        spreads.add(node.name.value);
      },
    });

    let resolvedText = text;
    const visited = new Set();
    const traversedSpreads = [...spreads];

    let spreadName: string | undefined;
    while ((spreadName = traversedSpreads.shift())) {
      visited.add(spreadName);
      const fragmentDefinition = fragments.find(
        x => x.name.value === spreadName
      );
      if (!fragmentDefinition) {
        info.project.projectService.logger.info(
          `[GraphQLSP] could not find fragment for spread ${spreadName}!`
        );
        return;
      }

      visit(fragmentDefinition, {
        FragmentSpread: node => {
          if (!visited.has(node.name.value))
            traversedSpreads.push(node.name.value);
        },
      });

      resolvedText = `${resolvedText}\n\n${print(fragmentDefinition)}`;
    }

    return createHash('sha256')
      .update(print(parse(resolvedText)))
      .digest('hex');
  }
};

export const getDocumentReferenceFromTypeQuery = (
  typeQuery: ts.TypeQueryNode,
  filename: string,
  info: ts.server.PluginCreateInfo
): { node: ts.CallExpression | null; filename: string } => {
  const typeChecker = info.languageService.getProgram()?.getTypeChecker();
  if (!typeChecker) return { node: null, filename };

  // Handle EntityName (Identifier | QualifiedName)
  let identifier: ts.Identifier | undefined;
  if (ts.isIdentifier(typeQuery.exprName)) {
    identifier = typeQuery.exprName;
  } else if (ts.isQualifiedName(typeQuery.exprName)) {
    // For qualified names like 'module.identifier', get the right-most identifier
    identifier = typeQuery.exprName.right;
  }

  if (!identifier) return { node: null, filename };

  const value = getValueOfIdentifier(identifier, typeChecker);
  if (!value || !checks.isGraphQLCall(value, typeChecker)) {
    return { node: null, filename };
  }

  return {
    node: value as ts.CallExpression,
    filename: value.getSourceFile().fileName,
  };
};

export const getDocumentReferenceFromDocumentNode = (
  documentNodeArgument: ts.Identifier | ts.CallExpression,
  filename: string,
  info: ts.server.PluginCreateInfo
): { node: ts.CallExpression | null; filename: string } => {
  if (ts.isIdentifier(documentNodeArgument)) {
    const typeChecker = info.languageService.getProgram()?.getTypeChecker();
    if (!typeChecker) return { node: null, filename };

    const value = getValueOfIdentifier(documentNodeArgument, typeChecker);
    if (!value || !checks.isGraphQLCall(value, typeChecker)) {
      return { node: null, filename };
    }

    return {
      node: value as ts.CallExpression,
      filename: value.getSourceFile().fileName,
    };
  } else {
    return { node: documentNodeArgument, filename };
  }
};
