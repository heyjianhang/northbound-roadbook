import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAmapMiddleware } from '../scripts/amap-proxy.mjs';
async function call(middleware, url, method = 'GET', headers = {}) {
  const result = { status: 0, body: '', headers: {}, next: false };
  await middleware(
    { url, method, headers, socket: { remoteAddress: '127.0.0.1' } },
    {
      writeHead(status, headers) {
        result.status = status;
        result.headers = headers;
      },
      end(body) {
        result.body = body;
      },
    },
    () => (result.next = true),
  );
  return result;
}
void test('未配置时明确返回状态，不泄露安全密钥', async () => {
  const m = createAmapMiddleware({});
  assert.deepEqual(JSON.parse((await call(m, '/api/amap-config')).body), {
    configured: false,
    key: '',
    proxyPath: '/_AMapService',
  });
  assert.equal((await call(m, '/_AMapService/v3/place/text')).status, 503);
});
void test('配置只返回公共 JS Key，代理覆盖请求内的 key/jscode', async () => {
  let target;
  const m = createAmapMiddleware(
    { AMAP_JS_KEY: 'public-key', AMAP_SECURITY_JS_CODE: 'server-secret' },
    async (url) => {
      target = url;
      return new Response('{"status":"1"}');
    },
  );
  const config = await call(m, '/api/amap-config');
  assert.equal(config.body.includes('server-secret'), false);
  const r = await call(
    m,
    '/_AMapService/v3/place/text?key=evil&jscode=bad&keywords=test',
  );
  assert.equal(r.status, 200);
  assert.equal(target.hostname, 'restapi.amap.com');
  assert.equal(target.searchParams.get('jscode'), 'server-secret');
  assert.equal(target.searchParams.get('key'), 'public-key');
});
void test('限制路径、写入方法和跨站请求，普通页面交给静态服务', async () => {
  const m = createAmapMiddleware({
    AMAP_JS_KEY: 'a',
    AMAP_SECURITY_JS_CODE: 'b',
  });
  assert.equal((await call(m, '/_AMapService/https://evil.test')).status, 404);
  assert.equal(
    (await call(m, '/_AMapService/v3/place/text', 'POST')).status,
    405,
  );
  assert.equal(
    (
      await call(m, '/_AMapService/v3/place/text', 'GET', {
        'sec-fetch-site': 'cross-site',
      })
    ).status,
    403,
  );
  assert.equal((await call(m, '/')).next, true);
});
void test('上游异常脱敏、网络异常不会将 URL 或密钥返回客户端', async () => {
  const env = { AMAP_JS_KEY: 'public', AMAP_SECURITY_JS_CODE: 'secret-value' };
  const m = createAmapMiddleware(env, async () => new Response('secret-value'));
  assert.equal((await call(m, '/_AMapService/v3/place/text')).status, 502);
  const n = createAmapMiddleware(env, async () => {
    throw new Error('secret-value');
  });
  const r = await call(n, '/_AMapService/v3/place/text');
  assert.equal(r.body.includes('secret-value'), false);
});
