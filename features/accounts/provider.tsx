'use client';
import {
  useEffect,
  useState,
  useCallback,
  type SubmitEvent,
  type ReactNode,
} from 'react';
import { Compass } from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { accountApi, type Session, type AccountLink } from './client';
import { AvatarField, Notice, SubmitButton } from './shared';
import { AccountContext } from './context';
import { AdminPage } from './admin-page';

export function AccountProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null),
    [error, setError] = useState(''),
    [link, setLink] = useState<AccountLink | null>(null),
    [authNotice, setAuthNotice] = useState('');
  const refresh = useCallback(async () => {
    const value = await accountApi<Session>('session');
    setSession(value);
    setError('');
  }, []);
  const clearLink = () => {
    window.history.replaceState(
      null,
      '',
      window.location.pathname + window.location.search,
    );
    setLink(null);
  };
  const logout = async () => {
    await accountApi('logout', {});
    await refresh();
  };
  useEffect(() => {
    let active = true;
    const readLink = () => {
      const params = new URLSearchParams(window.location.hash.slice(1));
      const kind = params.get('account'),
        token = params.get('token');
      if (kind === 'setup') {
        window.history.replaceState(
          null,
          '',
          window.location.pathname + window.location.search,
        );
        setAuthNotice(
          '管理员初始化链接已停用，请使用环境配置中的管理员账号登录。',
        );
        setLink(null);
      } else if (token && ['invite', 'reset'].includes(kind || '')) {
        setLink({ kind: kind as AccountLink['kind'], token });
      } else setLink(null);
    };
    const initialize = async () => {
      const value = await accountApi<Session>('session');
      if (!active) return;
      readLink();
      setSession(value);
      setError('');
    };
    void initialize().catch(() => {
      if (active) setError('无法连接账户服务，请检查网络后重试');
    });
    window.addEventListener('hashchange', readLink);
    const check = () => {
      void refresh().catch(() =>
        setError('无法验证登录状态，请检查网络后重试'),
      );
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') check();
    };
    const expired = () => setSession((s) => (s ? { ...s, user: null } : s));
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    window.addEventListener('account-expired', expired);
    document.addEventListener('visibilitychange', visibility);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') check();
    }, 60000);
    return () => {
      active = false;
      window.removeEventListener('hashchange', readLink);
      window.removeEventListener('focus', check);
      window.removeEventListener('online', check);
      window.removeEventListener('account-expired', expired);
      document.removeEventListener('visibilitychange', visibility);
      window.clearInterval(timer);
    };
  }, [refresh]);
  if (error)
    return (
      <div className="account-gate">
        <Notice message={error} error />
        <Button
          onClick={() =>
            void refresh().catch(() => setError('连接失败，请稍后重试'))
          }
        >
          重新连接
        </Button>
      </div>
    );
  if (!session)
    return (
      <div
        className="account-gate"
        aria-busy="true"
        aria-label="正在检查登录状态"
      >
        <Skeleton className="h-12 w-40" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  if (link || !session.user)
    return (
      <AuthForm
        key={link?.token || 'login'}
        session={session}
        link={link}
        initialNotice={authNotice}
        onDone={async (message = '') => {
          const value = await accountApi<Session>('session');
          if (value.user?.role === 'member') {
            const day = new URLSearchParams(window.location.search).get('day');
            const params = new URLSearchParams();
            if (day) params.set('day', day);
            params.set('view', 'roadbook');
            // Set the landing view before mounting the member page. An explicit
            // view also overrides legacy /map and /place page defaults.
            window.history.replaceState(null, '', `/?${params}`);
          }
          setSession(value);
          setError('');
          setAuthNotice(message);
          clearLink();
        }}
      />
    );
  return (
    <AccountContext.Provider value={{ session, refresh, logout }}>
      {session.user.role === 'admin' ? <AdminPage /> : children}
    </AccountContext.Provider>
  );
}
function AuthForm({
  session,
  link,
  onDone,
  initialNotice,
}: {
  session: Session;
  link: AccountLink | null;
  onDone: (message?: string) => Promise<void>;
  initialNotice: string;
}) {
  const mode = link?.kind || 'login';
  const registration = mode === 'invite';
  const [name, setName] = useState(''),
    [avatar, setAvatar] = useState('');
  const [busy, setBusy] = useState(false),
    [avatarBusy, setAvatarBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(initialNotice);
  const [validLink, setValidLink] = useState(!link);
  useEffect(() => {
    let current = true;
    if (link)
      void accountApi('link', link)
        .then(() => {
          if (current) setValidLink(true);
        })
        .catch((e: Error) => {
          if (current) setError(e.message);
        });
    return () => {
      current = false;
    };
  }, [link]);
  const title =
    mode === 'invite'
      ? '注册账户'
      : mode === 'reset'
        ? '设置新密码'
        : '登录北行路书';
  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    const element = event.currentTarget;
    const form = new FormData(element);
    const passwordEntry = form.get('password');
    const password = typeof passwordEntry === 'string' ? passwordEntry : '';
    if (mode !== 'login' && password !== form.get('confirm')) {
      setError('两次输入的密码不一致');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'login')
        await accountApi('login', { username: form.get('username'), password });
      else if (mode === 'reset')
        await accountApi('reset', { token: link?.token, password });
      else
        await accountApi('register', {
          username: form.get('username'),
          password,
          name,
          avatar,
          token: link?.token,
        });
      element.reset();
      await onDone(mode === 'reset' ? '密码已重置，请使用新密码登录' : '');
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败，请重试');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main id="main-content" className="account-gate">
      <Card className="account-auth-card gap-5 pt-5">
        <CardHeader className="account-auth-header gap-3">
          <div className="account-brand">
            <Compass aria-hidden="true" />
            <span>北行路书</span>
          </div>
          {mode !== 'reset' ? (
            <h1 className="sr-only">{title}</h1>
          ) : (
            <>
              <CardTitle>
                <h1>{title}</h1>
              </CardTitle>
              <CardDescription>
                更新密码后，其他设备需要重新登录。
              </CardDescription>
            </>
          )}
        </CardHeader>
        <form onSubmit={submit} className="account-auth-form">
          <CardContent className="account-auth-fields">
            {!session.adminConfigured && !link && (
              <Notice message="管理账户尚未配置，请联系部署管理员。已有成员仍可登录。" />
            )}
            <fieldset
              disabled={busy || !validLink}
              className="account-fieldset"
            >
              <FieldGroup className="gap-4">
                {mode !== 'reset' && (
                  <Field>
                    <FieldLabel htmlFor="auth-username">账户</FieldLabel>
                    <Input
                      id="auth-username"
                      name="username"
                      required
                      minLength={3}
                      maxLength={32}
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,31}"
                    />
                    {registration && (
                      <FieldDescription>
                        3–32 位字母、数字、点、下划线或短横线。
                      </FieldDescription>
                    )}
                  </Field>
                )}
                {registration && (
                  <Field>
                    <FieldLabel htmlFor="auth-name">名字</FieldLabel>
                    <Input
                      id="auth-name"
                      name="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      maxLength={40}
                      autoComplete="nickname"
                    />
                  </Field>
                )}
                <Field>
                  <FieldLabel htmlFor="auth-password">
                    {mode === 'reset' ? '新密码' : '密码'}
                  </FieldLabel>
                  <Input
                    id="auth-password"
                    name="password"
                    type="password"
                    required
                    minLength={mode === 'login' ? undefined : 10}
                    maxLength={128}
                    autoComplete={
                      mode === 'login' ? 'current-password' : 'new-password'
                    }
                  />
                  {mode !== 'login' && (
                    <FieldDescription>至少 10 个字符。</FieldDescription>
                  )}
                </Field>
                {mode !== 'login' && (
                  <Field>
                    <FieldLabel htmlFor="auth-confirm">再次输入密码</FieldLabel>
                    <Input
                      id="auth-confirm"
                      name="confirm"
                      type="password"
                      required
                      minLength={10}
                      maxLength={128}
                      autoComplete="new-password"
                    />
                  </Field>
                )}
                {registration && (
                  <AvatarField
                    name={name}
                    value={avatar}
                    onChange={setAvatar}
                    onBusy={setAvatarBusy}
                  />
                )}
              </FieldGroup>
            </fieldset>
          </CardContent>
          <CardFooter className="account-auth-actions flex-col items-stretch gap-3">
            <Notice
              message={error || (link && !validLink ? '正在检查链接…' : '')}
              error={!!error}
            />
            <Notice message={notice} />
            <div className="account-auth-buttons">
              <SubmitButton busy={busy || avatarBusy || !validLink}>
                {mode === 'login'
                  ? '登录'
                  : mode === 'reset'
                    ? '保存新密码'
                    : '创建账号并进入'}
              </SubmitButton>
            </div>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
