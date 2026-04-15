import {
  GraphQLSchema,
  GraphQLType,
  GraphQLNamedType,
  GraphQLField,
  GraphQLArgument,
  GraphQLInputField,
  getNamedType,
  isObjectType,
  isInterfaceType,
  isUnionType,
  isInputObjectType,
  isEnumType,
  isScalarType,
} from 'graphql';
import { getContextAtPosition, IPosition } from 'graphql-language-service';

const MAX_EXPANSION_DEPTH = 3;

export interface ExpansionResult {
  canIncreaseVerbosityLevel: boolean;
  expanded?: string;
}

/**
 * Given the current hover context, return:
 *   - whether the quick info could be expanded further (for level 0 hovers)
 *   - the markdown-formatted expansion for levels >= 1
 */
export function getExpansion(
  schema: GraphQLSchema,
  queryText: string,
  cursor: IPosition,
  verbosityLevel: number
): ExpansionResult {
  const ctx = getContextAtPosition(queryText, cursor, schema);
  if (!ctx) return { canIncreaseVerbosityLevel: false };

  const { token, typeInfo } = ctx;
  const { kind } = token.state;
  if (!kind) return { canIncreaseVerbosityLevel: false };

  const target = resolveTargetType(kind, typeInfo);
  if (!target) return { canIncreaseVerbosityLevel: false };

  const namedTarget = getNamedType(target);
  if (!isExpandable(namedTarget)) {
    return { canIncreaseVerbosityLevel: false };
  }

  if (verbosityLevel <= 0) {
    return { canIncreaseVerbosityLevel: true };
  }

  // Cap expansion depth to avoid context bloat for deeply nested schemas.
  const depth = Math.min(verbosityLevel, MAX_EXPANSION_DEPTH);
  const expanded = renderNamedType(namedTarget, depth, new Set());
  return {
    canIncreaseVerbosityLevel: verbosityLevel < MAX_EXPANSION_DEPTH,
    expanded,
  };
}

function resolveTargetType(
  kind: string,
  typeInfo: {
    type?: GraphQLType | null;
    inputType?: GraphQLType | null;
    fieldDef?: GraphQLField<any, any> | null;
    argDef?: GraphQLArgument | null;
  }
): GraphQLType | undefined {
  switch (kind) {
    case 'Field':
    case 'AliasedField':
      return typeInfo.fieldDef?.type ?? undefined;
    case 'ObjectField':
      return typeInfo.fieldDef?.type ?? typeInfo.inputType ?? undefined;
    case 'NamedType':
      return typeInfo.type ?? undefined;
    case 'Argument':
      return typeInfo.argDef?.type ?? typeInfo.inputType ?? undefined;
    case 'Variable':
      return typeInfo.inputType ?? typeInfo.type ?? undefined;
    default:
      return undefined;
  }
}

function isExpandable(named: GraphQLNamedType): boolean {
  return (
    isObjectType(named) ||
    isInterfaceType(named) ||
    isUnionType(named) ||
    isInputObjectType(named) ||
    isEnumType(named)
  );
}

function renderNamedType(
  named: GraphQLNamedType,
  depth: number,
  seen: Set<string>
): string {
  const blocks: string[] = [];
  collect(named, depth, seen, blocks);
  return blocks.join('\n\n');
}

function collect(
  named: GraphQLNamedType,
  depth: number,
  seen: Set<string>,
  blocks: string[]
) {
  if (seen.has(named.name)) return;
  seen.add(named.name);

  const body = renderTypeDefinition(named);
  if (body) blocks.push(wrapGraphQL(body));

  if (depth <= 1) return;

  // Recurse into referenced named types.
  const refs = referencedTypes(named);
  for (const ref of refs) {
    if (isExpandable(ref) && !seen.has(ref.name)) {
      collect(ref, depth - 1, seen, blocks);
    }
  }
}

