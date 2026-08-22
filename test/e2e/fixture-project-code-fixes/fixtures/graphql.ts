import type { DocumentNode } from 'graphql';

export function graphql(document: string): DocumentNode {
  return document as any;
}
