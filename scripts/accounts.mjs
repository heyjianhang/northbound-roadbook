import {
  AccountError,
  openAccounts,
  safeUser,
  requireValue,
  validateProfile,
  hashPassword,
  verifyPassword,
  randomToken,
  digest,
  configureAdministrator,
} from './accounts-store.mjs';

const COOKIE = 'northbound_session';
function cookieToken(req) {
  return (
    (req.headers.cookie || '')
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(COOKIE + '='))
      ?.slice(COOKIE.length + 1) || ''
  );
}
export async function readJson(req) {
  requireValue(
    req.headers['content-type']?.split(';')[0] === 'application/json',
    415,
    '请使用 JSON 请求',
  );
  requireValue(
    !req.headers['content-length'] ||
      Number(req.headers['content-length']) <= 160000,
    413,
    '提交内容过大',
  );
  let length = 0;
  const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    requireValue(length <= 160000, 413, '提交内容过大');
    chunks.push(Buffer.from(chunk));
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requireValue(
      body && typeof body === 'object' && !Array.isArray(body),
      400,
      '请求格式无效',
    );
    return body;
  } catch (error) {
    if (error instanceof AccountError) throw error;
    throw new AccountError(400, '请求格式无效');
  }
}
export function createAccountsMiddleware(env = process.env, providedStore) {
  let accounts = providedStore;
  let ready;
  const store = () => (accounts ||= openAccounts(env));
  const publicOrigin = env.PUBLIC_ORIGIN
    ? new URL(env.PUBLIC_ORIGIN).origin
    : null;
  const secure =
    publicOrigin?.startsWith('https:') || env.NODE_ENV === 'production';
  let hashing = 0;
  async function passwordWork(fn) {
    requireValue(hashing < 4, 429, '服务繁忙，请稍后重试');
    hashing++;
    try {
      return await fn();
    } finally {
      hashing--;
    }
  }
  function sessionCookie(token) {
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? 30 * 86400 : 0}${secure ? '; Secure' : ''}`;
  }
  const middleware = async (req, res, next) => {
    const path = new URL(req.url || '/', 'http://local').pathname;
    const accountRoute = path.startsWith('/api/accounts/');
    const agentRoute = path.startsWith('/api/agent/');
    const protectedRoute =
      path === '/api/amap-config' || path.startsWith('/_AMapService/');
    if (!accountRoute && !protectedRoute && !agentRoute) return next();
    const send = (status, body, cookie) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        ...(cookie
          ? { 'Set-Cookie': sessionCookie(cookie === 'clear' ? '' : cookie) }
          : {}),
      });
      res.end(JSON.stringify(body));
    };
    try {
      const a = store(),
        token = cookieToken(req);
      const adminConfigured = await (ready ||= configureAdministrator(a, env));
      const mustUser = (admin = false) => {
        const user = a.sessionUser(token);
        requireValue(user, 401, '登录已过期，请重新登录');
        requireValue(
          !admin || user.role === 'admin',
          403,
          '仅管理员可以执行此操作',
        );
        return user;
      };
      if (agentRoute) {
        const admin = path.startsWith('/api/agent/admin/');
        const user = mustUser(admin);
        requireValue(admin || user.role === 'member', 403, '请使用普通成员账号与助手对话');
        if (req.method !== 'GET') {
          const expected = publicOrigin || `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`;
          requireValue(req.headers.origin === expected && req.headers['sec-fetch-site'] !== 'cross-site', 403, '请求来源不受信任');
          a.throttle('agent-write:' + user.id, 120);
        }
        req.accountUser = safeUser(user);
        req.accountValid = () => {
          const current = a.sessionUser(token);
          return current?.id === user.id && current.role === user.role;
        };
        return next();
      }
      if (protectedRoute) {
        requireValue(
          mustUser().role === 'member',
          403,
          '请使用普通成员账号进入路书',
        );
        return next();
      }
      if (req.method === 'GET' && path === '/api/accounts/session')
        return send(200, {
          adminConfigured,
          user: safeUser(a.sessionUser(token)),
        });
      if (req.method === 'GET' && path === '/api/accounts/companions') {
        requireValue(mustUser().role === 'member', 403, '请使用普通成员账号');
        return send(200, {
          companions: a.db.prepare("SELECT id,name,avatar FROM users WHERE role='member' AND disabled=0 ORDER BY created_at").all(),
        });
      }
      if (req.method === 'GET' && path === '/api/accounts/members') {
        mustUser(true);
        return send(200, {
          members: a.db
            .prepare(
              "SELECT * FROM users WHERE role = 'member' ORDER BY created_at",
            )
            .all()
            .map(safeUser),
          invites: a.db
            .prepare(
              "SELECT id,label,expires_at AS expiresAt,used_at AS usedAt,created_at AS createdAt FROM tokens WHERE kind = 'invite' ORDER BY created_at DESC LIMIT 30",
            )
            .all(),
        });
      }
      requireValue(req.method === 'POST', 405, '此接口不支持该请求方式');
      const origin = req.headers.origin;
      const expected =
        publicOrigin ||
        `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`;
      requireValue(
        origin === expected && req.headers['sec-fetch-site'] !== 'cross-site',
        403,
        '请求来源不受信任，请从路书页面操作',
      );
      const ip = req.socket.remoteAddress || 'unknown';
      a.throttle('write:' + ip, 120);
      const body = await readJson(req);
      if (
        path === '/api/accounts/setup' ||
        (path === '/api/accounts/link' && body.kind === 'setup')
      )
        throw new AccountError(
          410,
          '管理员初始化链接已停用，请使用环境配置中的管理员账号登录',
        );
      if (path === '/api/accounts/link') {
        requireValue(
          ['invite', 'reset'].includes(body.kind),
          400,
          '链接类型无效',
        );
        const link = a.getToken(body.token, body.kind);
        return send(200, {
          kind: link.kind,
          label: link.label,
          expiresAt: link.expires_at,
        });
      }
      if (path === '/api/accounts/login') {
        a.throttle('login-ip:' + ip, 30);
        const username =
          typeof body.username === 'string'
            ? body.username.trim().toLowerCase().slice(0, 32)
            : '';
        a.throttle('login-user:' + digest(username), 15);
        const user = a.db
          .prepare('SELECT * FROM users WHERE username = ?')
          .get(username);
        const valid = await passwordWork(() =>
          verifyPassword(body.password, user?.password_hash),
        );
        const current = user && a.getUser(user.id);
        requireValue(
          valid &&
            current &&
            !current.disabled &&
            current.password_hash === user.password_hash,
          401,
          '账号或密码不正确，或账号已停用',
        );
        a.db
          .prepare('DELETE FROM throttle WHERE key = ?')
          .run('login-user:' + digest(username));
        return send(200, { user: safeUser(current) }, a.session(current.id));
      }
      if (path === '/api/accounts/register') {
        const kind = 'invite';
        a.throttle('register:' + ip, 15);
        a.getToken(body.token, kind);
        const profile = validateProfile(body, true);
        const passwordHash = await passwordWork(() =>
          hashPassword(body.password),
        );
        const id = randomToken();
        a.transaction(() => {
          const link = a.getToken(body.token, kind);
          requireValue(
            !a.db
              .prepare('SELECT 1 FROM users WHERE username = ?')
              .get(profile.username),
            409,
            '这个账号已被使用，请换一个',
          );
          a.db
            .prepare('INSERT INTO users VALUES (?,?,?,?,?,?,0,?)')
            .run(
              id,
              profile.username,
              profile.name,
              profile.avatar,
              passwordHash,
              'member',
              Date.now(),
            );
          a.db
            .prepare('UPDATE tokens SET used_at = ? WHERE id = ?')
            .run(Date.now(), link.id);
        });
        return send(201, { user: safeUser(a.getUser(id)) }, a.session(id));
      }
      if (path === '/api/accounts/reset') {
        a.throttle('reset:' + ip, 15);
        a.getToken(body.token, 'reset');
        const passwordHash = await passwordWork(() =>
          hashPassword(body.password),
        );
        a.transaction(() => {
          const link = a.getToken(body.token, 'reset');
          requireValue(
            a.getUser(link.user_id)?.disabled === 0 &&
              a.getUser(link.user_id)?.role === 'member',
            400,
            '账号不可用',
          );
          a.db
            .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
            .run(passwordHash, link.user_id);
          a.db
            .prepare('DELETE FROM sessions WHERE user_id = ?')
            .run(link.user_id);
          a.db
            .prepare('UPDATE tokens SET used_at = ? WHERE id = ?')
            .run(Date.now(), link.id);
        });
        return send(200, { ok: true }, 'clear');
      }
      const user = mustUser();
      if (path === '/api/accounts/logout') {
        a.db
          .prepare('DELETE FROM sessions WHERE token_hash = ?')
          .run(digest(token));
        return send(200, { ok: true }, 'clear');
      }
      if (path === '/api/accounts/profile') {
        requireValue(user.role === 'member', 403, '管理员资料由环境配置维护');
        const profile = validateProfile(body);
        a.db
          .prepare('UPDATE users SET name = ?, avatar = ? WHERE id = ?')
          .run(profile.name, profile.avatar, user.id);
        return send(200, { user: safeUser(a.getUser(user.id)) });
      }
      if (path === '/api/accounts/password') {
        requireValue(
          user.role === 'member',
          403,
          '管理员密码请在环境配置中修改并重启',
        );
        a.throttle('password:' + user.id, 10);
        const valid = await passwordWork(() =>
          verifyPassword(body.currentPassword, user.password_hash),
        );
        requireValue(valid, 400, '当前密码不正确');
        const passwordHash = await passwordWork(() =>
          hashPassword(body.password),
        );
        a.transaction(() => {
          requireValue(
            mustUser().password_hash === user.password_hash,
            409,
            '密码已发生变化，请重新登录',
          );
          a.db
            .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
            .run(passwordHash, user.id);
          a.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
          a.db
            .prepare("DELETE FROM tokens WHERE kind = 'reset' AND user_id = ?")
            .run(user.id);
        });
        return send(200, { ok: true }, a.session(user.id));
      }
      mustUser(true);
      if (path === '/api/accounts/invites') {
        requireValue(
          typeof body.label === 'string' &&
            body.label.trim().length >= 1 &&
            body.label.trim().length <= 40,
          400,
          '请填写邀请备注（1–40 个字符）',
        );
        return send(201, a.issueToken('invite', null, body.label.trim()));
      }
      if (path === '/api/accounts/invites/revoke') {
        requireValue(typeof body.id === 'string', 400, '邀请无效');
        a.db
          .prepare(
            "UPDATE tokens SET used_at = ? WHERE id = ? AND kind = 'invite' AND used_at IS NULL",
          )
          .run(Date.now(), body.id);
        return send(200, { ok: true });
      }
      if (path === '/api/accounts/members/status') {
        const member = typeof body.id === 'string' && a.getUser(body.id);
        requireValue(member && member.role !== 'admin', 400, '不能停用管理员');
        requireValue(typeof body.disabled === 'boolean', 400, '成员状态无效');
        a.transaction(() => {
          a.db
            .prepare('UPDATE users SET disabled = ? WHERE id = ?')
            .run(Number(body.disabled), member.id);
          a.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(member.id);
          a.db
            .prepare("DELETE FROM tokens WHERE kind = 'reset' AND user_id = ?")
            .run(member.id);
        });
        return send(200, { ok: true });
      }
      if (path === '/api/accounts/members/reset') {
        const member = typeof body.id === 'string' && a.getUser(body.id);
        requireValue(
          member && member.role !== 'admin' && !member.disabled,
          400,
          '请选择可用的普通成员',
        );
        return send(201, a.issueToken('reset', member.id, member.name));
      }
      throw new AccountError(404, '账户接口不存在');
    } catch (error) {
      req.resume?.();
      send(error instanceof AccountError ? error.status : 500, {
        error:
          error instanceof AccountError
            ? error.message
            : '账户服务暂时不可用，请稍后重试',
      });
    }
  };
  middleware.close = () => {
    accounts?.close();
    accounts = null;
  };
  return middleware;
}
