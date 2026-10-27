import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(root, 'src/generated/sourceManifest.json'), 'utf8'));
const index = JSON.parse(await readFile(resolve(root, 'creator-prototype/asset-index.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const [file, expected] of [
  ['initializePrototype.js', manifest.compiled.initializationSHA256],
  ['markup.js', manifest.compiled.markupSHA256],
]) {
  assert.equal(hash(await readFile(resolve(root, 'src/generated', file))), expected, `${file}: source integrity`);
}
assert.deepEqual(index.assets, manifest.assetTree, 'Asset index matches original source manifest');
assert.deepEqual((await readdir(resolve(root, 'creator-prototype/assets'))).sort(), manifest.assetTree.map(asset => asset.file).sort());
let total = 0;
for (const asset of manifest.assetTree) {
  const bytes = await readFile(resolve(root, 'creator-prototype/assets', asset.file));
  assert.equal(bytes.length, asset.bytes, asset.file);
  assert.equal(hash(bytes), asset.sha256, asset.file);
  total += bytes.length;
}
assert.equal(total, manifest.counts.extractedAssetBytes);
for (const file of ['src/main.js', 'src/moduleLoader.js', 'src/prototypeSurface.js', 'src/generated/initializePrototype.js', 'src/generated/markup.js', 'scripts/serve.mjs', 'scripts/build.mjs', 'scripts/base-path.mjs']) {
  const result = spawnSync(process.execPath, ['--check', resolve(root, file)], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${file}: ${result.stderr}`);
}
console.log(`Verified: original runtime and markup; ${manifest.assetTree.length} assets (${total.toLocaleString('en-US')} bytes); JavaScript syntax.`);
