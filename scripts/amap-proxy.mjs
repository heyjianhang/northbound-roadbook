/** 仅代理高德 JS API 所需的只读接口，安全密钥始终留在服务端。 */
export function createAmapMiddleware(env, fetcher = fetch) {
  const buckets = new Map();
  const key = env.AMAP_JS_KEY || '',
    secret = env.AMAP_SECURITY_JS_CODE || '';
  return async (req, res, next) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (
      url.pathname !== '/api/amap-config' &&
      !url.pathname.startsWith('/_AMapService/')
    )
      return next();
    const json = (status, body) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET') return json(405, { error: '只支持 GET' });
    if (url.pathname === '/api/amap-config')
      return json(200, {
        configured: !!(key && secret),
        key: secret ? key : '',
        proxyPath: '/_AMapService',
      });
    if (!key || !secret)
      return json(503, {
        error: '请先在 .env.local 配置高德 JS API Key 与安全密钥。',
      });
    if (req.headers['sec-fetch-site'] === 'cross-site')
      return json(403, { error: '不接受跨站请求' });
    if ((req.url || '').length > 12000) return json(414, { error: '请求过长' });
    const path = url.pathname.slice('/_AMapService'.length);
    if (
      !/^\/v[345]\/(?:place\/(?:text|around|detail)|direction\/(?:driving|car)|map\/styles)$/.test(
        path,
      )
    )
      return json(404, { error: '该高德接口未启用' });
    const now = Date.now(),
      ip = req.socket.remoteAddress || 'local';
    for (const [k, v] of buckets) if (now - v.at > 60000) buckets.delete(k);
    const bucket = buckets.get(ip) || { at: now, count: 0 };
    if (++bucket.count > 90)
      return json(429, { error: '查询过于频繁，请稍后重试' });
    buckets.set(ip, bucket);
    const upstream = new URL(
      path,
      path === '/v4/map/styles'
        ? 'https://webapi.amap.com'
        : 'https://restapi.amap.com',
    );
    upstream.search = url.search;
    upstream.searchParams.set('key', key);
    upstream.searchParams.set('jscode', secret);
    try {
      const response = await fetcher(upstream, {
        signal: AbortSignal.timeout(18000),
        redirect: 'error',
      });
      const body = await response.text();
      // 不记录上游 URL，也不向浏览器返回包含安全密钥的响应。
      if (body.includes(secret))
        return json(502, { error: '高德返回异常，请检查服务端配置' });
      res.writeHead(response.status, {
        'Content-Type':
          response.headers.get('content-type') || 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch {
      json(502, { error: '高德服务暂时不可用，请检查网络和密钥权限后重试' });
    }
  };
}
