import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
function workerEnvironment(options = {}) {
  const listeners = {},
    stores = new Map(),
    network = [],
    origin = 'https://roadbook.test';
  const key = (request) =>
    typeof request === 'string'
      ? new URL(request, origin).pathname
      : new URL(request.url).pathname;
  const cache = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const map = stores.get(name);
    return {
      async match(request) {
        return map.get(key(request))?.clone();
      },
      async put(request, response) {
        map.set(key(request), response.clone());
      },
      async keys() {
        return [...map.keys()].map((path) => ({ url: origin + path }));
      },
    };
  };
  const caches = {
    async open(name) {
      return cache(name);
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
  };
  class LocalRequest extends Request {
    constructor(input, init) {
      super(typeof input === 'string' ? new URL(input, origin) : input, init);
    }
  }
  const self = {
    location: { origin },
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
    clients: { async claim() {} },
    async skipWaiting() {},
  };
  const source = readFileSync(
    new URL('../public/sw.js', import.meta.url),
    'utf8',
  )
    .replace(
      "const VERSION = 'development';",
      "const VERSION = 'test-version';",
    )
    .replace(
      'const PRECACHE = [];',
      'const PRECACHE = ["/index.html", "/map.html", "/map.rsc", "/app.js"];',
    )
    .replace(
      'const PAGES = {};',
      'const PAGES = {"/": {html:"/index.html",rsc:"/index.rsc"},"/map": {html:"/map.html",rsc:"/map.rsc"}};',
    );
  runInNewContext(source, {
    self,
    caches,
    URL,
    Request: LocalRequest,
    Response,
    fetch: async (req) => {
      network.push(key(req));
      if (options.offline || options.failPath === key(req))
        throw new Error('offline');
      return new Response(key(req), {
        headers: {
          'Content-Type': key(req).endsWith('.rsc')
            ? 'text/x-component'
            : 'text/plain',
        },
      });
    },
  });
  async function event(type, properties = {}) {
    const pending = { promise: Promise.resolve() };
    listeners[type]({
      ...properties,
      waitUntil(p) {
        pending.promise = p;
      },
    });
    await pending.promise;
  }
  function fetchPage(path, headers = {}) {
    const result = { promise: Promise.resolve(new Response()), handled: false };
    listeners.fetch({
      request: new LocalRequest(path, { headers }),
      respondWith(p) {
        result.promise = p;
        result.handled = true;
      },
    });
    return result.handled ? result.promise : undefined;
  }
  return { event, fetchPage, stores, network, options };
}
test('offline worker caches complete pages, returns RSC for deep links, and excludes APIs/maps', async () => {
  const env = workerEnvironment();
  await env.event('install');
  env.options.offline = true;
  const html = await env.fetchPage('/map?day=d3&stop=local-only');
  assert.equal(await html.text(), '/map.html');
  const rsc = await env.fetchPage('/map?day=d3&_rsc=abc');
  assert.equal(await rsc.text(), '/map.rsc');
  assert.equal(rsc.headers.get('Content-Type'), 'text/x-component');
  assert.equal(await (await env.fetchPage('/app.js')).text(), '/app.js');
  for (const path of [
    '/api/amap-config',
    '/_AMapService/v3/direction/driving',
    'https://webapi.amap.com/maps',
    '/missing.js',
  ])
    assert.equal(env.fetchPage(path), undefined);
  const messages = [];
  await env.event('message', {
    data: { type: 'STATUS' },
    ports: [{ postMessage: (m) => messages.push(m) }],
  });
  assert.equal(messages[0].complete, true);
});
test('failed installation does not leave a partly cached version marked ready', async () => {
  const env = workerEnvironment({ failPath: '/app.js' });
  await assert.rejects(env.event('install'));
  assert.equal(env.stores.has('northbound-app-test-version'), false);
});
test('activation deletes only old application caches, preserving unrelated caches', async () => {
  const env = workerEnvironment();
  env.stores.set('northbound-app-old', new Map());
  env.stores.set('other-app-data', new Map());
  await env.event('install');
  await env.event('activate');
  assert.equal(env.stores.has('northbound-app-old'), false);
  assert.equal(env.stores.has('other-app-data'), true);
});
test('manifest icons have actual matching dimensions and standalone configuration', () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL('../public/manifest.webmanifest', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  for (const icon of manifest.icons) {
    const png = readFileSync(new URL('../public' + icon.src, import.meta.url));
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
});
