import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpGateway } from '../scripts/mcp-gateway.mjs';
import { AgentWorker } from '../scripts/agent-worker.mjs';
import { createHandler } from '../scripts/serve.mjs';
import { openAccounts } from '../scripts/accounts-store.mjs';

test(
  '真实 Deep Agents 调用 LangMem、外部 MCP 和笔记 MCP，多人共享持久化内容',
  { timeout: 90000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'roadbook-runtime-'));
    const requests = [],
      mcpCalls = [];
    const model = createServer(async (req, res) => {
      if (req.url === '/mcp') {
        if (req.method !== 'POST') {
          res.writeHead(405);
          res.end();
          return;
        }
        assert.equal(req.headers.authorization, 'Bearer mcp-test-token');
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const message = JSON.parse(raw);
        mcpCalls.push(message);
        if (message.id === undefined) {
          res.writeHead(202);
          res.end();
          return;
        }
        const result =
          message.method === 'initialize'
            ? {
                protocolVersion: message.params.protocolVersion,
                capabilities: { tools: {} },
                serverInfo: { name: 'fixture', version: '1' },
              }
            : message.method === 'tools/list'
              ? {
                  tools: [
                    {
                      name: 'weather',
                      description: '查询天气',
                      inputSchema: {
                        type: 'object',
                        properties: { city: { type: 'string' } },
                        required: ['city'],
                      },
                      annotations: { readOnlyHint: true },
                    },
                    {
                      name: 'order',
                      description: '下单',
                      inputSchema: { type: 'object', properties: {} },
                      annotations: { readOnlyHint: false },
                    },
                  ],
                }
              : { content: [{ type: 'text', text: '测试城市天气：晴，18°C' }] };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
        return;
      }
      if (req.url !== '/v1/chat/completions') {
        res.writeHead(404);
        res.end();
        return;
      }
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      requests.push(body);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const base = {
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'test-model',
      };
      const send = (delta, finish_reason = null) =>
        res.write(
          'data: ' +
            JSON.stringify({
              ...base,
              choices: [{ index: 0, delta, finish_reason }],
            }) +
            '\n\n',
        );
      send({ role: 'assistant' });
      if (requests.length === 1) {
        send({
          tool_calls: [
            {
              index: 0,
              id: 'call-memory',
              type: 'function',
              function: {
                name: 'manage_memory',
                arguments: JSON.stringify({
                  content: '我喜欢清淡口味',
                  action: 'create',
                }),
              },
            },
          ],
        });

        send({}, 'tool_calls');
      } else if (requests.length === 3) {
        send({
          tool_calls: [
            {
              index: 0,
              id: 'call-search',
              type: 'function',
              function: {
                name: 'search_trip_memory',
                arguments: JSON.stringify({ query: '口味' }),
              },
            },
          ],
        });
        send({}, 'tool_calls');
      } else if (requests.length === 5) {
        send({
          tool_calls: [
            {
              index: 0,
              id: 'call-weather',
              type: 'function',
              function: {
                name: 'fixture_weather',
                arguments: JSON.stringify({ city: '呼伦贝尔' }),
              },
            },
          ],
        });
        send({}, 'tool_calls');
      } else if (requests.length === 7 || requests.length === 8) {
        const reading = requests.length === 7;
        send({
          tool_calls: [
            {
              index: 0,
              id: reading ? 'call-read-note' : 'call-write-note',
              type: 'function',
              function: {
                name: reading
                  ? 'notes_read_place_note'
                  : 'notes_write_place_note',
                arguments: JSON.stringify(
                  reading
                    ? { place_id: 'visit-3' }
                    : {
                        place_id: 'visit-3',
                        content: '# 海拉尔美食\n\n- 想吃手把肉',
                        expected_version: 0,
                      },
                ),
              },
            },
          ],
        });
        send({}, 'tool_calls');
      } else {
        send({ content: '已经记好了。' });
        send({}, 'stop');
      }
      res.end('data: [DONE]\n\n');
    });
    await new Promise((resolve) => model.listen(0, '127.0.0.1', resolve));
    const worker = new AgentWorker({ AGENT_DATA_DIR: directory });
    const gateway = new McpGateway();
    const user = { id: 'a', name: '健航', role: 'member' },
      events = [];
    const config = {
      baseUrl: `http://127.0.0.1:${model.address().port}/v1`,
      apiKey: 'fake-test-key',
      model: 'test-model',
      embeddingModel: '',
      servers: [],
    };
    const p = {
      user,
      scope: 'shared',
      config,
      runId: 'run1',
      dayId: 'd1',
      history: [
        {
          role: 'user',
          text: '请记住我的口味',
          authorId: 'a',
          authorName: '健航',
        },
      ],
    };
    try {
      await worker.request('run', p, (e) => events.push(e));
      assert.ok(
        events.some((e) => e.type === 'delta' && e.text.includes('记好了')),
      );
      assert.ok(
        events.some(
          (e) => e.type === 'tool-start' && e.name === 'manage_memory',
        ),
      );
      let memories = await worker.request('memories', {
        user,
        scope: 'shared',
      });
      assert.equal(memories.length, 1);
      assert.match(memories[0].content, /清淡/);
      assert.equal(
        (await worker.request('memories', { user: { id: 'b', name: '旅伴' } }))
          .length,
        1,
      );
      await worker.request('memory-save', {
        user: { id: 'b', name: '旅伴' },
        memoryId: memories[0].id,
        content: '健航喜欢清淡口味',
      });
      const changed = (await worker.request('memories', { user }))[0];
      assert.equal(changed.author, '健航');
      assert.equal(changed.updatedBy, '旅伴');
      assert.equal((await worker.request('memories', { user })).length, 1);
      await worker.request(
        'run',
        {
          ...p,
          runId: 'run2',
          history: [
            {
              role: 'user',
              text: '我喜欢什么口味',
              authorId: 'a',
              authorName: '健航',
            },
          ],
        },
        (e) => events.push(e),
      );
      assert.ok(
        requests.some((r) =>
          r.messages.some(
            (m) => m.role === 'tool' && String(m.content).includes('清淡'),
          ),
        ),
      );
      const server = {
        id: 'fixture',
        name: '测试天气',
        url: `http://127.0.0.1:${model.address().port}/mcp`,
        token: 'mcp-test-token',
        enabled: true,
        tools: ['fixture_weather', 'fixture_order'],
      };
      const { tools: discovered } = await gateway.request('list', server);
      assert.equal(
        discovered.find((t) => t.name === 'fixture_weather').readOnly,
        true,
      );
      await worker.request(
        'run',
        {
          ...p,
          gateway: await gateway.ready(),
          runId: 'run3',
          config: { ...config, servers: [server] },
        },
        (e) => events.push(e),
      );
      assert.ok(
        mcpCalls.some(
          (c) => c.method === 'tools/call' && c.params.name === 'weather',
        ),
      );
      assert.ok(
        requests[4].tools.some((t) => t.function.name === 'fixture_weather'),
      );
      assert.ok(
        !requests[4].tools.some((t) => t.function.name === 'fixture_order'),
      );
      assert.ok(
        events.some((e) => e.type === 'tool-end' && e.output.includes('18°C')),
      );
      await worker.request(
        'run',
        {
          ...p,
          runId: 'run4',
          history: [
            {
              role: 'user',
              text: '把想吃手把肉写到海拉尔的笔记里',
              authorId: 'a',
              authorName: '健航',
            },
          ],
        },
        (e) => events.push(e),
      );
      const note = await worker.request('notes-read', {
        user: { id: 'b', name: '旅伴', role: 'member' },
        placeId: 'visit-17',
      });
      assert.equal(note.ok, true);
      assert.equal(note.note.content, '# 海拉尔美食\n\n- 想吃手把肉');
      assert.equal(note.note.updatedBy, 'a');
      assert.ok(
        events.some(
          (e) => e.type === 'tool-end' && e.output.includes('想吃手把肉'),
        ),
      );
      assert.ok(!JSON.stringify(requests[6].tools).includes('NOTES_USER_JSON'));
      const reopened = new AgentWorker({ AGENT_DATA_DIR: directory });
      try {
        memories = await reopened.request('memories', {
          user,
          scope: 'shared',
        });
        assert.equal(memories.length, 1);
      } finally {
        reopened.close();
      }
    } finally {
      worker.close();
      gateway.close();
      await new Promise((resolve) => model.close(resolve));
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  '生产 HTTP 同步双用户聊天及地点笔记，版本冲突和停用成员权限有效',
  { timeout: 60000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'roadbook-http-agent-'));
    const env = {
      ACCOUNTS_DB_PATH: join(directory, 'accounts.sqlite'),
      AGENT_DATA_DIR: join(directory, 'agent'),
      AGENT_API_KEY: 'fixture-key',
      AGENT_MODEL: 'test-model',
    };
    const accounts = openAccounts(env),
      cookies = {};
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
          'fixture-hash',
          'member',
          0,
          Date.now(),
        );
      cookies[name] = 'northbound_session=' + accounts.session(name);
    }
    const handler = createHandler(env);
    const server = createServer(async (req, res) => {
      if (req.url === '/v1/chat/completions') {
        for await (const _chunk of req) {
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(
          'data: ' +
            JSON.stringify({
              id: 'chatcmpl-http',
              object: 'chat.completion.chunk',
              created: 1,
              model: 'test-model',
              choices: [
                {
                  index: 0,
                  delta: {
                    role: 'assistant',
                    content: '共同回复已完成',
                  },
                  finish_reason: null,
                },
              ],
            }) +
            '\n\n',
        );
        res.end('data: [DONE]\n\n');
      } else await handler(req, res);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    env.AGENT_BASE_URL = origin + '/v1';
    const request = (path, who, body) =>
      fetch(origin + path, {
        method: body ? 'POST' : 'GET',
        headers: {
          cookie: cookies[who],
          origin,
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000),
      });
    const controllers = [];
    async function connect() {
      const controller = new AbortController();
      controllers.push(controller);
      const response = await fetch(origin + '/api/agent/events?scope=shared', {
        headers: { cookie: cookies.b },
        signal: controller.signal,
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      const reader = response.body.getReader();
      let buffer = '';
      const decoder = new TextDecoder();
      async function snapshot() {
        while (true) {
          const separator = buffer.indexOf('\n\n');
          if (separator >= 0) {
            const block = buffer.slice(0, separator);
            buffer = buffer.slice(separator + 2);
            const data = block
              .split('\n')
              .find((line) => line.startsWith('data: '));
            if (data) return JSON.parse(data.slice(6));
            continue;
          }
          const { value, done } = await reader.read();
          if (done) return null;
          buffer += decoder.decode(value, { stream: true });
        }
      }
      return { snapshot, reader };
    }
    try {
      const stream = await connect();
      assert.deepEqual((await stream.snapshot()).messages, []);
      const sent = await request('/api/agent/chat?scope=shared', 'a', {
        text: '我们聊聊今天的行程',
        requestId: 'http-fixture-123456',
      });
      assert.equal(sent.status, 202);
      let received;
      do {
        received = await stream.snapshot();
      } while (received.busy);
      assert.equal(received.messages.at(-1).text, '共同回复已完成');
      assert.equal(received.messages[0].authorName, 'a');
      assert.equal(
        (
          await request('/api/agent/memories', 'a', {
            content: '每天九点出发',
            userId: 'b',
          })
        ).status,
        200,
      );
      assert.deepEqual(await stream.snapshot(), {});
      const memory = (await (await request('/api/agent/memories', 'b')).json())
        .memories[0];
      assert.equal(memory.author, 'a');
      assert.equal(
        (
          await request('/api/agent/memories', 'b', {
            memoryId: memory.id,
            content: '每天十点出发',
          })
        ).status,
        200,
      );
      assert.deepEqual(await stream.snapshot(), {});
      const edited = (await (await request('/api/agent/memories', 'a')).json())
        .memories[0];
      assert.equal(edited.author, 'a');
      assert.equal(edited.updatedBy, 'b');
      assert.equal(edited.content, '每天十点出发');
      assert.equal(
        (
          await request('/api/agent/memories', 'b', {
            memoryId: memory.id,
            content: '',
            delete: true,
          })
        ).status,
        200,
      );
      assert.deepEqual(await stream.snapshot(), {});
      assert.deepEqual(
        (await (await request('/api/agent/memories', 'a')).json()).memories,
        [],
      );
      const emptyNote = await request('/api/agent/notes?placeId=visit-3', 'a');
      assert.equal(emptyNote.status, 200);
      assert.equal((await emptyNote.json()).note.version, 0);
      const savedNote = await request('/api/agent/notes', 'a', {
        placeId: 'visit-3',
        content: '# 海拉尔\n\n早起看日出',
        expectedVersion: 0,
        user: { id: 'b' },
      });
      assert.equal(savedNote.status, 200);
      assert.equal((await savedNote.json()).note.updatedBy, 'a');
      const sharedNote = await (
        await request('/api/agent/notes?placeId=visit-17', 'b')
      ).json();
      assert.equal(sharedNote.note.content, '# 海拉尔\n\n早起看日出');
      const conflict = await request('/api/agent/notes', 'b', {
        placeId: 'visit-2',
        content: '旧版本覆盖',
        expectedVersion: 0,
      });
      assert.equal(conflict.status, 409);
      assert.equal((await conflict.json()).note.version, 1);
      const updated = await request('/api/agent/notes', 'b', {
        placeId: 'visit-18',
        content: '# 海拉尔\n\n十点出发',
        expectedVersion: 1,
      });
      assert.equal(updated.status, 200);
      assert.equal((await updated.json()).note.updatedBy, 'b');
      const privateChat = await (
        await request('/api/agent/chat?scope=private&userId=a', 'b')
      ).json();
      assert.match(privateChat.error, /只使用共同/);
      await stream.reader.cancel();
      const reopened = await connect();
      assert.equal((await reopened.snapshot()).messages.length, 2);
      accounts.db.prepare('UPDATE users SET disabled=1 WHERE id=?').run('b');
      await request('/api/agent/chat?scope=shared', 'a', {
        text: '接着说',
        requestId: 'http-fixture-123457',
      });
      assert.equal(await reopened.snapshot(), null);
      assert.equal((await request('/api/agent/chat', 'b')).status, 401);
      assert.equal(
        (await request('/api/agent/notes?placeId=visit-2', 'b')).status,
        401,
      );
    } finally {
      for (const controller of controllers) controller.abort();
      handler.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      accounts.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
