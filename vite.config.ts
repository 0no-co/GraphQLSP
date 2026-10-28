import { defineConfig } from 'vite';
import { createRequire } from 'node:module';
import path from 'node:path';

// @gql.tada/internal builds schemas through require('graphql'). Use that same
// instance when testing source modules, rather than Vite's preferred ESM build.
const require = createRequire(path.resolve('packages/graphqlsp/package.json'));
export default defineConfig({
  resolve: {
    alias: [{ find: /^graphql$/, replacement: require.resolve('graphql') }],
  },
});
