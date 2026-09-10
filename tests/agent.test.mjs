import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openAccounts, hashPassword } from '../scripts/accounts-store.mjs';
import { createAccountsMiddleware } from '../scripts/accounts.mjs';
import { createAgentMiddleware } from '../scripts/agent.mjs';
import { openAgentStore } from '../scripts/agent-store.mjs';
import { encodeSpeechWav } from '../features/agent/speech-recorder.ts';

async function fixture(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'roadbook-agent-'));
  const env = {
    AGENT_DATA_DIR: directory,
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'administrator-123',
  };
  const accounts = openAccounts({ ACCOUNTS_DB_PATH: ':memory:' });
  const auth = createAccountsMiddleware(env, accounts);
  const identities = {};
  for (const name of ['a', 'b']) {
    accounts.db
      .prepare(
        'INSERT INTO users(id,username,name,avatar,password_hash,role,disabled,created_at) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(
        name,
        name + 'bc',
        name,
        '',
        await hashPassword('password-12345'),
        'member',
        0,
        Date.now(),
      );
    identities[name] = 'northbound_session=' + accounts.session(name);
  }
  const calls = [],
    pending = [];
  const worker = {
    request: async (method, params, onEvent) => {
      calls.push({ method, params });
      if (method === 'run')
        return await new Promise((resolve) =>
          pending.push({ resolve, onEvent }),
        );
      return [];
    },
    cancel() {
      pending.shift()?.resolve({});
    },
    close() {
      for (const p of pending) p.resolve({});
    },
  };
  const agent = createAgentMiddleware(env, { worker, ...options });
  async function call(path, body, cookie = '', headers = {}) {
    const req = Readable.from(
      body === undefined
        ? []
        : [Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))],
    );
    Object.assign(req, {
      url: path,
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        host: 'localhost:4173',
        origin: 'http://localhost:4173',
        'content-type': 'application/json',
        cookie,
        ...headers,
      },
      socket: { remoteAddress: '127.0.0.1' },
    });
    let result;
    const response = Object.assign(new EventEmitter(), {
      writeHead(status, headers) {
        result = { status, headers };
      },
      end(text) {
        result.body = JSON.parse(text);
      },
    });
    await auth(req, response, () => agent(req, response, () => {}));
    return result;
  }
  const login = await call('/api/accounts/login', {
    username: 'admin',
    password: 'administrator-123',
  });
  identities.admin = login.headers['Set-Cookie'].split(';')[0];
  const config = {
    baseUrl: 'https://example.com/v1',
    model: 'model',
    apiKey: 'secret-value',
    embeddingModel: '',
    servers: [],
  };
  await call('/api/agent/admin/config', config, identities.admin);
  return {
    call,
    identities,
    calls,
    pending,
    accounts,
    directory,
    config,
    close: async () => {
      agent.close();
      auth.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
test('助手复用登录校验、管理员分工和跨站写入保护，配置密钥不返回', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call('/api/agent/chat')).status, 401);
    assert.equal(
      (await f.call('/api/agent/chat', undefined, f.identities.admin)).status,
      403,
    );
    assert.equal(
      (await f.call('/api/agent/admin/config', undefined, f.identities.a))
        .status,
      403,
    );
    const config = await f.call(
      '/api/agent/admin/config',
      undefined,
      f.identities.admin,
    );
    assert.equal(config.body.keyConfigured, true);
    assert.ok(!JSON.stringify(config.body).includes('secret-value'));
    assert.equal(
      (
        await f.call(
          '/api/agent/chat',
          { text: 'test', requestId: '1234567890abcdef' },
          f.identities.a,
          { origin: 'https://evil.test' },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.call(
          '/api/agent/admin/config',
          { ...f.config, baseUrl: 'file:///etc/passwd' },
          f.identities.admin,
        )
      ).status,
      400,
    );
    assert.equal(f.calls.length, 0);
  } finally {
    await f.close();
  }
});

