import { describe, expect, it } from 'vitest';

import { getGraphQLDocumentSymbols } from '../../packages/vscode-graphqlsp/src/documentSymbols';

const span = (source: string, text: string) => {
  const start = source.indexOf(text);
  if (start === -1) throw new Error(`Could not find ${JSON.stringify(text)}`);
  return { start, end: start + text.length };
};

describe('VS Code GraphQL document symbols', () => {
  it('finds operations and fragments in call expressions', () => {
    const source = `
      const fields = graphql(\`
        fragment PokemonFields on Pokemon {
          id
        }
      \`);
      const query = graphql(\`
        query Pokemons($limit: Int!) {
          pokemons(limit: $limit) { id }
        }
      \`, [fields]);
      const anonymous = graphql('query { pokemon(id: "1") { id } }');
    `;

    const symbols = getGraphQLDocumentSymbols(source);
    expect(symbols.map(symbol => symbol.name)).toEqual([
      'fragment PokemonFields on Pokemon',
      'query Pokemons',
      'query (anonymous)',
    ]);
    expect(symbols[0]!.selectionRange).toEqual(span(source, 'PokemonFields'));
    expect(symbols[1]!.selectionRange).toEqual(span(source, 'Pokemons'));
    expect(source.slice(symbols[2]!.range.start, symbols[2]!.range.end)).toBe(
      'query { pokemon(id: "1") { id } }'
    );
  });

  it('finds tagged templates and masks fragment interpolations', () => {
    const source = `
      const fields = gql\`fragment Fields on Pokemon { id }\`;
      const query = gql\`
        query WithInterpolation {
          pokemon(id: "1") {
            \${fields}
            name
          }
        }
      \`;
    `;

    expect(
      getGraphQLDocumentSymbols(source).map(symbol => symbol.name)
    ).toEqual(['fragment Fields on Pokemon', 'query WithInterpolation']);
  });

  it('supports a configured custom template name', () => {
    const source = `
      const ignored = customGraphQL(\`query Custom { pokemons { id } }\`);
    `;

    expect(getGraphQLDocumentSymbols(source)).toEqual([]);
    expect(
      getGraphQLDocumentSymbols(source, 'customGraphQL').map(
        symbol => symbol.name
      )
    ).toEqual(['query Custom']);
  });

  it('does not inspect comments, ordinary strings, or unrelated templates', () => {
    const source = `
      // graphql(\`query Comment { pokemons { id } }\`)
      const text = "gql\`query String { pokemons { id } }\`";
      const other = html\`<p>graphql(\`not really code\`)</p>\`;
    `;

    expect(getGraphQLDocumentSymbols(source)).toEqual([]);
  });

  it('skips malformed GraphQL documents without affecting valid ones', () => {
    const source = `
      const malformed = graphql(\`query {\`);
      const valid = graphql(\`mutation Save { savePokemon { id } }\`);
    `;

    expect(
      getGraphQLDocumentSymbols(source).map(symbol => symbol.name)
    ).toEqual(['mutation Save']);
  });
});
