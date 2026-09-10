import { randomUUID } from 'node:crypto';
import { readJson } from './accounts.mjs';
import { requireValue, AccountError } from './accounts-store.mjs';
import { openAgentStore } from './agent-store.mjs';
import { McpGateway } from './mcp-gateway.mjs';
import { AgentWorker } from './agent-worker.mjs';
import { speechReady, readSpeechAudio, transcribeSpeech } from './speech.mjs';

export function createAgentMiddleware(env = process.env, options = {}) {
  let database;
  const store = () => (database ||= openAgentStore(env));
  const worker = options.worker || new AgentWorker(env);
  const gateway = options.gateway || new McpGateway(env);
  const listeners = new Map(),
    runs = new Map(),
    speechRuns = new Map();
  let closed = false;
  let revision = Date.now();
  function snapshot(id) {
    const c = store().config();
    return {
      revision,
      messages: store().messages(id),
      busy: runs.has(id),
      ready: Boolean(c.baseUrl && c.model && c.apiKey),
      speechReady: speechReady(c.speech),
      memoryMode: c.embeddingModel ? 'semantic' : 'keyword',
    };
  }
  function publish(id) {
    revision = Math.max(Date.now(), revision + 1);
    const data = `data: ${JSON.stringify(snapshot(id))}\n\n`;
    for (const listener of listeners.get(id) || []) {
      if (!listener.valid() || listener.res.writableLength > 1024 * 1024)
        listener.res.end();
      else listener.res.write(data);
    }
  }
  function announceMemories() {
    for (const bucket of listeners.values())
      for (const listener of bucket) {
        if (!listener.valid()) listener.res.end();
        else listener.res.write('event: memory\ndata: {}\n\n');
      }
  }
  async function execute(id, run, params) {
    const persist = () => {
      if (closed) return;
      store()
        .db.prepare('UPDATE messages SET text=?,parts=?,status=? WHERE id=?')
        .run(run.text, JSON.stringify(run.parts), run.status, run.messageId);
      publish(id);
    };
    let flush;
    const secrets = [
      params.config.apiKey,
      ...params.config.servers.flatMap((s) => [
        s.token,
        ...(s.headers || []).map((h) => h.value),
      ]),
    ].filter(Boolean);
    function safeEvent(event) {
      let json = JSON.stringify(event);
      for (const secret of secrets)
        json = json.split(JSON.stringify(secret).slice(1, -1)).join('[已隐藏]');
      return JSON.parse(json);
    }
    try {
      if (params.config.servers.some((s) => s.enabled)) {
        params.gateway = await gateway.ready();
        secrets.push(params.gateway.token);
      }
      if (closed || run.stopped) throw new Error('本次回复已停止');
      await worker.request(
        'run',
        params,
        (raw) => {
          if (closed || run.status !== 'running') return;
          const e = safeEvent(raw);
          if (e.type === 'delta') {
            run.text += e.text;
            const last = run.parts.at(-1);
            if (last?.type === 'text') last.text += e.text;
            else run.parts.push({ type: 'text', text: e.text });
            if (run.text.length > 60000) {
              worker.cancel(run.rpcId);
              return;
            }
          } else if (e.type === 'tool-start') {
            run.parts.push({
              type: 'tool',
              id: e.callId,
              name: e.name,
              input: e.input,
              state: 'input-available',
            });
          } else if (e.type === 'tool-end') {
            const part = run.parts.find(
              (p) => p.type === 'tool' && p.id === e.callId,
            );
            if (part) {
              part.output = e.output;
              part.state = e.error ? 'output-error' : 'output-available';
              if (part.name === 'manage_memory' && !e.error) announceMemories();
            }
          } else if (e.type === 'notice') run.parts.push(e);
          if (!flush)
            flush = setTimeout(() => {
              flush = null;
              persist();
            }, 100);
        },
        run.rpcId,
      );
      run.status = 'complete';
    } catch (error) {
      run.status = run.stopped ? 'stopped' : 'error';
      run.parts.push({
        type: 'notice',
        text: run.stopped
          ? '本次回复已停止。'
          : safeEvent({ text: error.message }).text,
      });
    } finally {
      clearTimeout(flush);
      for (const p of run.parts)
        if (p.type === 'tool' && p.state === 'input-available')
          p.state = 'output-error';
      runs.delete(id);
      persist();
    }
  }
  const middleware = async (req, res, next) => {
    const url = new URL(req.url || '/', 'http://local');
    if (!url.pathname.startsWith('/api/agent/')) return next();
    const send = (status, body) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify(body));
    };
    try {
      const user = req.accountUser;
      requireValue(user && req.accountValid?.(), 401, '请先登录');
      const admin = url.pathname.startsWith('/api/agent/admin/');
      requireValue(
        user.role === (admin ? 'admin' : 'member'),
        403,
        '没有操作权限',
      );
      const db = store();
      if (req.method === 'GET' && url.pathname === '/api/agent/admin/config')
        return send(200, db.publicConfig());
      if (req.method === 'POST' && url.pathname === '/api/agent/admin/config') {
        const config = db.saveConfig(await readJson(req));
        for (const id of listeners.keys()) publish(id);
        return send(200, config);
      }
      if (
        req.method === 'POST' &&
        url.pathname === '/api/agent/admin/mcp-import'
      ) {
        return send(200, db.importServers(await readJson(req)));
      }
      if (
        req.method === 'POST' &&
        url.pathname === '/api/agent/admin/mcp-test'
      ) {
        const body = await readJson(req);
        const server = db.config().servers.find((s) => s.id === body.id);
        requireValue(server, 404, '请先保存 MCP 配置');
        try {
          const { tools } = await gateway.request('list', server);
          requireValue(req.accountValid(), 401, '登录已过期');
          const visible = tools.map(({ schema: _schema, ...tool }) => tool);
          const config = db.recordMcpTest(server, {
            tools: visible,
            error: '',
          });
          return send(200, { tools: visible, config });
        } catch (error) {
          if (error instanceof AccountError) throw error;
          const message = error.message || 'MCP 连接失败';
          db.recordMcpTest(server, { tools: [], error: message });
          return send(502, { error: message });
        }
      }
      requireValue(!admin, 404, '接口不存在');
      requireValue(
        !url.searchParams.has('scope') ||
          url.searchParams.get('scope') === 'shared',
        400,
        '现在只使用共同对话与共同记忆',
      );
      const id = db.conversation();
      if (url.pathname === '/api/agent/notes') {
        requireValue(
          ['GET', 'POST'].includes(req.method),
          405,
          '此接口不支持该请求方式',
        );
        const body =
          req.method === 'POST'
            ? await readJson(req)
            : { placeId: url.searchParams.get('placeId') };
        requireValue(
          typeof body.placeId === 'string' &&
            /^[a-zA-Z0-9_-]{1,80}$/.test(body.placeId),
          400,
          '地点标识无效',
        );
        if (req.method === 'POST') {
          requireValue(
            typeof body.content === 'string' && body.content.length <= 20000,
            400,
            '笔记最多 20000 个字符',
          );
          requireValue(
            Number.isSafeInteger(body.expectedVersion) &&
              body.expectedVersion >= 0,
            400,
            '笔记版本无效',
          );
        }
        requireValue(req.accountValid(), 401, '登录已过期');
        const result = await worker.request(
          req.method === 'POST' ? 'notes-save' : 'notes-read',
          {
            user,
            placeId: body.placeId,
            content: body.content,
            expectedVersion: body.expectedVersion,
          },
        );
        requireValue(req.accountValid(), 401, '登录已过期');
        return send(result.ok ? 200 : result.status || 400, result);
      }
      if (req.method === 'GET' && url.pathname === '/api/agent/chat')
        return send(200, snapshot(id));
      if (req.method === 'GET' && url.pathname === '/api/agent/events') {
        const bucket = listeners.get(id) || new Set();
        requireValue(bucket.size < 30, 429, '打开的对话窗口过多');
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write('retry: 3000\n\n');
        const listener = { res, valid: req.accountValid };
        bucket.add(listener);
        listeners.set(id, bucket);
        res.write(`data: ${JSON.stringify(snapshot(id))}\n\n`);
        const heartbeat = setInterval(() => {
          if (!req.accountValid()) res.end();
          else res.write(': heartbeat\n\n');
        }, 15000);
        res.once('close', () => {
          clearInterval(heartbeat);
          bucket.delete(listener);
          if (!bucket.size) listeners.delete(id);
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/agent/memories') {
        const memories = await worker.request('memories', { user });
        requireValue(req.accountValid(), 401, '登录已过期');
        return send(200, { memories });
      }
      requireValue(req.method === 'POST', 405, '此接口不支持该请求方式');
      if (url.pathname === '/api/agent/speech') {
        const config = db.config().speech;
        requireValue(speechReady(config), 503, '请管理员先配置火山语音识别');
        requireValue(
          !speechRuns.has(user.id) && speechRuns.size < 4,
          429,
          '语音正在识别，请稍后再试',
        );
        const controller = new AbortController();
        controller.signal.addEventListener(
          'abort',
          () => {
            if (!req.readableEnded) req.destroy();
          },
          { once: true },
        );
        speechRuns.set(user.id, controller);
        const abort = () => controller.abort();
        res.once('close', abort);
        // Includes slow uploads, not just the provider request.
        const deadline = setTimeout(() => {
          controller.abort();
          req.destroy();
        }, 60000);
        try {
          const audio = await readSpeechAudio(req);
          requireValue(req.accountValid(), 401, '登录已过期');
          const text = await transcribeSpeech(
            audio,
            config,
            user.id,
            controller.signal,
            options.speechFetch,
          );
          requireValue(req.accountValid(), 401, '登录已过期');
          if (!controller.signal.aborted) return send(200, { text });
          return;
        } finally {
          clearTimeout(deadline);
          res.removeListener('close', abort);
          speechRuns.delete(user.id);
        }
      }
      const body = await readJson(req);
      if (url.pathname === '/api/agent/memories') {
        requireValue(
          typeof body.content === 'string' &&
            body.content.trim().length <= 2000 &&
            (body.delete || body.content.trim()),
          400,
          '请填写 1–2000 个字符的记忆',
        );
        requireValue(
          !body.memoryId ||
            (typeof body.memoryId === 'string' && body.memoryId.length <= 100),
          400,
          '记忆标识无效',
        );
        await worker.request('memory-save', {
          user,
          memoryId: body.memoryId,
          content: body.content.trim(),
          delete: body.delete === true,
        });
        announceMemories();
        return send(200, { ok: true });
      }
      if (url.pathname === '/api/agent/stop') {
        const run = runs.get(id);
        requireValue(
          run && run.userId === user.id,
          403,
          '只能停止由自己发起的回复',
        );
        run.stopped = true;
        worker.cancel(run.rpcId);
        return send(200, { ok: true });
      }
      requireValue(url.pathname === '/api/agent/chat', 404, '接口不存在');
      const { speech: _speech, ...config } = db.config();
      requireValue(
        config.baseUrl && config.model && config.apiKey,
        503,
        '请管理员先配置助手的模型接口',
      );
      requireValue(
        typeof body.text === 'string' &&
          body.text.trim().length > 0 &&
          body.text.length <= 12000,
        400,
        '消息需要 1–12000 个字符',
      );
      requireValue(
        typeof body.requestId === 'string' &&
          /^[a-zA-Z0-9-]{16,80}$/.test(body.requestId),
        400,
        '发送标识无效',
      );
      requireValue(!runs.has(id), 409, '助手正在回复，请稍等片刻再发送');
      requireValue(runs.size < 4, 429, '助手繁忙，请稍后再试');
      const history = db
        .messages(id, 40)
        .filter((m) => m.role === 'user' || m.status === 'complete');
      const messageId = db.addMessage(
        id,
        user,
        body.text.trim(),
        body.requestId,
      );
      if (!messageId) return send(200, snapshot(id));
      history.push({
        role: 'user',
        text: body.text.trim(),
        authorId: user.id,
        authorName: user.name,
      });
      const run = {
        rpcId: randomUUID(),
        messageId,
        userId: user.id,
        text: '',
        parts: [],
        status: 'running',
      };
      runs.set(id, run);
      publish(id);
      void execute(id, run, {
        user,
        config,
        history,
        runId: messageId,
        dayId: /^d[1-6]$/.test(body.dayId) ? body.dayId : 'd1',
      });
      return send(202, snapshot(id));
    } catch (error) {
      if (!res.headersSent)
        send(error instanceof AccountError ? error.status : 502, {
          error:
            error instanceof AccountError
              ? error.message
              : '助手服务暂时不可用，请检查运行环境与连接配置',
        });
      else res.end();
    }
  };
  middleware.close = () => {
    closed = true;
    for (const bucket of listeners.values())
      for (const l of bucket) l.res.end();
    listeners.clear();
    for (const controller of speechRuns.values()) controller.abort();
    speechRuns.clear();
    worker.close();
    gateway.close();
    database?.close();
  };
  return middleware;
}
