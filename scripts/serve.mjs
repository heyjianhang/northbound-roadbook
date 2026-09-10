import { createServer } from 'node:http';
import { loadEnvFile } from 'node:process';
import { createAccountsMiddleware } from './accounts.mjs';
import { createAgentMiddleware } from './agent.mjs';
import { createAmapMiddleware } from './amap-proxy.mjs';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(
  fileURLToPath(new URL('../dist/client/', import.meta.url)),
);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.rsc': 'text/x-component',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
export function createHandler(env = process.env, staticRoot = root) {
  const amap = createAmapMiddleware(env);
  const accounts = createAccountsMiddleware(env);
  const agent = createAgentMiddleware(env);
  const handler = async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405);
        res.end();
        return;
      }
      const url = new URL(req.url || '/', 'http://localhost');
      if (
        url.pathname === '/api/amap-config' ||
        url.pathname.startsWith('/_AMapService/')
      ) {
        await amap(req, res, () => {
          res.writeHead(404);
          res.end();
        });
        return;
      }
      let pathname = decodeURIComponent(url.pathname);
      if (
        pathname.includes('\0') ||
        pathname.split('/').some((p) => p.startsWith('.'))
      ) {
        res.writeHead(404);
        res.end();
        return;
      }
      const isRsc = url.searchParams.has('_rsc') || req.headers.rsc === '1';
      const pagePath = pathname.replace(/\/$/, '') || '/';
      if (
        [
          '/',
          '/map',
          '/place',
          '/place/add',
          '/place/edit',
          '/reorder',
          '/settings',
        ].includes(pagePath)
      ) {
        // Vinext static export emits fixed HTML and RSC pairs. Query parameters
        // select fixed content; they must not become filesystem paths.
        pathname =
          (pagePath === '/' ? '/index' : pagePath) + (isRsc ? '.rsc' : '.html');
      }
      const target = resolve(staticRoot, '.' + pathname);
      if (!target.startsWith(staticRoot + sep)) {
        res.writeHead(404);
        res.end();
        return;
      }
      try {
        const info = await stat(target);
        if (!info.isFile()) throw new Error('not a file');
        const content = await readFile(target);
        res.writeHead(200, {
          'Content-Type': mime[extname(target)] || 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff',
          ...(pathname === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {}),
          'Cache-Control': pathname.startsWith('/_next/static/')
            ? 'public,max-age=31536000,immutable'
            : 'no-cache',
        });
        res.end(req.method === 'HEAD' ? undefined : content);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('页面不存在');
      }
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end('服务暂时不可用');
    }
  };
  const secured = (req, res) =>
    accounts(req, res, () => agent(req, res, () => handler(req, res)));
  secured.close = () => {
    agent.close();
    accounts.close();
  };
  return secured;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    await stat(resolve(root, 'index.html'));
  } catch {
    process.stderr.write(
      '未找到 dist/client/index.html，请先运行 npm run build。\n',
    );
    process.exit(1);
  }
  try {
    loadEnvFile(fileURLToPath(new URL('../.env.local', import.meta.url)));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('本地环境文件读取失败');
  }
  const port = Number(process.env.PORT || 4173),
    host = process.env.HOST || '127.0.0.1';
  const server = createServer(createHandler());
  server.listen(port, host, () =>
    process.stdout.write(`北行路书（静态预览）：http://${host}:${port}/\n`),
  );
}
