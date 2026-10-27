import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';
import { loadStudioModules } from '../src/moduleLoader.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestURL = new URL('https://example.test/studio/src/generated/bundles.json');

function fixture() {
  const resources = new Map();
  const sources = ['export const value = "创作台运行程序";', 'export const value = "模板与本地素材";'];
  const manifest = { version: 1, modules: sources.map((source, index) => {
    const bytes = Buffer.from(source);
    const compressed = gzipSync(bytes);
    const parts = [];
    for (let start = 0; start < compressed.length; start += 19) {
      const part = compressed.subarray(start, start + 19);
      const file = `test-${index}-${start}.bin`;
      parts.push({ file, bytes: part.length, sha256: sha256(part) });
      resources.set(new URL(file, manifestURL).href, part);
    }
    return { bytes: bytes.length, sha256: sha256(bytes), parts };
  }) };
  const fetcher = async url => {
    if (String(url) === manifestURL.href) return Response.json(manifest);
    const bytes = resources.get(String(url));
    return bytes ? new Response(bytes) : new Response(null, { status: 404 });
  };
  return { manifest, resources, fetcher };
}
const importModule = source => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('reassembles compressed modules across chunk boundaries without changing their source', async () => {
  const { fetcher } = fixture();
  const progress = [];
  const modules = await loadStudioModules(manifestURL, { fetcher, importModule, onProgress: (loaded, total) => progress.push([loaded, total]) });
  assert.deepEqual(modules.map(module => module.value), ['创作台运行程序', '模板与本地素材']);
  assert.equal(progress.at(-1)[0], progress.at(-1)[1]);
  assert.ok(progress.every(([loaded, total]) => loaded >= 0 && loaded <= total));
});

test('retries only an interrupted chunk instead of downloading successful chunks again', async () => {
  const { fetcher, resources } = fixture();
  const target = [...resources.keys()][1];
  const counts = new Map();
  const interrupted = async (url, options) => {
    const key = String(url);
    counts.set(key, (counts.get(key) || 0) + 1);
    if (key === target && counts.get(key) === 1) {
      const bytes = resources.get(key);
      return new Response(bytes.subarray(0, bytes.length - 1));
    }
    return fetcher(url, options);
  };
  const modules = await loadStudioModules(manifestURL, { fetcher: interrupted, importModule });
  assert.equal(modules[0].value, '创作台运行程序');
  assert.equal(counts.get(target), 2);
  for (const key of resources.keys()) if (key !== target) assert.equal(counts.get(key), 1, key);
});

test('rejects persistent corruption without importing any incomplete program', async () => {
  const { fetcher, resources } = fixture();
  const target = [...resources.keys()][0];
  let imported = false;
  let attempts = 0;
  const corrupt = async (url, options) => {
    if (String(url) === target) { attempts++; return new Response(new Uint8Array(resources.get(target).length)); }
    return fetcher(url, options);
  };
  await assert.rejects(loadStudioModules(manifestURL, {
    fetcher: corrupt, attempts: 2,
    importModule: () => { imported = true; },
  }), /资源不完整/);
  assert.equal(attempts, 2);
  assert.equal(imported, false);
});

test('a stalled request times out so the loading screen can offer retry', async () => {
  let aborted = false;
  const stalled = (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true });
  });
  await assert.rejects(loadStudioModules(manifestURL, { fetcher: stalled, timeoutMs: 20, attempts: 1 }), /下载超时/);
  assert.equal(aborted, true);
});

test('user retry aborts an older load and does not start more requests', async () => {
  const controller = new AbortController();
  let calls = 0;
  const stalled = (_url, { signal }) => new Promise((resolve, reject) => {
    calls++;
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    queueMicrotask(() => controller.abort(new Error('重新打开')));
  });
  await assert.rejects(loadStudioModules(manifestURL, { fetcher: stalled, signal: controller.signal }), /重新打开/);
  assert.equal(calls, 1);
});
