import { parse as parseDocument } from 'graphql';
import type { DocumentNode, ParseOptions, Source } from 'graphql';

/**
 * Fragment arguments — `fragment Fields($size: Int!) on Product` and
 * `...Fields(size: $size)` — are gated behind an experimental parse option in
 * `graphql@17`. Older versions ignore unknown parse options, so this can always
 * be passed; on those versions the syntax simply keeps reporting a syntax error.
 *
 * @see https://github.com/graphql/graphql-spec/pull/1081
 */
export const PARSE_OPTIONS = {
  experimentalFragmentArguments: true,
} as ParseOptions;

/** `graphql`'s `parse`, with the parse options GraphQLSP relies on. */
export function parse(
  source: string | Source,
  options?: ParseOptions
): DocumentNode {
  return parseDocument(source, { ...PARSE_OPTIONS, ...options });
}
