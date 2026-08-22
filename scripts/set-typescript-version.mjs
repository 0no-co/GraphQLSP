import fs from 'node:fs';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  throw new Error('Usage: node scripts/set-typescript-version.mjs <x.y.z>');
}

for (const manifestPath of [
  'package.json',
  'packages/graphqlsp/package.json',
]) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.devDependencies.typescript = `^${version}`;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

const workspacePath = 'pnpm-workspace.yaml';
const workspace = fs.readFileSync(workspacePath, 'utf8');
const overridePattern = /(^\s{2}typescript:\s*).*$/m;
if (!overridePattern.test(workspace)) {
  throw new Error('Could not find the TypeScript workspace override');
}
fs.writeFileSync(
  workspacePath,
  workspace.replace(overridePattern, `$1^${version}`)
);
