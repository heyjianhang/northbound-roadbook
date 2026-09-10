import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  openAccounts,
  digest,
  hashPassword,
} from '../scripts/accounts-store.mjs';
import { createAccountsMiddleware } from '../scripts/accounts.mjs';
import { createHandler } from '../scripts/serve.mjs';

function fixture(env = {}) {
  const store = openAccounts({ ACCOUNTS_DB_PATH: ':memory:' });
  const config = {
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'admin-password-123',
    ADMIN_NAME: '管理员',
    ...env,
  };
  let middleware = createAccountsMiddleware(config, store);
  async function call(path, body, cookie = '', options = {}) {
    const req = Readable.from(
      body === undefined ? [] : [Buffer.from(JSON.stringify(body))],
    );
    Object.assign(req, {
      url: path.startsWith('/') ? path : '/api/accounts/' + path,
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        host: 'localhost:4173',
        origin: 'http://localhost:4173',
        'content-type': 'application/json',
        cookie,
        ...options.headers,
      },
      socket: { remoteAddress: '127.0.0.1' },
    });
    let result;
    await middleware(
      req,
      {
        writeHead(status, headers) {
          result = { status, headers };
        },
        end(text) {
          result.body = JSON.parse(text);
        },
      },
      () => {
        result = { status: 204 };
      },
    );
    return result;
  }
  async function admin() {
    const result = await call('login', {
      username: config.ADMIN_USERNAME,
      password: config.ADMIN_PASSWORD,
    });
    assert.equal(result.status, 200);
    return {
      ...result.body.user,
      cookie: result.headers['Set-Cookie'].split(';')[0],
    };
  }
  async function member(adminCookie, username = 'traveler') {
    const invite = await call('invites', { label: '旅伴' }, adminCookie);
    const result = await call('register', {
      token: invite.body.token,
      username,
      name: '旅伴',
      password: 'member-password-123',
      role: 'admin',
    });
    assert.equal(result.status, 201);
    return {
      ...result.body.user,
      cookie: result.headers['Set-Cookie'].split(';')[0],
    };
  }
  return {
    store,
    call,
    admin,
    member,
    restart: (nextEnv = {}) => {
      Object.assign(config, nextEnv);
      middleware = createAccountsMiddleware(config, store);
    },
    close: () => middleware.close(),
  };
}

