import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHandler } from '../scripts/serve.mjs';
async function call(handler, url, headers = {}, method = 'GET') {
  let resolve;
  const completed = new Promise((r) => {
    resolve = r;
  });
  const result = {};
  const res = {
    headersSent: false,
    writeHead(status, responseHeaders = {}) {
      result.status = status;
      result.headers = responseHeaders;
      this.headersSent = true;
    },
    end(body) {
      result.body = body?.toString();
      resolve(result);
    },
  };
  await handler(
    { url, headers, method, socket: { remoteAddress: '127.0.0.1' } },
    res,
  );
  return completed;
}
test('static deep links return the correct HTML/RSC and PWA MIME types', async () => {
  const root = await mkdtemp(join(tmpdir(), 'northbound-static-'));
  try {
    await Promise.all(
      [
        'index.html',
        'index.rsc',
        'map.html',
        'map.rsc',
        'manifest.webmanifest',
        'sw.js',
      ].map((name) => writeFile(join(root, name), name)),
    );
    const handler = createHandler({}, root);
    assert.equal(
      (await call(handler, '/map?day=d3&stop=local-id')).body,
      'map.html',
    );
    assert.equal(
      (await call(handler, '/map/?day=d3&_rsc=random')).body,
      'map.rsc',
    );
    assert.equal(
      (await call(handler, '/map', { rsc: '1' })).headers['Content-Type'],
      'text/x-component',
    );
    assert.equal((await call(handler, '/?day=d2')).body, 'index.html');
    assert.match(
      (await call(handler, '/manifest.webmanifest')).headers['Content-Type'],
      /application\/manifest\+json/,
    );
    assert.equal(
      (await call(handler, '/sw.js')).headers['Service-Worker-Allowed'],
      '/',
    );
    assert.equal(
      (await call(handler, '/sw.js')).headers['Cache-Control'],
      'no-cache',
    );
    assert.equal((await call(handler, '/map', {}, 'HEAD')).body, undefined);
    for (const path of [
      '/.env.local',
      '/%2eenv',
      '/place/unknown',
      '/missing.js',
      '/%00',
    ])
      assert.equal((await call(handler, path)).status, 404);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
