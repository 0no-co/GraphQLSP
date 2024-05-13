import { createProgram } from './helpers';
import { describe, it } from 'vitest';

describe('quick-info', () => {
  it('should work', () => {
    const program = createProgram();
    program.createFile(
      'test.ts',
      "import { graphql } from './graphql'; const query = graphql(`query { dragons { id } }`)"
    );
    console.log(program.languageService.getSemanticDiagnostics('test.ts'));
  });
});