test('管理员来自环境配置，初始化入口停用，管理身份不能使用成员功能', async () => {
  const f = fixture();
  try {
    assert.equal((await f.call('session')).body.adminConfigured, true);
    assert.equal((await f.call('setup', { token: 'guess' })).status, 410);
    assert.equal(
      (await f.call('link', { kind: 'setup', token: 'old' })).status,
      410,
    );
    const admin = await f.admin();
    assert.equal(admin.role, 'admin');
    assert.equal(
      (await f.call('session', undefined, admin.cookie)).body.user.name,
      '管理员',
    );
    assert.deepEqual(
      (await f.call('members', undefined, admin.cookie)).body.members,
      [],
    );
    assert.equal(
      (await f.call('/api/amap-config', undefined, admin.cookie)).status,
      403,
    );
    assert.equal(
      (await f.call('/_AMapService/v3/place/text', undefined, admin.cookie))
        .status,
      403,
    );
    assert.equal(
      (await f.call('profile', { name: '旅伴' }, admin.cookie)).status,
      403,
    );
    assert.equal(
      (
        await f.call(
          'password',
          {
            currentPassword: 'admin-password-123',
            password: 'changed-password-123',
          },
          admin.cookie,
        )
      ).status,
      403,
    );
    assert.equal(
      (await f.call('members/reset', { id: admin.id }, admin.cookie)).status,
      400,
    );
    const forbiddenReset = f.store.issueToken('reset', admin.id);
    assert.equal(
      (
        await f.call('reset', {
          token: forbiddenReset.token,
          password: 'changed-password-123',
        })
      ).status,
      400,
    );
    const stored = f.store.getUser(admin.id);
    assert.ok(!stored.password_hash.includes('admin-password-123'));
    assert.ok(
      !JSON.stringify(
        (await f.call('session', undefined, admin.cookie)).body,
      ).includes('password'),
    );
    assert.ok(
      f.store.db.prepare('SELECT * FROM sessions').get().token_hash !==
        admin.cookie.split('=')[1],
    );
  } finally {
    f.close();
  }
});
test('未配置密码时无默认管理员，已有成员仍能登录', async () => {
  const f = fixture({ ADMIN_PASSWORD: '' });
  try {
    assert.equal((await f.call('session')).body.adminConfigured, false);
    assert.equal(
      f.store.db.prepare('SELECT count(*) AS n FROM users').get().n,
      0,
    );
    assert.equal(
      (
        await f.call('login', {
          username: 'admin',
          password: 'admin-password-123',
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await f.call('register', {
          username: 'guest',
          name: '旅伴',
          password: 'member-password-123',
        })
      ).status,
      400,
    );
    f.restart({ ADMIN_PASSWORD: 'admin-password-123' });
    const admin = await f.admin();
    const member = await f.member(admin.cookie);
    f.restart({ ADMIN_PASSWORD: '' });
    assert.equal(
      (await f.call('session', undefined, admin.cookie)).body.user,
      null,
    );
    assert.equal(
      (await f.call('session', undefined, member.cookie)).body.user.id,
      member.id,
    );
    assert.equal(
      (
        await f.call('login', {
          username: member.username,
          password: 'member-password-123',
        })
      ).status,
      200,
    );
  } finally {
    f.close();
  }
});
test('重启同步管理员配置，密码或账号变化撤销旧管理会话，不影响普通成员', async () => {
  const f = fixture();
  try {
    const admin = await f.admin();
    const member = await f.member(admin.cookie);
    const hash = f.store.getUser(admin.id).password_hash;
    f.restart();
    assert.equal(
      (await f.call('session', undefined, admin.cookie)).body.user.id,
      admin.id,
    );
    assert.equal(f.store.getUser(admin.id).password_hash, hash);
    f.restart({
      ADMIN_PASSWORD: 'new-admin-password-123',
      ADMIN_NAME: '管理专用',
    });
    assert.equal(
      (await f.call('session', undefined, admin.cookie)).body.user,
      null,
    );
    assert.equal(
      (
        await f.call('login', {
          username: 'admin',
          password: 'admin-password-123',
        })
      ).status,
      401,
    );
    const updated = await f.admin();
    assert.equal(updated.id, admin.id);
    assert.equal(updated.name, '管理专用');
    f.restart({ ADMIN_USERNAME: 'management' });
    assert.equal(
      (await f.call('session', undefined, updated.cookie)).body.user,
      null,
    );
    assert.equal(
      (
        await f.call('login', {
          username: 'admin',
          password: 'new-admin-password-123',
        })
      ).status,
      401,
    );
    assert.equal((await f.admin()).username, 'management');
    assert.equal(
      (await f.call('session', undefined, member.cookie)).body.user.id,
      member.id,
    );
    assert.equal(
      (await f.call('members', undefined, (await f.admin()).cookie)).body
        .members.length,
      1,
    );
  } finally {
    f.close();
  }
});
test('旧管理员保留个人身份和密码，配置重名或无效不会覆盖成员', async () => {
  const f = fixture();
  try {
    const hash = await hashPassword('personal-password-123');
    f.store.db
      .prepare('INSERT INTO users VALUES (?,?,?,?,?,?,0,?)')
      .run('legacy-user', 'traveler', '马健航', '', hash, 'admin', Date.now());
    const cookie = 'northbound_session=' + f.store.session('legacy-user');
    assert.equal((await f.call('session', undefined, cookie)).body.user, null);
    const personal = await f.call('login', {
      username: 'traveler',
      password: 'personal-password-123',
    });
    assert.equal(personal.body.user.role, 'member');
    assert.equal(personal.body.user.name, '马健航');
    f.restart({ ADMIN_USERNAME: 'traveler' });
    assert.equal((await f.call('session')).status, 503);
    assert.equal(f.store.getUser('legacy-user').password_hash, hash);
    assert.equal(f.store.getUser('legacy-user').role, 'member');
    f.restart({ ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'short' });
    const invalid = await f.call('session');
    assert.equal(invalid.status, 503);
    assert.ok(!JSON.stringify(invalid.body).includes('short'));
  } finally {
    f.close();
  }
});
test('邀请单次使用、服务端固定成员角色、过期和撤销邀请不能注册', async () => {
  const f = fixture();
  try {
    const admin = await f.admin();
    const member = await f.member(admin.cookie);
    assert.equal(member.role, 'member');
    const used = f.store.db
      .prepare("SELECT * FROM tokens WHERE kind='invite'")
      .get();
    assert.ok(used.used_at);
    const invite = (await f.call('invites', { label: '过期' }, admin.cookie))
      .body;
    f.store.db
      .prepare('UPDATE tokens SET expires_at=0 WHERE id=?')
      .run(invite.id);
    assert.equal(
      (await f.call('register', { token: invite.token })).status,
      400,
    );
    const revoked = (await f.call('invites', { label: '撤销' }, admin.cookie))
      .body;
    await f.call('invites/revoke', { id: revoked.id }, admin.cookie);
    assert.equal(
      (await f.call('link', { kind: 'invite', token: revoked.token })).status,
      400,
    );
    assert.equal(
      (await f.call('members', undefined, member.cookie)).status,
      403,
    );
    assert.equal(
      (await f.call('invites', { label: '越权' }, member.cookie)).status,
      403,
    );
  } finally {
    f.close();
  }
});
test('同一邀请并发注册仅成功一次，失败后不残留第二个用户', async () => {
  const f = fixture();
  try {
    const admin = await f.admin();
    const invite = (await f.call('invites', { label: '并发' }, admin.cookie))
      .body;
    const results = await Promise.all(
      ['one', 'two'].map((username) =>
        f.call('register', {
          token: invite.token,
          username,
          name: username,
          password: 'password-12345',
        }),
      ),
    );
    assert.deepEqual(
      results.map((r) => r.status).sort((a, b) => a - b),
      [201, 400],
    );
    assert.equal(
      f.store.db.prepare('SELECT count(*) AS n FROM users').get().n,
      2,
    );
  } finally {
    f.close();
  }
});
test('停用立即撤销登录，启用后旧会话仍无效，并保护管理员', async () => {
  const f = fixture();
  try {
    const admin = await f.admin(),
      member = await f.member(admin.cookie);
    assert.equal(
      (await f.call('/api/amap-config', undefined, member.cookie)).status,
      204,
    );
    await f.call(
      'members/status',
      { id: member.id, disabled: true },
      admin.cookie,
    );
    assert.equal(
      (await f.call('session', undefined, member.cookie)).body.user,
      null,
    );
    assert.equal(
      (
        await f.call('login', {
          username: 'traveler',
          password: 'member-password-123',
        })
      ).status,
      401,
    );
    await f.call(
      'members/status',
      { id: member.id, disabled: false },
      admin.cookie,
    );
    assert.equal(
      (await f.call('/api/amap-config', undefined, member.cookie)).status,
      401,
    );
    assert.equal(
      (
        await f.call('login', {
          username: 'traveler',
          password: 'member-password-123',
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await f.call(
          'members/status',
          { id: admin.id, disabled: true },
          admin.cookie,
        )
      ).status,
      400,
    );
  } finally {
    f.close();
  }
});
test('改密码需要旧密码，并轮换当前会话、撤销其他设备', async () => {
  const f = fixture();
  try {
    const administrator = await f.admin();
    const member = await f.member(administrator.cookie);
    const second = await f.call('login', {
      username: 'TRAVELER',
      password: 'member-password-123',
    });
    const secondCookie = second.headers['Set-Cookie'].split(';')[0];
    assert.equal(
      (
        await f.call(
          'password',
          { currentPassword: 'wrong', password: 'new-password-123' },
          member.cookie,
        )
      ).status,
      400,
    );
    const result = await f.call(
      'password',
      { currentPassword: 'member-password-123', password: 'new-password-123' },
      member.cookie,
    );
    assert.equal(result.status, 200);
    assert.equal(
      (await f.call('session', undefined, secondCookie)).body.user,
      null,
    );
    assert.equal(
      (await f.call('session', undefined, member.cookie)).body.user,
      null,
    );
    assert.equal(
      (
        await f.call(
          'session',
          undefined,
          result.headers['Set-Cookie'].split(';')[0],
        )
      ).body.user.id,
      member.id,
    );
    assert.equal(
      (
        await f.call('login', {
          username: 'traveler',
          password: 'member-password-123',
        })
      ).status,
      401,
    );
  } finally {
    f.close();
  }
});
test('重置链接单次使用且覆盖旧链接，重置完成撤销成员会话', async () => {
  const f = fixture();
  try {
    const admin = await f.admin(),
      member = await f.member(admin.cookie);
    const oldLink = (
      await f.call('members/reset', { id: member.id }, admin.cookie)
    ).body;
    const link = (
      await f.call('members/reset', { id: member.id }, admin.cookie)
    ).body;
    assert.equal(
      (
        await f.call('reset', {
          token: oldLink.token,
          password: 'changed-password-123',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.call('reset', {
          token: link.token,
          password: 'changed-password-123',
        })
      ).status,
      200,
    );
    assert.equal(
      (await f.call('session', undefined, member.cookie)).body.user,
      null,
    );
    assert.equal(
      (
        await f.call('reset', {
          token: link.token,
          password: 'changed-again-123',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.call('login', {
          username: 'traveler',
          password: 'changed-password-123',
        })
      ).status,
      200,
    );
  } finally {
    f.close();
  }
});
test('资料只允许改自己，拒绝脚本头像及伪装图片，响应不含密码或令牌哈希', async () => {
  const f = fixture();
  try {
    const admin = await f.admin(),
      member = await f.member(admin.cookie);
    const result = await f.call(
      'profile',
      { name: '新名字', avatar: '', id: admin.id, role: 'admin' },
      member.cookie,
    );
    assert.equal(result.body.user.name, '新名字');
    assert.equal(result.body.user.role, 'member');
    assert.equal(f.store.getUser(admin.id).name, '管理员');
    assert.equal((await f.call('companions')).status, 401);
    assert.equal((await f.call('companions', undefined, admin.cookie)).status, 403);
    assert.deepEqual((await f.call('companions', undefined, member.cookie)).body.companions,
      [{id:member.id,name:'新名字',avatar:''}]);
    for (const avatar of [
      'javascript:alert(1)',
      'data:image/svg+xml;base64,PHN2Zz4=',
      'data:image/png;base64,ZmFrZQ==',
    ])
      assert.equal(
        (await f.call('profile', { name: '旅伴', avatar }, member.cookie))
          .status,
        400,
      );
    assert.ok(
      !JSON.stringify(
        (await f.call('members', undefined, admin.cookie)).body,
      ).includes('password_hash'),
    );
    assert.ok(
      !JSON.stringify(
        (await f.call('members', undefined, admin.cookie)).body,
      ).includes('token_hash'),
    );
  } finally {
    f.close();
  }
});
test('拒绝跨站写入、未登录代理请求和超大请求；cookie、会话响应不缓存', async () => {
  const f = fixture({ PUBLIC_ORIGIN: 'https://trip.example.com' });
  try {
    assert.equal(
      (
        await f.call('login', {}, '', {
          headers: { origin: 'https://evil.example' },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.call('login', {}, '', {
          headers: {
            origin: 'https://trip.example.com',
            'content-type': 'text/plain',
          },
        })
      ).status,
      415,
    );
    assert.equal(
      (
        await f.call('login', { data: 'x'.repeat(160001) }, '', {
          headers: { origin: 'https://trip.example.com' },
        })
      ).status,
      413,
    );
    assert.equal((await f.call('/_AMapService/v3/place/text')).status, 401);
    const result = await f.call(
      'login',
      { username: 'admin', password: 'admin-password-123' },
      '',
      { headers: { origin: 'https://trip.example.com' } },
    );
    assert.match(result.headers['Set-Cookie'], /HttpOnly; SameSite=Lax/);
    assert.match(result.headers['Set-Cookie'], /; Secure/);
    assert.equal(result.headers['Cache-Control'], 'no-store');
    assert.equal(
      (await f.call('session')).headers['Cache-Control'],
      'no-store',
    );
  } finally {
    f.close();
  }
});
test('登录限流、会话过期和退出会话均由服务器校验', async () => {
  const f = fixture();
  try {
    const admin = await f.admin();
    f.store.db
      .prepare('INSERT INTO throttle VALUES (?,15,?)')
      .run('login-user:' + digest('admin'), Date.now() + 60000);
    assert.equal(
      (
        await f.call('login', {
          username: 'admin',
          password: 'admin-password-123',
        })
      ).status,
      429,
    );
    f.store.db.prepare('UPDATE sessions SET expires_at=0').run();
    assert.equal(
      (await f.call('session', undefined, admin.cookie)).body.user,
      null,
    );
    const cookie = 'northbound_session=' + f.store.session(admin.id);
    const result = await f.call('logout', {}, cookie);
    assert.match(result.headers['Set-Cookie'], /Max-Age=0/);
    assert.equal((await f.call('session', undefined, cookie)).body.user, null);
  } finally {
    f.close();
  }
});
test('账户和会话持久化到数据库，重开数据库后可恢复', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'roadbook-accounts-'));
  let store = openAccounts({ ACCOUNTS_DB_PATH: join(dir, 'accounts.sqlite') });
  try {
    store.db
      .prepare('INSERT INTO users VALUES (?,?,?,?,?,?,0,?)')
      .run('test-id', 'test-user', '旅伴', '', 'unused', 'member', Date.now());
    const token = store.session('test-id');
    store.close();
    store = openAccounts({ ACCOUNTS_DB_PATH: join(dir, 'accounts.sqlite') });
    assert.equal(store.sessionUser(token).name, '旅伴');
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('生产入口先处理账户 POST，并保护高德接口', async () => {
  const handler = createHandler({ ACCOUNTS_DB_PATH: ':memory:' });
  try {
    const req = Readable.from([Buffer.from('{}')]);
    Object.assign(req, {
      url: '/api/accounts/login',
      method: 'POST',
      headers: {
        host: 'localhost',
        origin: 'https://evil.example',
        'content-type': 'application/json',
      },
      socket: { remoteAddress: '127.0.0.1' },
    });
    let status;
    await handler(req, {
      writeHead(code) {
        status = code;
      },
      end() {},
    });
    assert.equal(status, 403);
  } finally {
    handler.close();
  }
});
