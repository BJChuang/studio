import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localizeAssetPaths, normalizeBasePath } from './base-path.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist');
const args = process.argv.slice(2);
const baseIndex = args.indexOf('--base');
if (baseIndex >= 0 && !args[baseIndex + 1]) throw new Error('Missing --base value');
const basePath = normalizeBasePath(baseIndex >= 0 ? args[baseIndex + 1] : '/');
await mkdir(output, { recursive: true });
for (const entry of ['index.html', 'favicon.svg', 'src', 'creator-prototype', 'provenance.json']) {
  await cp(resolve(root, entry), resolve(output, entry), { recursive: true });
}
for (const entry of ['src/main.js', 'src/prototypeSurface.js', 'src/generated/initializePrototype.js', 'src/generated/markup.js']) {
  const source = await readFile(resolve(root, entry), 'utf8');
  await writeFile(resolve(output, entry), localizeAssetPaths(source, basePath));
}
await writeFile(resolve(output, '.nojekyll'), '');
await writeFile(resolve(output, 'site-config.json'), `${JSON.stringify({ basePath }, null, 2)}\n`);
console.log(`Static files ready: ${output}`);
console.log(`Deployment base path: ${basePath}`);
