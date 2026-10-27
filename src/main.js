import { createPrototypeSurface } from './prototypeSurface.js';

const host = document.getElementById('studio');
const loading = document.getElementById('loading');
const message = document.getElementById('loading-message');
const retry = document.getElementById('retry');
let surface;
let generation = 0;

// This presentation has no application server or model connection. Preserve the
// original controls and let their existing error UI explain the offline state.
function staticFetch(input, options) {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (url.origin === location.origin && url.pathname.startsWith('/creator-prototype/assets/')) {
    return window.fetch(input, options);
  }
  return Promise.reject(new Error('当前为静态展示版，未连接 AI、生成或平台后端服务。'));
}

async function mountStudio() {
  const current = ++generation;
  surface?.dispose();
  surface = undefined;
  loading.hidden = false;
  loading.setAttribute('role', 'status');
  host.setAttribute('aria-busy', 'true');
  retry.hidden = true;
  message.textContent = '正在准备创作界面…';
  try {
    if (location.protocol === 'file:') {
      throw new Error('请通过静态 HTTP 服务打开。可在项目目录运行 npm start，再访问终端中的地址。');
    }
    const [runtime, markup] = await Promise.all([
      import('./generated/initializePrototype.js'),
      import('./generated/markup.js'),
    ]);
    if (current !== generation) return;
    surface = createPrototypeSurface(host, markup);
    surface.global.fetch = staticFetch;
    surface.global.PEACH_AGENT_LOCAL_TOKEN = undefined;
    runtime.initializePrototype.call(surface.global, surface.global);
    surface.start();
    loading.hidden = true;
    host.removeAttribute('aria-busy');
  } catch (error) {
    if (current !== generation) return;
    surface?.dispose();
    surface = undefined;
    loading.setAttribute('role', 'alert');
    message.textContent = `创作台未能启动：${error instanceof Error ? error.message : String(error)}`;
    host.removeAttribute('aria-busy');
    retry.hidden = false;
    console.error('Studio initialization failed', error);
  }
}

retry.addEventListener('click', mountStudio);
void mountStudio();
