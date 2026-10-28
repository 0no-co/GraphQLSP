/* Packages the extension into a .vsix.
 *
 * The extension ships `@0no-co/graphqlsp` inside its `node_modules` so
 * tsserver can resolve the plugin from the extension's install location
 * (VSCode passes it as a plugin probe location). pnpm's symlinked
 * `node_modules` layout can't be packaged by vsce directly, so this stages
 * a copy of the extension, installs the workspace's graphqlsp tarball with
 * npm to get a regular flat `node_modules`, and runs vsce there. */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const extensionRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const repoRoot = path.resolve(extensionRoot, '../..');
const stagingDir = path.join(extensionRoot, '.staging');

const run = (command, args, cwd) => {
  console.log(`> ${command} ${args.join(' ')}`);
  // Windows .cmd shims need a shell. Invoke the JavaScript CLIs directly so
  // paths containing spaces work without shell command construction.
  if (command === 'pnpm' && process.env.npm_execpath) {
    args = [process.env.npm_execpath, ...args];
    command = process.execPath;
  } else if (command === 'npm' && process.platform === 'win32') {
    args = [
      path.join(
        path.dirname(process.execPath),
        'node_modules/npm/bin/npm-cli.js'
      ),
      ...args,
    ];
    command = process.execPath;
  }
  execFileSync(command, args, { cwd, stdio: 'inherit', windowsHide: true });
};

fs.rmSync(stagingDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });
run('pnpm', ['--filter', '@0no-co/graphqlsp', 'build'], repoRoot);

// Pack the workspace's graphqlsp into a tarball (this builds it through its
// prepublishOnly script)
run(
  'pnpm',
  ['--filter', '@0no-co/graphqlsp', 'pack', '--pack-destination', stagingDir],
  repoRoot
);
const tarball = fs.readdirSync(stagingDir).find(file => file.endsWith('.tgz'));
if (!tarball) throw new Error('pnpm pack did not produce a tarball');

for (const file of [
  'dist',
  'syntaxes',
  'language-configuration.json',
  'icon.png',
  'README.md',
  'LICENSE.md',
  '.vscodeignore',
]) {
  fs.cpSync(path.join(extensionRoot, file), path.join(stagingDir, file), {
    recursive: true,
  });
}

const manifest = JSON.parse(
  fs.readFileSync(path.join(extensionRoot, 'package.json'), 'utf8')
);
delete manifest.private;
delete manifest.scripts;
delete manifest.devDependencies;
manifest.dependencies = {
  ...manifest.dependencies,
  '@0no-co/graphqlsp': `file:./${tarball}`,
};
fs.writeFileSync(
  path.join(stagingDir, 'package.json'),
  JSON.stringify(manifest, null, 2)
);

// npm rather than pnpm: it produces the plain nested node_modules layout
// that both tsserver's module resolution and vsce's file collection expect.
// --legacy-peer-deps keeps npm from installing graphqlsp's `typescript`
// peer dependency (23MB), which tsserver provides at runtime anyway
run(
  'npm',
  [
    'install',
    '--omit=dev',
    '--legacy-peer-deps',
    '--no-audit',
    '--no-fund',
    '--no-package-lock',
  ],
  stagingDir
);

// vsce collects dependency files via `npm list --production`, which fails
// on unmet peer dependencies; typescript is deliberately not bundled
// (tsserver provides it at runtime), so drop peer ranges from the staged
// packages to keep npm's dependency graph valid
const stripPeerDependencies = dir => {
  for (const entry of fs.readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    if (entry.startsWith('@')) {
      stripPeerDependencies(path.join(dir, entry));
      continue;
    }
    const manifestPath = path.join(dir, entry, 'package.json');
    if (!fs.existsSync(manifestPath)) continue;
    const packageManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (packageManifest.peerDependencies) {
      delete packageManifest.peerDependencies;
      delete packageManifest.peerDependenciesMeta;
      fs.writeFileSync(manifestPath, JSON.stringify(packageManifest, null, 2));
    }
  }
};
stripPeerDependencies(path.join(stagingDir, 'node_modules'));
// npm's hidden lockfile takes precedence over the edited package.json
// files when npm reconstructs the tree, so it has to go too
fs.rmSync(path.join(stagingDir, 'node_modules', '.package-lock.json'), {
  force: true,
});

// Without the lockfile npm can no longer tell that the installed copy came
// from the `file:` tarball, so point the dependency at the exact version
const installedPlugin = JSON.parse(
  fs.readFileSync(
    path.join(
      stagingDir,
      'node_modules',
      '@0no-co',
      'graphqlsp',
      'package.json'
    ),
    'utf8'
  )
);
manifest.dependencies = {
  ...manifest.dependencies,
  '@0no-co/graphqlsp': installedPlugin.version,
};
fs.writeFileSync(
  path.join(stagingDir, 'package.json'),
  JSON.stringify(manifest, null, 2)
);

const output = path.join(
  extensionRoot,
  `vscode-graphqlsp-${manifest.version}.vsix`
);
run(
  process.execPath,
  [
    createRequire(import.meta.url).resolve('@vscode/vsce/vsce'),
    'package',
    '--out',
    output,
  ],
  stagingDir
);
console.log(`\nPackaged ${output}`);
