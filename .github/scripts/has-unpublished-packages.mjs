import { appendFileSync, existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { marketplaceVersionExists } from './marketplace.mjs';

// .staging is the vsix staging area of the VSCode extension; it contains a
// copy of the extension's manifest with the `private` flag stripped
const ignoredDirectories = new Set(['.git', 'dist', 'node_modules', '.staging']);
const workspaceRoot = process.cwd();
const hasWorkspaceManifest = existsSync(path.join(workspaceRoot, 'pnpm-workspace.yaml'));

async function findPackageManifests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const manifests = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        manifests.push(...(await findPackageManifests(fullPath)));
      }
    } else if (entry.isFile() && entry.name === 'package.json') {
      if (hasWorkspaceManifest && fullPath === path.join(workspaceRoot, 'package.json')) {
        continue;
      }

      const pkg = JSON.parse(await readFile(fullPath, 'utf8'));

      if (!pkg.private && pkg.name && pkg.version) {
        manifests.push({ name: pkg.name, version: pkg.version });
      }
    }
  }

  return manifests;
}

async function hasPublishedVersion(pkg) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  });

  if (response.status === 404) {
    return false;
  }

  if (!response.ok) {
    throw new Error(`Failed to query ${pkg.name}: ${response.status} ${response.statusText}`);
  }

  const metadata = await response.json();
  return Object.prototype.hasOwnProperty.call(metadata.versions ?? {}, pkg.version);
}

async function main() {
  const packages = (await findPackageManifests(process.cwd())).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  let hasUnpublishedNpm = false;

  for (const pkg of packages) {
    const isPublished = await hasPublishedVersion(pkg);

    if (isPublished) {
      console.log(`${pkg.name}@${pkg.version} is already published`);
    } else {
      console.log(`${pkg.name}@${pkg.version} is not published yet`);
      hasUnpublishedNpm = true;
    }
  }

  const extensionManifest = JSON.parse(
    await readFile(path.join(workspaceRoot, 'packages/vscode-graphqlsp/package.json'), 'utf8')
  );
  const extensionId = `${extensionManifest.publisher}.${extensionManifest.name}`;
  const extensionIsPublished = await marketplaceVersionExists(extensionManifest);
  console.log(
    `${extensionId}@${extensionManifest.version} is ${
      extensionIsPublished ? 'already published' : 'not published yet'
    }`
  );

  const hasUnpublishedExtension = !extensionIsPublished;
  const hasUnpublished = hasUnpublishedNpm || hasUnpublishedExtension;
  const output =
    [
      `has_unpublished=${String(hasUnpublished)}`,
      `has_unpublished_npm=${String(hasUnpublishedNpm)}`,
      `has_unpublished_vscode_extension=${String(hasUnpublishedExtension)}`,
      `should_publish=${String(hasUnpublished)}`,
    ].join('\n') + '\n';

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, output);
  } else {
    process.stdout.write(output);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