test('语音识别只向已登录成员开放，配置隐藏凭据且不会写入共同对话', async () => {
  let calls = 0;
  const f = await fixture({
    speechFetch: async (_url, options) => {
      calls++;
      assert.equal(options.headers['X-Api-Key'], 'speech-secret');
      assert.equal(JSON.parse(options.body).user.uid, 'a');
      return new Response(
        JSON.stringify({ result: { text: '我们去吃饭吧。' } }),
        { headers: { 'X-Api-Status-Code': '20000000' } },
      );
    },
  });
  try {
    const audio = Buffer.from(
      await encodeSpeechWav([new Float32Array(16000)], 16000).arrayBuffer(),
    );
    const headers = { 'content-type': 'audio/wav' };
    assert.equal(
      (await f.call('/api/agent/speech', audio, '', headers)).status,
      401,
    );
    assert.equal(
      (await f.call('/api/agent/speech', audio, f.identities.admin, headers))
        .status,
      403,
    );
    assert.equal(
      (await f.call('/api/agent/speech', audio, f.identities.a, headers))
        .status,
      503,
    );
    const saved = await f.call(
      '/api/agent/admin/config',
      {
        ...f.config,
        speech: {
          apiKey: 'speech-secret',
          appId: 'old-app',
          accessToken: 'old-token',
        },
      },
      f.identities.admin,
    );
    assert.equal(saved.body.speech.ready, true);
    assert.equal(saved.body.speech.keyConfigured, true);
    assert.ok(!JSON.stringify(saved.body).includes('speech-secret'));
    assert.ok(!JSON.stringify(saved.body).includes('old-token'));
    // Saving again with blank / masked credentials retains the server-side values.
    await f.call(
      '/api/agent/admin/config',
      {
        ...saved.body,
        speech: { ...saved.body.speech, apiKey: '', accessToken: '' },
      },
      f.identities.admin,
    );
    assert.equal(
      (
        await f.call('/api/agent/speech', audio, f.identities.a, {
          ...headers,
          origin: 'https://evil.example',
        })
      ).status,
      403,
    );
    assert.equal(
      (await f.call('/api/agent/speech', audio, f.identities.a)).status,
      415,
    );
    assert.equal(
      (
        await f.call(
          '/api/agent/speech',
          Buffer.from('bad-audio'),
          f.identities.a,
          headers,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await f.call('/api/agent/speech', audio, f.identities.a, {
          ...headers,
          'content-length': '9999999',
        })
      ).status,
      413,
    );
    assert.equal(calls, 0);
    const result = await f.call(
      '/api/agent/speech',
      audio,
      f.identities.a,
      headers,
    );
    assert.deepEqual(result.body, { text: '我们去吃饭吧。' });
    assert.equal(result.status, 200);
    assert.equal(calls, 1);
    const snapshot = (
      await f.call('/api/agent/chat', undefined, f.identities.b)
    ).body;
    assert.equal(snapshot.speechReady, true);
    assert.deepEqual(snapshot.messages, []);
    assert.ok(!JSON.stringify(snapshot).includes('speech-secret'));
    f.accounts.db.prepare('UPDATE users SET disabled=1 WHERE id=?').run('a');
    assert.equal(
      (await f.call('/api/agent/speech', audio, f.identities.a, headers))
        .status,
      401,
    );
    assert.equal(calls, 1);
  } finally {
    await f.close();
  }
});
test('共同消息双人可见，私聊入口关闭，客户端不能伪造发言者，串行运行和停止权限有效', async () => {
  const f = await fixture();
  try {
    const posted = await f.call(
      '/api/agent/chat?scope=shared',
      { text: '九点出发', userId: 'b', requestId: '1234567890abcdef' },
      f.identities.a,
    );
    assert.equal(posted.status, 202);
    assert.equal(f.calls[0].params.user.id, 'a');
    assert.equal(
      (await f.call('/api/agent/chat?scope=shared', undefined, f.identities.b))
        .body.messages[0].authorId,
      'a',
    );
    assert.equal(
      (await f.call('/api/agent/chat?scope=private', undefined, f.identities.b))
        .status,
      400,
    );
    assert.equal(
      (
        await f.call(
          '/api/agent/chat?scope=shared',
          { text: '再来一次', requestId: '1234567890abcdeg' },
          f.identities.b,
        )
      ).status,
      409,
    );
    assert.equal(
      (await f.call('/api/agent/stop?scope=shared', {}, f.identities.b)).status,
      403,
    );
    f.pending[0].onEvent({ type: 'delta', text: '好的' });
    f.pending.shift().resolve({});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      (
        await f.call('/api/agent/chat?scope=shared', undefined, f.identities.b)
      ).body.messages.at(-1).text,
      '好的',
    );
    const repeat = await f.call(
      '/api/agent/chat?scope=shared',
      { text: '九点出发', requestId: '1234567890abcdef' },
      f.identities.a,
    );
    assert.equal(repeat.body.messages.length, 2);
    assert.equal(f.calls.length, 1);
    await f.call(
      '/api/agent/chat',
      { text: '下一个计划', requestId: '1234567890abcdeh' },
      f.identities.a,
    );
    assert.equal(f.calls.at(-1).params.history.length, 3);
    assert.equal(
      (
        await f.call(
          '/api/agent/chat?scope=private&userId=a',
          undefined,
          f.identities.b,
        )
      ).status,
      400,
    );
    assert.equal(
      (await f.call('/api/agent/stop', {}, f.identities.a)).status,
      200,
    );
    await new Promise((resolve) => setImmediate(resolve));
    f.accounts.db.prepare('UPDATE users SET disabled=1 WHERE id=?').run('a');
    assert.equal(
      (await f.call('/api/agent/chat', undefined, f.identities.a)).status,
      401,
    );
  } finally {
    await f.close();
  }
});
test('聊天持久化，重启将未完成回复标记为中断，环境配置优先', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'roadbook-chat-'));
  let db;
  try {
    db = openAgentStore({ AGENT_DATA_DIR: directory });
    const user = { id: 'a', name: '健航' },
      id = db.conversation();
    db.addMessage(id, user, '你好', 'request1');
    db.close();
    db = openAgentStore({
      AGENT_DATA_DIR: directory,
      AGENT_MODEL: 'env-model',
    });
    assert.equal(db.messages(id).length, 2);
    assert.equal(db.messages(id)[1].status, 'interrupted');
    assert.equal(db.publicConfig().model, 'env-model');
    assert.deepEqual(db.publicConfig().envManaged, ['model']);
  } finally {
    db?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('管理员导入与测试 MCP 后保存连接状态，成员不能修改配置', async () => {
  const gatewayCalls = [];
  const f = await fixture({
    gateway: {
      async request(method, server) {
        gatewayCalls.push({ method, server });
        return {
          tools: [
            {
              name: 'query_search',
              sourceName: 'query_搜索',
              description: '网页搜索',
              schema: {},
              readOnly: true,
            },
          ],
        };
      },
      close() {},
    },
  });
  try {
    const input = {
      mcpServers: {
        query: {
          type: 'sse',
          url: 'https://search.test/sse',
          headers: {
            Authorization: 'Bearer test-secret',
            'X-Key': 'header-secret',
          },
        },
      },
    };
    assert.equal(
      (await f.call('/api/agent/admin/mcp-import', input, f.identities.a))
        .status,
      403,
    );
    const imported = await f.call(
      '/api/agent/admin/mcp-import',
      input,
      f.identities.admin,
    );
    assert.equal(imported.status, 200);
    assert.equal(imported.body.model, 'model');
    assert.equal(imported.body.servers.length, 5);
    assert.ok(!JSON.stringify(imported.body).includes('test-secret'));
    const tested = await f.call(
      '/api/agent/admin/mcp-test',
      { id: 'query' },
      f.identities.admin,
    );
    assert.equal(tested.status, 200);
    assert.equal(gatewayCalls[0].method, 'list');
    assert.equal(gatewayCalls[0].server.token, 'test-secret');
    assert.equal(
      tested.body.config.servers.at(-1).discovery.tools[0].sourceName,
      'query_搜索',
    );
    const saved = await f.call(
      '/api/agent/admin/config',
      tested.body.config,
      f.identities.admin,
    );
    assert.equal(saved.body.servers.at(-1).discovery.tools.length, 1);
    assert.ok(!JSON.stringify(saved.body).includes('header-secret'));
    const changed = {
      ...saved.body,
      servers: saved.body.servers.map((s) =>
        s.id === 'query'
          ? { ...s, transport: 'streamable_http', url: 'https://new.test/mcp' }
          : s,
      ),
    };
    const updated = await f.call(
      '/api/agent/admin/config',
      changed,
      f.identities.admin,
    );
    assert.equal(updated.body.servers.at(-1).tokenConfigured, false);
    assert.equal(updated.body.servers.at(-1).discovery, undefined);
  } finally {
    await f.close();
  }
});
