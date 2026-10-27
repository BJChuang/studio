import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeBasePath } from './base-path.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value for ${name}`);
  return args[index + 1];
}
const root = await realpath(resolve(project, option('--dir', '.')));
let configuredBase = '/';
try {
  configuredBase = JSON.parse(await readFile(resolve(root, 'site-config.json'), 'utf8')).basePath;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const basePath = normalizeBasePath(option('--base', configuredBase));
const port = Number(option('--port', process.env.PORT || '5300'));
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
const host = option('--host', '127.0.0.1');
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.md': 'text/plain; charset=utf-8',
};
function withinRoot(path) {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}
const server = createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end('Static presentation: no backend API.');
      return;
    }
    const requestedPath = new URL(req.url, 'http://localhost').pathname;
    if (basePath !== '/' && requestedPath === basePath.slice(0, -1)) {
      res.writeHead(302, { Location: `${basePath}${new URL(req.url, 'http://localhost').search}` }).end();
      return;
    }
    if (!requestedPath.startsWith(basePath)) { res.writeHead(404).end('Not found'); return; }
    const pathname = decodeURIComponent(`/${requestedPath.slice(basePath.length)}`);
    if (pathname.includes('\0') || pathname.split(/[\\/]/).some(part => part.startsWith('.'))) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const candidate = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!withinRoot(candidate)) { res.writeHead(403).end('Forbidden'); return; }
    const file = await realpath(candidate);
    if (!withinRoot(file)) { res.writeHead(403).end('Forbidden'); return; }
    const info = await stat(file);
    if (!info.isFile()) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': types[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch (error) {
    res.writeHead(error instanceof URIError ? 400 : 404).end('Not found');
  }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, host, () => {
  console.log(`Studio static preview: http://${host === '0.0.0.0' ? 'localhost' : host}:${server.address().port}${basePath}`);
  console.log(`Serving ${root}`);
});
