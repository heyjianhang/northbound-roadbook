import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  withMcpPresets,
  normalizeMcpServers,
  importMcpConfig,
  publicMcpServer,
} from '../scripts/mcp-config.mjs';

test('内置服务始终显示，旧 HTTP 配置和凭据兼容迁移', () => {
  const old = {
    id: 'weather',
    name: '天气',
    url: 'https://weather.test/mcp',
    token: 'old-secret',
    tools: ['weather_query'],
    enabled: true,
  };
  const config = normalizeMcpServers([old], [old]);
  assert.equal(config.length, 5);
  assert.deepEqual(
    config.filter((s) => s.builtin).map((s) => s.id),
    ['amap', 'websearch', 'market', 'fliggy'],
  );
  assert.ok(config.filter((s) => s.builtin).every((s) => !s.enabled));
  assert.equal(config.at(-1).transport, 'streamable_http');
  assert.equal(config.at(-1).token, 'old-secret');
});

test('导入 SSE、HTTP 别名、Markdown URL 和请求头，公开配置隐藏凭据', () => {
  const config = importMcpConfig(
    {
      mcpServers: {
        'amap-maps': {
          type: 'sse',
          url: '[高德](https://mcp.api-inference.modelscope.net/instance/sse)',
        },
        food: {
          type: 'streamableHttp',
          url: 'https://dashscope.aliyuncs.com/api/v1/mcps/market-cmapi00067124/mcp',
          headers: {
            Authorization: 'Bearer food-secret',
            'X-Api-Key': 'header-secret',
          },
        },
      },
    },
    withMcpPresets(),
  );
  assert.equal(config.length, 4);
  assert.equal(config[0].transport, 'sse');
  assert.equal(
    config[0].url,
    'https://mcp.api-inference.modelscope.net/instance/sse',
  );
  assert.equal(config[2].transport, 'streamable_http');
  assert.equal(config[2].token, 'food-secret');
  const visible = config.map(publicMcpServer);
  assert.ok(!JSON.stringify(visible).includes('secret'));
  assert.equal(visible[2].headers[0].configured, true);
  assert.equal(visible[2].tokenConfigured, true);
  const resaved = normalizeMcpServers(visible, config);
  assert.equal(resaved[2].token, 'food-secret');
  assert.equal(resaved[2].headers[0].value, 'header-secret');
});

test('更换目标清除旧凭据、选择和发现记录，客户端不能伪造发现记录', () => {
  const original = normalizeMcpServers([
    {
      id: 'custom',
      name: '查询',
      transport: 'sse',
      url: 'https://a.test/sse',
      token: 'a-secret',
      headers: [{ name: 'X-Key', value: 'header-secret' }],
      tools: ['custom_query'],
      enabled: true,
    },
  ]);
  const server = original.at(-1);
  server.discovery = { tools: [], checkedAt: 'now', error: '' };
  const visible = publicMcpServer(server);
  const changed = normalizeMcpServers(
    [{ ...visible, url: 'https://b.test/sse', discovery: { error: 'spoof' } }],
    original,
  ).at(-1);
  assert.equal(changed.token, '');
  assert.equal(changed.headers[0].value, '');
  assert.equal(changed.enabled, false);
  assert.deepEqual(changed.tools, []);
  assert.equal(changed.discovery, undefined);
  const same = normalizeMcpServers(
    [{ ...visible, discovery: { error: 'spoof' } }],
    original,
  ).at(-1);
  assert.equal(same.discovery.error, '');
});

test('兼容单服务配置，固定 stdio 导入不授权运行，不接受任意命令', () => {
  const single = importMcpConfig(
    {
      mcpServers: {
        type: 'sse',
        url: 'https://example.com/sse',
        headers: { Authorization: 'Bearer test' },
      },
    },
    withMcpPresets(),
  );
  assert.equal(single.at(-1).id, 'imported');
  const fliggy = importMcpConfig(
    {
      mcpServers: {
        FliggyTravel: {
          command: 'uvx',
          args: ['mcp-fliggy-travel==0.5.1'],
          env: { FLYAI_API_KEY: 'fly-secret' },
        },
      },
    },
    withMcpPresets(),
  )[3];
  assert.equal(fliggy.transport, 'stdio');
  assert.equal(fliggy.token, 'fly-secret');
  assert.equal(fliggy.proxyApproved, false);
  assert.equal(publicMcpServer(fliggy).ready, false);
  assert.throws(
    () =>
      importMcpConfig(
        { dangerous: { command: 'sh', args: ['-c', 'echo bad'] } },
        [],
      ),
    /当前仅内置飞猪/,
  );
  assert.throws(
    () =>
      importMcpConfig(
        { invalid: { url: 'https://example.com/mcp', headers: 'token' } },
        [],
      ),
    /配置无效/,
  );
  assert.throws(
    () => importMcpConfig({ invalid: { url: 'file:///etc/passwd' } }, []),
    /HTTP/,
  );
  assert.throws(
    () =>
      importMcpConfig(
        {
          invalid: {
            url: 'https://example.com/mcp',
            headers: { Host: 'evil' },
          },
        },
        [],
      ),
    /不允许/,
  );
  assert.throws(
    () =>
      importMcpConfig(
        {
          invalid: {
            url: 'https://example.com/mcp',
            headers: { 'X-Key': 'bad\nheader' },
          },
        },
        [],
      ),
    /无效/,
  );
});
