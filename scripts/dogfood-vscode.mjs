import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
if (!args.includes('--code') || !args.includes('--cli')) {
  throw new Error(
    'Usage: node scripts/dogfood-vscode.mjs --code /path/to/Code --cli /path/to/resources/app/out/cli.js [--vsix /path/to/graphqlsp.vsix] [--results /path/to/results.json]'
  );
}
const code = path.resolve(option('--code')),
  cli = path.resolve(option('--cli'));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'graphqlsp-vscode-'));
const project = path.join(base, 'workspace'),
  userData = path.join(base, 'user-data'),
  extensions = path.join(base, 'extensions');
const fixture = path.join(root, 'test/e2e/fixture-project-ts7');
const require = createRequire(path.join(fixture, 'package.json'));
const native = path.dirname(
  fs.realpathSync(require.resolve('typescript-7/package.json'))
);
const legacy = path.dirname(
  fs.realpathSync(
    createRequire(path.join(root, 'package.json')).resolve(
      'typescript/package.json'
    )
  )
);
const version = JSON.parse(
  fs.readFileSync(path.join(root, 'packages/vscode-graphqlsp/package.json'))
).version;
const vsix = args.includes('--vsix')
  ? path.resolve(option('--vsix'))
  : path.join(
      root,
      `packages/vscode-graphqlsp/vscode-graphqlsp-${version}.vsix`
    );
const results = args.includes('--results')
  ? path.resolve(option('--results'))
  : path.join(root, '.tmp/dogfood-results.json');
fs.mkdirSync(path.dirname(results), { recursive: true });
fs.mkdirSync(path.join(project, 'node_modules'), { recursive: true });
fs.mkdirSync(path.join(userData, 'User'), { recursive: true });
for (const entry of ['src', 'schema.graphql', 'tsconfig.json'])
  fs.cpSync(path.join(fixture, entry), path.join(project, entry), {
    recursive: true,
  });
for (const [name, target] of [
  ['typescript', native],
  [
    'gql.tada',
    path.dirname(fs.realpathSync(require.resolve('gql.tada/package.json'))),
  ],
])
  fs.symlinkSync(
    target,
    path.join(project, 'node_modules', name),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
fs.writeFileSync(
  path.join(project, 'package.json'),
  JSON.stringify({ name: 'graphqlsp-dogfood', private: true, type: 'module' })
);
fs.writeFileSync(
  path.join(userData, 'User/settings.json'),
  JSON.stringify({
    'js/ts.experimental.useTsgo': true,
    'js/ts.tsdk.path': native,
    'security.workspace.trust.enabled': false,
    'telemetry.telemetryLevel': 'off',
    'extensions.autoUpdate': false,
    'update.mode': 'none',
    'workbench.startupEditor': 'none',
  })
);
fs.writeFileSync(
  path.join(base, 'config.json'),
  JSON.stringify({ project, native, legacy, results })
);
fs.cpSync(
  path.join(root, 'test/vscode/extension'),
  path.join(base, 'test-extension'),
  { recursive: true }
);
const common = [
  `--user-data-dir=${userData}`,
  `--extensions-dir=${extensions}`,
];
for (const extension of ['TypeScriptTeam.native-preview', vsix]) {
  const result = spawnSync(
    code,
    [cli, ...common, '--install-extension', extension, '--force'],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'inherit',
      windowsHide: true,
    }
  );
  if (result.status !== 0)
    throw new Error(
      `Failed to install ${extension}: ${result.error || result.status}`
    );
}
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const log = fs.openSync(path.join(base, 'vscode.log'), 'w');
console.log(`Isolated editor files and logs: ${base}`);
const child = spawn(
  code,
  [
    ...common,
    '--new-window',
    '--disable-gpu',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-workspace-trust',
    `--extensionDevelopmentPath=${path.join(base, 'test-extension')}`,
    `--extensionTestsPath=${path.join(base, 'test-extension/tests.cjs')}`,
    project,
  ],
  { env, windowsHide: true, stdio: ['ignore', log, log] }
);
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    child.kill();
    reject(new Error(`Editor tests timed out; logs: ${base}`));
  }, 240000);
  child.once('error', error => {
    clearTimeout(timeout);
    reject(error);
  });
  child.once('exit', () => {
    clearTimeout(timeout);
    resolve();
  });
});
const report = JSON.parse(fs.readFileSync(results, 'utf8'));
console.log(
  `${report.tests.filter(test => test.passed).length}/${report.tests.length} real-editor checks passed. Results: ${results}`
);
if (!report.passed)
  throw new Error(
    report.tests.find(test => !test.passed)?.error || 'Editor tests failed'
  );
