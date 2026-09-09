/* Values are replaced by scripts/build-pwa.mjs after static export. */
const VERSION = 'development';
const PRECACHE = [];
const PAGES = {};
const PREFIX = 'northbound-app-';
const CACHE = PREFIX + VERSION;

async function status() {
  const cache = await caches.open(CACHE);
  const keys = new Set((await cache.keys()).map(r => new URL(r.url).pathname));
  const count = PRECACHE.filter(path => keys.has(path)).length;
  return { complete: PRECACHE.length > 0 && count === PRECACHE.length, count, version: VERSION };
}
async function cacheAll(port) {
  const cache = await caches.open(CACHE);
  for (const [index, path] of PRECACHE.entries()) {
    if (!(await cache.match(path))) {
      const response = await fetch(new Request(path, { cache: 'reload', credentials: 'same-origin' }));
      if (!response.ok) throw new Error('部分离线内容下载失败，请重试');
      await cache.put(path, response);
    }
    port?.postMessage({ type: 'PROGRESS', done: index + 1, total: PRECACHE.length });
  }
  return status();
}
self.addEventListener('install', event => {
  // A failed install never activates a partly cached application version.
  event.waitUntil(cacheAll().catch(async error => { await caches.delete(CACHE); throw error; }));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  const port = event.ports[0];
  if (event.data?.type === 'ACTIVATE_UPDATE') { event.waitUntil(self.skipWaiting()); return; }
  if (!port) return;
  event.waitUntil((async () => {
    try {
      if (event.data?.type === 'SAVE_OFFLINE') port.postMessage(await cacheAll(port));
      else if (event.data?.type === 'STATUS') port.postMessage(await status());
      else port.postMessage({ error: '不支持的操作' });
    } catch (e) { port.postMessage({ error: e instanceof Error ? e.message : '离线保存失败' }); }
  })());
});
self.addEventListener('fetch', event => {
  const req = event.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/_AMapService/')) return;
  const route = url.pathname.replace(/\/$/, '') || '/';
  const page = PAGES[route];
  const isRsc = url.searchParams.has('_rsc') || req.headers.get('rsc') === '1';
  const path = page ? (isRsc ? page.rsc : page.html) : url.pathname;
  if (!path || !PRECACHE.includes(path)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE), cached = await cache.match(path);
    if (cached) return cached;
    // Never substitute HTML for RSC, JavaScript, or a missing API response.
    const response = await fetch(req);
    if (response.ok) await cache.put(path, response.clone());
    return response;
  })());
});
