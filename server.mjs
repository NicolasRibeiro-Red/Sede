import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDirectories = ['sede-3d', 'cube-world-lab'];
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary', '.txt': 'text/plain; charset=utf-8',
};

export function createStaticServer() {
  return createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { response.writeHead(400).end('Invalid path'); return; }
    if (pathname === '/') {
      response.writeHead(302, { Location: '/sede-3d/' }).end();
      return;
    }
    const segments = pathname.split('/').filter(Boolean);
    if (!publicDirectories.includes(segments[0]) || segments.some(part => part.startsWith('.') || part.includes('\\') || part.includes('\0'))) {
      response.writeHead(404).end('Not found');
      return;
    }
    try {
      const publicRoot = await realpath(path.join(root, segments[0]));
      let file = path.join(root, ...segments);
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      const actual = await realpath(file);
      if (!actual.startsWith(publicRoot + path.sep) || !mime[path.extname(actual)]) {
        response.writeHead(404).end('Not found'); return;
      }
      const data = await readFile(actual);
      response.writeHead(200, {
        'Content-Type': mime[path.extname(actual)], 'Content-Length': data.length,
        'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
      });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch { response.writeHead(404).end('Not found'); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 59159);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
  const server = createStaticServer();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `A porta ${port} já está em uso. Escolha outra com a variável PORT.` : error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log(`Sede beta: http://127.0.0.1:${port}/sede-3d/\nCtrl+C encerra o servidor.`));
}
