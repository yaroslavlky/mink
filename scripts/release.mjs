import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { run } from './process.mjs';

export const root = resolve(import.meta.dirname, '..');
// Publish runtime dependencies before the CLI consumed by the install smoke test.
export const directories = ['core', 'tui', 'mcp', 'cli'];
export const destination = resolve(root, 'work/release');

export async function manifests() {
  return Promise.all(
    directories.map(async (directory) => ({
      directory,
      ...JSON.parse(await readFile(join(root, 'packages', directory, 'package.json'), 'utf8')),
    })),
  );
}

export async function archiveContents(path) {
  const buffer = gunzipSync(await readFile(path));
  const files = new Map();
  for (let offset = 0; offset + 512 <= buffer.length;) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString().replace(/\0.*$/s, '');
    const size =
      parseInt(header.subarray(124, 136).toString().replace(/\0.*$/s, '').trim(), 8) || 0;
    files.set(name, buffer.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

export async function packPackages(output = destination) {
  await mkdir(output, { recursive: true });
  const packages = await manifests();
  assert.equal(
    new Set(packages.map((pkg) => pkg.version)).size,
    1,
    'Runtime package versions must stay in sync',
  );
  const artifacts = [];
  for (const pkg of packages) {
    assert.ok(!pkg.private, `${pkg.name} is private`);
    run('pnpm', ['pack', '--pack-destination', output], {
      cwd: join(root, 'packages', pkg.directory),
    });
    const file = join(output, `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`);
    const files = await archiveContents(file);
    const manifest = JSON.parse(files.get('package/package.json').toString());
    for (const asset of ['LICENSE', 'README.md', 'dist/index.js', 'dist/index.d.ts'])
      assert.ok(files.has(`package/${asset}`), `${pkg.name}: missing ${asset}`);
    assert.ok(!files.has('package/.npmrc'), 'Do not publish registry credentials');
    for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
      assert.ok(
        !/^(workspace|catalog|link|file):/.test(version),
        `${pkg.name}: unresolved ${name}`,
      );
      if (packages.some((candidate) => candidate.name === name)) assert.equal(version, pkg.version);
    }
    if (pkg.directory === 'core')
      for (const asset of [
        'schema/mink.schema.json',
        'dist/windows-supervisor.ps1',
        'dist/windows-entry.mjs',
      ])
        assert.ok(files.has(`package/${asset}`), `Missing ${asset}`);
    if (pkg.directory === 'cli')
      assert.ok(files.get('package/dist/index.js').toString().startsWith('#!/usr/bin/env node'));
    artifacts.push({ name: pkg.name, version: pkg.version, file });
  }
  return artifacts;
}

async function publish() {
  const artifacts = await packPackages();
  const published = [];
  for (const artifact of artifacts) {
    const integrity =
      'sha512-' +
      createHash('sha512')
        .update(await readFile(artifact.file))
        .digest('base64');
    let existing;
    try {
      existing = JSON.parse(
        run('npm', [
          'view',
          `${artifact.name}@${artifact.version}`,
          'dist.integrity',
          '--json',
          '--registry=https://registry.npmjs.org/',
        ]),
      );
    } catch (error) {
      if (!String(error.stderr).includes('E404')) throw error;
    }
    if (existing) {
      assert.equal(
        existing,
        integrity,
        `${artifact.name}@${artifact.version} already exists with different contents; bump the version`,
      );
      console.log(`${artifact.name}@${artifact.version} already published with matching integrity`);
    } else {
      const tag = artifact.version.includes('-') ? 'next' : 'latest';
      run(
        'npm',
        [
          'publish',
          artifact.file,
          '--access=public',
          '--provenance',
          `--tag=${tag}`,
          '--registry=https://registry.npmjs.org/',
        ],
        { stdio: 'inherit' },
      );
      console.log(`Published ${artifact.name}@${artifact.version} (${tag})`);
    }
    published.push({ name: artifact.name, version: artifact.version });
  }
  await writeFile(
    join(destination, 'result.json'),
    JSON.stringify({ version: artifacts[0].version, packages: published }, null, 2) + '\n',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === 'publish') await publish();
    else if (process.argv[2] === 'pack') console.log(JSON.stringify(await packPackages(), null, 2));
    else if (process.argv[2] === 'check') {
      const packages = await manifests();
      assert.ok(packages.every((pkg) => !pkg.private && pkg.publishConfig?.access === 'public'));
      assert.equal(new Set(packages.map((pkg) => pkg.version)).size, 1);
      console.log('Release package metadata is valid.');
    } else throw new Error('Usage: node scripts/release.mjs check|pack|publish');
  } catch (error) {
    if (error.stdout) process.stderr.write(error.stdout);
    if (error.stderr) process.stderr.write(error.stderr);
    throw error;
  }
}
