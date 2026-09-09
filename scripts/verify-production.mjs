import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const origin = process.argv[2] || 'http://127.0.0.1:4173';
const root = new URL('../dist/client/', import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL('pwa-assets.json', root), 'utf8'),
);
const hash = (data) => createHash('sha256').update(data).digest('hex');
for (const [path, page] of Object.entries(manifest.pages)) {
  for (const rsc of [false, true]) {
    const url = new URL(path, origin);
    url.searchParams.set('day', 'd3');
    url.searchParams.set('stop', 'local-created-stop');
    if (rsc) url.searchParams.set('_rsc', 'smoke');
    const response = await fetch(url);
    assert.equal(response.status, 200, url.pathname);
    assert.match(
      response.headers.get('Content-Type'),
      rsc ? /text\/x-component/ : /text\/html/,
    );
    const served = Buffer.from(await response.arrayBuffer()),
      expected = await readFile(
        new URL((rsc ? page.rsc : page.html).slice(1), root),
      );
    assert.equal(
      hash(served),
      hash(expected),
      `Wrong export file at ${url.pathname}`,
    );
  }
}
const resources = await Promise.all(
  manifest.assets.map(async (path) => {
    const response = await fetch(new URL(path, origin));
    assert.equal(response.status, 200, path);
    const served = Buffer.from(await response.arrayBuffer()),
      expected = await readFile(new URL(path.slice(1), root));
    assert.equal(hash(served), hash(expected), `Asset changed: ${path}`);
    return path;
  }),
);
const sw = await fetch(new URL('/sw.js', origin));
assert.equal(sw.headers.get('Service-Worker-Allowed'), '/');
assert.equal(sw.headers.get('Cache-Control'), 'no-cache');
assert.ok((await sw.text()).includes(manifest.version));
const webmanifest = await fetch(new URL('/manifest.webmanifest', origin));
assert.match(
  webmanifest.headers.get('Content-Type'),
  /application\/manifest\+json/,
);
const configResponse = await fetch(new URL('/api/amap-config', origin));
assert.equal(configResponse.status, 200);
const config = await configResponse.json();
assert.equal(typeof config.configured, 'boolean');
assert.equal(config.proxyPath, '/_AMapService');
assert.deepEqual(Object.keys(config).sort(), [
  'configured',
  'key',
  'proxyPath',
]);
assert.equal(configResponse.headers.get('Cache-Control'), 'no-store');
const browserReport = await readFile(
  new URL('../docs/browser-verification-2026-09-09.json', import.meta.url),
  'utf8',
)
  .then(JSON.parse)
  .catch(() => null);
const result = {
  checkedAt: new Date().toISOString(),
  origin,
  buildVersion: manifest.version,
  pages: Object.keys(manifest.pages).length,
  pageChecks:
    'All fixed HTML/RSC routes returned matching exported content with local day/stop parameters',
  precacheResources: resources.length,
  assetChecks:
    'Every generated offline resource returned 200 and matched its build SHA-256',
  workerChecks: 'Version and service worker scope/cache headers verified',
  amapMode:
    'AMap JS API with server-side security proxy; external navigation links',
  browserInteractionTested: browserReport?.buildVersion === manifest.version,
  browserReport:
    browserReport?.buildVersion === manifest.version
      ? 'browser-verification-2026-09-09.json'
      : null,
  actualPhonePwaTested: false,
  actualAmapQueryTested: false,
};
await writeFile(
  new URL('../docs/verification-2026-09-09.json', import.meta.url),
  JSON.stringify(result, null, 2) + '\n',
);
console.log(JSON.stringify(result, null, 2));
