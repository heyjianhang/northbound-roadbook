import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { requireValue } from './accounts-store.mjs';
import { speechReady } from './speech.mjs';
import {
  withMcpPresets,
  normalizeMcpServers,
  publicMcpServer,
  importMcpConfig,
} from './mcp-config.mjs';

const speechEnv = {
  apiKey: 'VOLC_SPEECH_API_KEY',
  appId: 'VOLC_SPEECH_APP_ID',
  accessToken: 'VOLC_SPEECH_ACCESS_TOKEN',
};

export function agentDirectory(env) {
  return resolve(env.AGENT_DATA_DIR || '.runtime/agent');
}
export function openAgentStore(env = process.env) {
  const directory = agentDirectory(env);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = resolve(directory, 'chat.sqlite');
  const db = new DatabaseSync(filename);
  chmodSync(filename, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, scope TEXT NOT NULL, owner TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation TEXT NOT NULL, role TEXT NOT NULL,
      author_id TEXT NOT NULL, author_name TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', parts TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL, created_at TEXT NOT NULL, request_key TEXT UNIQUE);
    CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation, created_at);
    UPDATE messages SET status='interrupted' WHERE status='running';`);
  const saved = () =>
    JSON.parse(
      db.prepare('SELECT value FROM settings WHERE id=1').get()?.value || '{}',
    );
  const config = () => {
    const s = saved();
    return {
      baseUrl: env.AGENT_BASE_URL || s.baseUrl || '',
      model: env.AGENT_MODEL || s.model || '',
      apiKey: env.AGENT_API_KEY || s.apiKey || '',
      embeddingModel: env.AGENT_EMBEDDING_MODEL || s.embeddingModel || '',
      servers: withMcpPresets(s.servers || []),
      speech: Object.fromEntries(
        Object.entries(speechEnv).map(([key, name]) => [
          key,
          env[name] || s.speech?.[key] || '',
        ]),
      ),
    };
  };
  const publicConfig = () => {
    const c = config();
    return {
      ...c,
      apiKey: undefined,
      keyConfigured: Boolean(c.apiKey),
      ready: Boolean(c.baseUrl && c.model && c.apiKey),
      speech: {
        appId: c.speech.appId,
        keyConfigured: Boolean(c.speech.apiKey),
        tokenConfigured: Boolean(c.speech.accessToken),
        ready: speechReady(c.speech),
        envManaged: Object.keys(speechEnv).filter((key) => env[speechEnv[key]]),
      },
      envManaged: ['baseUrl', 'model', 'apiKey', 'embeddingModel'].filter(
        (k) =>
          env[
            {
              baseUrl: 'AGENT_BASE_URL',
              model: 'AGENT_MODEL',
              apiKey: 'AGENT_API_KEY',
              embeddingModel: 'AGENT_EMBEDDING_MODEL',
            }[k]
          ],
      ),
      servers: c.servers.map(publicMcpServer),
    };
  };
  function saveConfig(input) {
    const previous = saved();
    const url = (value, label) => {
      requireValue(
        typeof value === 'string' && value.length <= 2000,
        400,
        `${label}无效`,
      );
      let parsed;
      try {
        parsed = new URL(value);
      } catch {
        requireValue(false, 400, `${label}需要完整 URL`);
      }
      requireValue(
        ['https:', 'http:'].includes(parsed.protocol) &&
          !parsed.username &&
          !parsed.password &&
          !parsed.hash &&
          !parsed.search,
        400,
        `${label}需使用 HTTP(S)，凭据请填写在密钥栏`,
      );
      return value.replace(/\/$/, '');
    };
    requireValue(
      typeof input.model === 'string' && input.model.length <= 200,
      400,
      '模型名无效',
    );
    requireValue(
      Array.isArray(input.servers) && input.servers.length <= 16,
      400,
      '最多配置 16 个 MCP 服务',
    );
    requireValue(
      input.apiKey === undefined ||
        (typeof input.apiKey === 'string' && input.apiKey.length <= 8000),
      400,
      '密钥无效',
    );
    requireValue(
      typeof input.embeddingModel === 'string' &&
        input.embeddingModel.length <= 200,
      400,
      '向量模型名无效',
    );
    const servers = normalizeMcpServers(
      input.servers,
      withMcpPresets(previous.servers),
    );
    const next = {
      baseUrl: input.baseUrl ? url(input.baseUrl, '模型地址') : '',
      model: input.model.trim(),
      apiKey: input.apiKey || previous.apiKey || '',
      embeddingModel: input.embeddingModel.trim(),
      servers,
      speech: previous.speech || {},
    };
    if (input.speech !== undefined) {
      requireValue(
        input.speech &&
          typeof input.speech === 'object' &&
          !Array.isArray(input.speech),
        400,
        '语音配置无效',
      );
      for (const key of Object.keys(speechEnv)) {
        const value = input.speech[key];
        requireValue(
          value === undefined ||
            (typeof value === 'string' &&
              value.length <= (key === 'appId' ? 200 : 8000) &&
              !/[\r\n]/.test(value)),
          400,
          '语音凭据无效',
        );
        next.speech[key] = value?.trim() || previous.speech?.[key] || '';
      }
    }
    db.prepare(
      'INSERT INTO settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
    ).run(JSON.stringify(next));
    return publicConfig();
  }
  function importServers(input) {
    const previous = saved();
    const servers = importMcpConfig(input, withMcpPresets(previous.servers));
    db.prepare(
      'INSERT INTO settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
    ).run(JSON.stringify({ ...previous, servers }));
    return publicConfig();
  }
  function recordMcpTest(server, discovery) {
    const previous = saved();
    const servers = withMcpPresets(previous.servers);
    const current = servers.find((s) => s.id === server.id);
    const target = (s) =>
      JSON.stringify([s.url, s.transport, s.token, s.headers]);
    requireValue(
      current && target(current) === target(server),
      409,
      '配置已变化，请重新测试连接',
    );
    current.discovery = { ...discovery, checkedAt: new Date().toISOString() };
    db.prepare(
      'INSERT INTO settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
    ).run(JSON.stringify({ ...previous, servers }));
    return publicConfig();
  }
  function conversation() {
    const id = 'trip:northbound-2026';
    db.prepare('INSERT OR IGNORE INTO conversations VALUES(?,?,?)').run(
      id,
      'shared',
      '',
    );
    return id;
  }
  function messages(id, limit = 200) {
    return db
      .prepare(
        'SELECT * FROM (SELECT rowid AS seq,* FROM messages WHERE conversation=? ORDER BY created_at DESC, rowid DESC LIMIT ?) ORDER BY created_at, seq',
      )
      .all(id, limit)
      .map((r) => ({
        id: r.id,
        role: r.role,
        authorId: r.author_id,
        authorName: r.author_name,
        text: r.text,
        parts: JSON.parse(r.parts),
        status: r.status,
        createdAt: r.created_at,
      }));
  }
  function addMessage(conversationId, user, text, requestKey) {
    const existing = db
      .prepare('SELECT conversation FROM messages WHERE request_key=?')
      .get(user.id + ':' + requestKey);
    if (existing) {
      requireValue(
        existing.conversation === conversationId,
        409,
        '发送标识已在其他对话使用',
      );
      return null;
    }
    const assistantId = randomUUID();
    const insert = db.prepare(
      'INSERT INTO messages(id,conversation,role,author_id,author_name,text,status,created_at,request_key) VALUES(?,?,?,?,?,?,?,?,?)',
    );
    db.exec('BEGIN IMMEDIATE');
    try {
      const now = new Date().toISOString();
      insert.run(
        randomUUID(),
        conversationId,
        'user',
        user.id,
        user.name,
        text,
        'complete',
        now,
        user.id + ':' + requestKey,
      );
      insert.run(
        assistantId,
        conversationId,
        'assistant',
        user.id,
        '北行助手',
        '',
        'running',
        now,
        null,
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return assistantId;
  }
  return {
    db,
    config,
    publicConfig,
    saveConfig,
    importServers,
    recordMcpTest,
    conversation,
    messages,
    addMessage,
    close: () => db.close(),
  };
}
