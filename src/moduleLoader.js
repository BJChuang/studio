const RETRY_DELAYS = [300, 900];

function abortError() {
  return new DOMException('加载已取消', 'AbortError');
}

function checkAbort(signal) {
  if (signal?.aborted) throw signal.reason || abortError();
}

async function digest(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
}

async function importSource(source) {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try { return await import(/* @vite-ignore */ url); }
  finally { URL.revokeObjectURL(url); }
}

function pause(ms, signal) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const done = () => { signal?.removeEventListener('abort', cancelled); resolve(); };
    const timer = setTimeout(done, ms);
    const cancelled = () => { clearTimeout(timer); reject(signal.reason || abortError()); };
    signal?.addEventListener('abort', cancelled, { once: true });
  });
}

// Every request has a deadline, and only failed chunks are downloaded again.
async function request(url, { signal, fetcher, timeoutMs, attempts, read }) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    checkAbort(signal);
    const controller = new AbortController();
    const cancel = () => controller.abort(signal.reason || abortError());
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('下载超时，请检查网络后重试')), timeoutMs);
    try {
      const response = await fetcher(url, { signal: controller.signal, cache: attempt ? 'reload' : 'default' });
      if (!response.ok) throw new Error(`资源请求失败（HTTP ${response.status}）`);
      return await read(response);
    } catch (error) {
      checkAbort(signal);
      if (attempt === attempts - 1) throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
    await pause(RETRY_DELAYS[attempt] ?? 900, signal);
  }
}

export async function loadStudioModules(manifestURL, {
  signal,
  onProgress = () => {},
  fetcher = globalThis.fetch.bind(globalThis),
  importModule = importSource,
  timeoutMs = 20000,
  attempts = 3,
  concurrency = 4,
} = {}) {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason || abortError());
  signal?.addEventListener('abort', cancel, { once: true });
  const localSignal = controller.signal;
  const options = { signal: localSignal, fetcher, timeoutMs, attempts };
  try {
    checkAbort(signal);
    const manifest = await request(manifestURL, { ...options, read: response => response.json() });
    if (manifest.version !== 1 || !Array.isArray(manifest.modules) || manifest.modules.length !== 2) {
      throw new Error('页面资源清单无效，请刷新页面');
    }
    const tasks = manifest.modules.flatMap((module, moduleIndex) => module.parts.map((part, partIndex) => ({ ...part, moduleIndex, partIndex })));
    const total = tasks.reduce((sum, task) => sum + task.bytes, 0);
    const received = new Map();
    const buffers = manifest.modules.map(module => new Array(module.parts.length));
    const progress = (task, bytes) => {
      received.set(task, bytes);
      onProgress([...received.values()].reduce((sum, value) => sum + value, 0), total);
    };
    let next = 0;
    onProgress(0, total);
    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
      while (next < tasks.length) {
        checkAbort(localSignal);
        const task = tasks[next++];
        const url = new URL(task.file, manifestURL);
        if (url.origin !== new URL(manifestURL).origin) throw new Error('资源必须来自当前站点');
        buffers[task.moduleIndex][task.partIndex] = await request(url, {
          ...options,
          read: async response => {
            progress(task, 0);
            const reader = response.body.getReader();
            const pieces = [];
            let length = 0;
            try {
              while (true) {
                checkAbort(localSignal);
                const { value, done } = await reader.read();
                if (done) break;
                pieces.push(value);
                length += value.length;
                if (length > task.bytes) throw new Error('资源大小不匹配，请刷新页面');
                progress(task, length);
              }
            } finally {
              await reader.cancel().catch(() => {});
              reader.releaseLock();
            }
            const bytes = new Uint8Array(length);
            let offset = 0;
            for (const piece of pieces) { bytes.set(piece, offset); offset += piece.length; }
            if (length !== task.bytes || await digest(bytes) !== task.sha256) throw new Error('下载中断或资源不完整，正在重试');
            return bytes;
          },
        });
      }
    });
    await Promise.all(workers);
    checkAbort(localSignal);
    return await Promise.all(manifest.modules.map(async (module, index) => {
      const compressed = new Blob(buffers[index]);
      const bytes = new Uint8Array(await new Response(compressed.stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
      if (bytes.length !== module.bytes || await digest(bytes) !== module.sha256) throw new Error('页面程序校验失败，请刷新重试');
      checkAbort(localSignal);
      return importModule(new TextDecoder().decode(bytes));
    }));
  } finally {
    controller.abort();
    signal?.removeEventListener('abort', cancel);
  }
}
