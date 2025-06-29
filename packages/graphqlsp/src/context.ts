import type { SchemaOrigin } from '@gql.tada/internal';

import { ts } from './ts';
import { loadSchema, SchemaRef } from './graphql/getSchema';

const BASE_CLIENT_DIRECTIVES = [
  'populate',
  'client',
  'unmask',
  '_unmask',
  '_optional',
  '_relayPagination',
  '_simplePagination',
  '_required',
  'optional',
  'required',
  'arguments',
  'argumentDefinitions',
  'connection',
  'refetchable',
  'relay',
  'required',
  'inline',
];

const BASE_RESERVED_KEYS = ['id', '_id', '__typename'];

interface RawConfig {
  schema: SchemaOrigin;
  schemas: SchemaOrigin[];
  tadaDisablePreprocessing?: boolean;
  templateIsCallExpression?: boolean;
  shouldCheckForColocatedFragments?: boolean;
  template?: string;
  clientDirectives?: string[];
  trackFieldUsage?: boolean;
  tadaOutputLocation?: string;
  reservedKeys?: string[];
}

export type Logger = (msg: string) => void;

export interface GraphQLSPContext {
  log: Logger;
  schema: SchemaRef;
  shouldCheckForColocatedFragments: boolean;
  trackFieldUsage: boolean;
  templateIsCallExpression: boolean;
  templates: Set<string>;
  clientDirectives: Set<string>;
  reservedKeys: Set<string>;

  // TODO(@kitten): Remove once it's fully unused
  /** @deprecated: Don't use, remove */
  __info: ts.server.PluginCreateInfo;
}

export const initGraphQLSPContext = (
  info: ts.server.PluginCreateInfo
): GraphQLSPContext => {
  const log: Logger = (msg: string) =>
    info.project.projectService.logger.info(`[GraphQLSP] ${msg}`);
  const raw = info.config as RawConfig;

  if (!raw.schema && !raw.schemas) {
    log('Missing "schema" option in configuration.');
    throw new Error('Please provide a GraphQL Schema!');
  } else {
    log('config: ' + JSON.stringify(raw));
    log('Setting up the GraphQL Plugin');
  }

  const templates = new Set(['gql', 'graphql']);
  if (raw.template) templates.add(raw.template);

  const clientDirectives = new Set([
    ...BASE_CLIENT_DIRECTIVES,
    ...(raw.clientDirectives ?? []),
  ]);

  const reservedKeys = new Set([
    ...BASE_RESERVED_KEYS,
    ...(raw.reservedKeys ?? []),
  ]);

  return {
    log,
    schema: loadSchema(info, raw, log),
    shouldCheckForColocatedFragments: !!(
      raw.shouldCheckForColocatedFragments ?? true
    ),
    trackFieldUsage: !!(raw.trackFieldUsage ?? true),
    templateIsCallExpression: !!(raw.templateIsCallExpression ?? true),
    templates,
    clientDirectives,
    reservedKeys,
    __info: info,
  };
};
