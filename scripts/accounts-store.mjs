import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
export const digest = (value) =>
  createHash('sha256').update(value).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');
export const safeUser = (u) =>
  u
    ? {
        id: u.id,
        username: u.username,
        name: u.name,
        avatar: u.avatar,
        role: u.role,
        disabled: !!u.disabled,
        createdAt: u.created_at,
      }
    : null;
export class AccountError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function requireValue(condition, status, message) {
  if (!condition) throw new AccountError(status, message);
}
export function validateProfile(input, registration = false) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  requireValue(
    name.length >= 1 && name.length <= 40,
    400,
    '名字需要 1–40 个字符',
  );
  const avatar = input.avatar ?? '';
  requireValue(
    typeof avatar === 'string' && avatar.length <= 140000,
    400,
    '头像过大，请选择较小的图片',
  );
  if (avatar) {
    const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      avatar,
    );
    requireValue(match, 400, '头像仅支持 JPEG 或 PNG 图片');
    const bytes = Buffer.from(match[2], 'base64');
    requireValue(
      bytes.length <= 100000 &&
        (match[1] === 'jpeg'
          ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
          : bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))),
      400,
      '头像格式无效',
    );
  }
  const profile = { name, avatar };
  if (registration) {
    const username =
      typeof input.username === 'string'
        ? input.username.trim().toLowerCase()
        : '';
    requireValue(
      /^[a-z0-9][a-z0-9._-]{2,31}$/.test(username),
      400,
      '账号需要 3–32 位字母、数字、点、下划线或短横线',
    );
    profile.username = username;
    validatePassword(input.password);
  }
  return profile;
}
export function validatePassword(password) {
  requireValue(
    typeof password === 'string' &&
      password.length >= 10 &&
      password.length <= 128,
    400,
    '密码需要 10–128 个字符',
  );
}
export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 3,
    maxmem: 64 * 1024 * 1024,
  });
  return `${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  const [salt, expected] = (
    stored || '00000000000000000000000000000000:' + '0'.repeat(128)
  ).split(':');
  const key = await derive(String(password).slice(0, 128), salt, 64, {
    N: 32768,
    r: 8,
    p: 3,
    maxmem: 64 * 1024 * 1024,
  });
  return timingSafeEqual(key, Buffer.from(expected, 'hex'));
}

const ADMIN_ID = 'environment-administrator';
export async function configureAdministrator(accounts, env) {
  const { db, transaction, getUser } = accounts;
  const configured = !!env.ADMIN_PASSWORD;
  let profile, passwordHash;
  const existing = getUser(ADMIN_ID);
  if (configured) {
    try {
      profile = validateProfile(
        {
          username: env.ADMIN_USERNAME,
          password: env.ADMIN_PASSWORD,
          name: env.ADMIN_NAME || '系统管理员',
        },
        true,
      );
    } catch {
      throw new AccountError(
        503,
        '管理员环境配置无效，请检查 ADMIN_USERNAME、ADMIN_PASSWORD 和 ADMIN_NAME 后重启',
      );
    }
    const unchanged =
      existing &&
      (await verifyPassword(env.ADMIN_PASSWORD, existing.password_hash));
    passwordHash = unchanged
      ? existing.password_hash
      : await hashPassword(env.ADMIN_PASSWORD);
  }
  transaction(() => {
    if (configured) {
      const conflict = db
        .prepare('SELECT id FROM users WHERE username = ? AND id != ?')
        .get(profile.username, ADMIN_ID);
      requireValue(
        !conflict,
        503,
        'ADMIN_USERNAME 已被成员使用，请为管理员配置独立账号后重启',
      );
    }
    // 旧版通过注册创建的管理员保留个人账号，迁移为普通成员。
    db.prepare(
      "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role = 'admin' AND id != ?)",
    ).run(ADMIN_ID);
    db.prepare(
      "UPDATE users SET role = 'member' WHERE role = 'admin' AND id != ?",
    ).run(ADMIN_ID);
    db.prepare("DELETE FROM tokens WHERE kind = 'setup' OR user_id = ?").run(
      ADMIN_ID,
    );
    if (!configured) {
      db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(ADMIN_ID);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(ADMIN_ID);
      return;
    }
    if (
      existing &&
      (existing.disabled ||
        existing.username !== profile.username ||
        existing.password_hash !== passwordHash)
    )
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(ADMIN_ID);
    db.prepare(`INSERT INTO users VALUES (?,?,?,?,?,'admin',0,?)
      ON CONFLICT(id) DO UPDATE SET username=excluded.username, name=excluded.name, avatar='', password_hash=excluded.password_hash, role='admin', disabled=0`).run(
      ADMIN_ID,
      profile.username,
      profile.name,
      '',
      passwordHash,
      Date.now(),
    );
  });
  return configured;
}
export function openAccounts(env = process.env) {
  const path = env.ACCOUNTS_DB_PATH || resolve('.runtime/accounts.sqlite');
  if (path !== ':memory:')
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  if (path !== ':memory:') chmodSync(path, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, name TEXT NOT NULL, avatar TEXT NOT NULL DEFAULT '', password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','member')), disabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS tokens (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, user_id TEXT REFERENCES users(id), label TEXT NOT NULL DEFAULT '', expires_at INTEGER NOT NULL, used_at INTEGER, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS throttle (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
  `);
  const transaction = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  const issueToken = (kind, userId = null, label = '') => {
    requireValue(['invite', 'reset'].includes(kind), 400, '链接类型无效');
    const token = randomToken(),
      id = randomToken(),
      now = Date.now();
    const expiresAt = now + (kind === 'invite' ? 72 : 1) * 60 * 60 * 1000;
    transaction(() => {
      if (kind !== 'invite')
        db.prepare('DELETE FROM tokens WHERE kind = ? AND user_id IS ?').run(
          kind,
          userId,
        );
      db.prepare('INSERT INTO tokens VALUES (?,?,?,?,?,?,NULL,?)').run(
        id,
        digest(token),
        kind,
        userId,
        label,
        expiresAt,
        now,
      );
    });
    return { id, token, expiresAt };
  };
  const getToken = (token, kind) => {
    requireValue(
      typeof token === 'string' && token.length <= 100,
      400,
      '链接无效或已过期',
    );
    const row = db
      .prepare(
        'SELECT * FROM tokens WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ?',
      )
      .get(digest(token), kind, Date.now());
    requireValue(row, 400, '链接无效、已使用或已过期，请重新获取');
    return row;
  };
  const getUser = (id) =>
    db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const sessionUser = (token) => {
    if (!token || token.length > 100) return null;
    return (
      db
        .prepare(
          'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0',
        )
        .get(digest(token), Date.now()) || null
    );
  };
  const session = (userId) => {
    const token = randomToken(),
      now = Date.now();
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(
      digest(token),
      userId,
      now + 30 * 86400000,
    );
    return token;
  };
  const throttle = (key, max) => {
    const now = Date.now();
    db.prepare('DELETE FROM throttle WHERE expires_at <= ?').run(now);
    const result = db
      .prepare(
        'INSERT INTO throttle VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count',
      )
      .get(key, now + 10 * 60000);
    requireValue(result.count <= max, 429, '操作过于频繁，请在 10 分钟后再试');
  };
  return {
    db,
    transaction,
    issueToken,
    getToken,
    getUser,
    sessionUser,
    session,
    throttle,
    close: () => db.close(),
  };
}