function renderTypeDefinition(named: GraphQLNamedType): string | undefined {
  const descriptionComment = named.description
    ? formatDescriptionComment(named.description)
    : '';

  if (isObjectType(named)) {
    const interfaces = named.getInterfaces();
    const header = interfaces.length
      ? `type ${named.name} implements ${interfaces
          .map(i => i.name)
          .join(' & ')}`
      : `type ${named.name}`;
    const fields = Object.values(named.getFields()).map(renderField).join('\n');
    return `${descriptionComment}${header} {\n${fields}\n}`;
  }

  if (isInterfaceType(named)) {
    const interfaces = named.getInterfaces();
    const header = interfaces.length
      ? `interface ${named.name} implements ${interfaces
          .map(i => i.name)
          .join(' & ')}`
      : `interface ${named.name}`;
    const fields = Object.values(named.getFields()).map(renderField).join('\n');
    return `${descriptionComment}${header} {\n${fields}\n}`;
  }

  if (isUnionType(named)) {
    const members = named
      .getTypes()
      .map(t => t.name)
      .join(' | ');
    return `${descriptionComment}union ${named.name} = ${members}`;
  }

  if (isInputObjectType(named)) {
    const fields = Object.values(named.getFields())
      .map(renderInputField)
      .join('\n');
    return `${descriptionComment}input ${named.name} {\n${fields}\n}`;
  }

  if (isEnumType(named)) {
    const values = named
      .getValues()
      .map(v => {
        const c = v.description
          ? formatDescriptionComment(v.description, '  ')
          : '';
        const dep = v.deprecationReason
          ? ` @deprecated(reason: ${JSON.stringify(v.deprecationReason)})`
          : '';
        return `${c}  ${v.name}${dep}`;
      })
      .join('\n');
    return `${descriptionComment}enum ${named.name} {\n${values}\n}`;
  }

  return undefined;
}

function renderField(field: GraphQLField<any, any>): string {
  const desc = field.description
    ? formatDescriptionComment(field.description, '  ')
    : '';
  const args = field.args.length
    ? `(${field.args.map(a => `${a.name}: ${a.type.toString()}`).join(', ')})`
    : '';
  const dep = field.deprecationReason
    ? ` @deprecated(reason: ${JSON.stringify(field.deprecationReason)})`
    : '';
  return `${desc}  ${field.name}${args}: ${field.type.toString()}${dep}`;
}

function renderInputField(field: GraphQLInputField): string {
  const desc = field.description
    ? formatDescriptionComment(field.description, '  ')
    : '';
  const def =
    field.defaultValue !== undefined
      ? ` = ${JSON.stringify(field.defaultValue)}`
      : '';
  return `${desc}  ${field.name}: ${field.type.toString()}${def}`;
}

function formatDescriptionComment(description: string, indent = ''): string {
  // Render as GraphQL string-description so it renders inside the code block.
  const lines = description.split('\n');
  if (lines.length === 1) {
    return `${indent}"${lines[0]}"\n`;
  }
  return `${indent}"""\n${lines
    .map(l => `${indent}${l}`)
    .join('\n')}\n${indent}"""\n`;
}

function wrapGraphQL(body: string): string {
  return '```graphql\n' + body + '\n```';
}

function referencedTypes(named: GraphQLNamedType): GraphQLNamedType[] {
  const result: GraphQLNamedType[] = [];
  const push = (t: GraphQLType) => {
    const n = getNamedType(t);
    if (!isScalarType(n)) result.push(n);
  };

  if (isObjectType(named) || isInterfaceType(named)) {
    for (const f of Object.values(named.getFields())) {
      push(f.type);
      for (const a of f.args) push(a.type);
    }
  } else if (isUnionType(named)) {
    for (const t of named.getTypes()) result.push(t);
  } else if (isInputObjectType(named)) {
    for (const f of Object.values(named.getFields())) push(f.type);
  }
  return result;
}
