import { Kind, parse } from 'graphql';

export interface OffsetRange {
  start: number;
  end: number;
}

export interface GraphQLDocumentSymbol {
  name: string;
  type: 'operation' | 'fragment';
  range: OffsetRange;
  selectionRange: OffsetRange;
}

interface EmbeddedDocument {
  contentStart: number;
  text: string;
}

const isIdentifierStart = (char: string | undefined): boolean =>
  !!char && /[A-Za-z_$]/.test(char);
const isIdentifierPart = (char: string | undefined): boolean =>
  !!char && /[A-Za-z0-9_$]/.test(char);

const skipLineComment = (source: string, start: number): number => {
  const end = source.indexOf('\n', start + 2);
  return end === -1 ? source.length : end;
};

const skipBlockComment = (source: string, start: number): number => {
  const end = source.indexOf('*/', start + 2);
  return end === -1 ? source.length : end + 2;
};

const skipQuotedString = (
  source: string,
  start: number,
  quote: "'" | '"'
): number => {
  for (let index = start + 1; index < source.length; index++) {
    if (source[index] === '\\') {
      index++;
    } else if (source[index] === quote) {
      return index + 1;
    }
  }
  return source.length;
};

const skipTemplate = (source: string, start: number): number => {
  for (let index = start + 1; index < source.length; index++) {
    if (source[index] === '\\') {
      index++;
    } else if (source[index] === '`') {
      return index + 1;
    } else if (source[index] === '$' && source[index + 1] === '{') {
      index = skipExpression(source, index + 2) - 1;
    }
  }
  return source.length;
};

const skipExpression = (source: string, start: number): number => {
  let depth = 1;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (char === "'" || char === '"') {
      index = skipQuotedString(source, index, char) - 1;
    } else if (char === '`') {
      index = skipTemplate(source, index) - 1;
    } else if (char === '/' && source[index + 1] === '/') {
      index = skipLineComment(source, index) - 1;
    } else if (char === '/' && source[index + 1] === '*') {
      index = skipBlockComment(source, index) - 1;
    } else if (char === '{') {
      depth++;
    } else if (char === '}' && --depth === 0) {
      return index + 1;
    }
  }
  return source.length;
};

const skipTrivia = (source: string, start: number): number => {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index]!)) {
      index++;
    } else if (source[index] === '/' && source[index + 1] === '/') {
      index = skipLineComment(source, index);
    } else if (source[index] === '/' && source[index + 1] === '*') {
      index = skipBlockComment(source, index);
    } else {
      break;
    }
  }
  return index;
};

/** Replaces template interpolations with same-length whitespace so GraphQL
 * locations still map directly back to the source document. */
const maskTemplateInterpolations = (text: string): string => {
  const chars = text.split('');
  for (let index = 0; index < text.length - 1; index++) {
    if (text[index] === '\\') {
      index++;
    } else if (text[index] === '$' && text[index + 1] === '{') {
      const end = skipExpression(text, index + 2);
      for (let offset = index; offset < end; offset++) {
        if (chars[offset] !== '\n' && chars[offset] !== '\r')
          chars[offset] = ' ';
      }
      index = end - 1;
    }
  }
  return chars.join('');
};

const readDocumentLiteral = (
  source: string,
  start: number
): { document: EmbeddedDocument; end: number } | undefined => {
  const quote = source[start];
  if (quote !== "'" && quote !== '"' && quote !== '`') return undefined;

  const end =
    quote === '`'
      ? skipTemplate(source, start)
      : skipQuotedString(source, start, quote);
  if (end > source.length || source[end - 1] !== quote) return undefined;

  const raw = source.slice(start + 1, end - 1);
  return {
    document: {
      contentStart: start + 1,
      text: quote === '`' ? maskTemplateInterpolations(raw) : raw,
    },
    end,
  };
};

/** Finds GraphQL documents embedded in calls or tagged templates without
 * requiring a second TypeScript compiler in the extension host. */
const collectEmbeddedDocuments = (
  source: string,
  templateNames: ReadonlySet<string>
): EmbeddedDocument[] => {
  const documents: EmbeddedDocument[] = [];

  for (let index = 0; index < source.length;) {
    const char = source[index];
    if (char === '/' && source[index + 1] === '/') {
      index = skipLineComment(source, index);
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      index = skipBlockComment(source, index);
      continue;
    }
    if (char === "'" || char === '"') {
      index = skipQuotedString(source, index, char);
      continue;
    }
    if (char === '`') {
      index = skipTemplate(source, index);
      continue;
    }
    if (!isIdentifierStart(char)) {
      index++;
      continue;
    }

    const identifierStart = index++;
    while (isIdentifierPart(source[index])) index++;
    const identifier = source.slice(identifierStart, index);
    if (!templateNames.has(identifier)) continue;

    const next = skipTrivia(source, index);
    if (source[next] === '`') {
      const literal = readDocumentLiteral(source, next);
      if (literal) documents.push(literal.document);
    } else if (source[next] === '(') {
      const argument = skipTrivia(source, next + 1);
      const literal = readDocumentLiteral(source, argument);
      if (literal) documents.push(literal.document);
    }
  }

  return documents;
};

export const getGraphQLDocumentSymbols = (
  source: string,
  additionalTemplate?: string
): GraphQLDocumentSymbol[] => {
  const templateNames = new Set(['gql', 'graphql']);
  if (additionalTemplate) templateNames.add(additionalTemplate);

  const symbols: GraphQLDocumentSymbol[] = [];
  for (const document of collectEmbeddedDocuments(source, templateNames)) {
    let parsed;
    try {
      parsed = parse(document.text);
    } catch (_error) {
      continue;
    }

    for (const definition of parsed.definitions) {
      if (!definition.loc) continue;

      let name: string;
      let type: GraphQLDocumentSymbol['type'];
      if (definition.kind === Kind.OPERATION_DEFINITION) {
        name = definition.name
          ? `${definition.operation} ${definition.name.value}`
          : `${definition.operation} (anonymous)`;
        type = 'operation';
      } else if (definition.kind === Kind.FRAGMENT_DEFINITION) {
        name = `fragment ${definition.name.value} on ${definition.typeCondition.name.value}`;
        type = 'fragment';
      } else {
        continue;
      }

      const start = document.contentStart + definition.loc.start;
      const end = document.contentStart + definition.loc.end;
      const nameLocation = definition.name?.loc;
      symbols.push({
        name,
        type,
        range: { start, end },
        selectionRange: nameLocation
          ? {
              start: document.contentStart + nameLocation.start,
              end: document.contentStart + nameLocation.end,
            }
          : { start, end: Math.min(start + 1, end) },
      });
    }
  }

  return symbols;
};
