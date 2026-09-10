'use client';
import { useCallback, useEffect, useState, type SubmitEvent } from 'react';
import { LogOut, Copy, UserPlus } from 'lucide-react';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { useAccount } from './context';
import { accountApi, accountLink, type AccountUser } from './client';
import { AvatarField, MemberAvatar, Notice, SubmitButton } from './shared';
import { InstallCard } from '@/pwa/install-card';

type Invite = {
  id: string;
  label: string;
  expiresAt: number;
  usedAt: number | null;
  createdAt: number;
};
type MembersData = { members: AccountUser[]; invites: Invite[] };
type IssuedLink = { token: string; expiresAt: number };
export function AccountPage() {
  const { session, refresh, logout } = useAccount();
  const user = session.user!;
  const [name, setName] = useState(user.name),
    [avatar, setAvatar] = useState(user.avatar);
  const [busy, setBusy] = useState(false),
    [avatarBusy, setAvatarBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  async function action(work: () => Promise<void>, message: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }
  function saveProfile(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void action(async () => {
      await accountApi('profile', { name, avatar });
      await refresh();
    }, '个人资料已保存');
  }
  function changePassword(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    if (form.get('password') !== form.get('confirm')) {
      setError('两次输入的新密码不一致');
      return;
    }
    void action(async () => {
      await accountApi('password', {
        currentPassword: form.get('currentPassword'),
        password: form.get('password'),
      });
      element.reset();
    }, '密码已更新，其他设备需要重新登录');
  }
  return (
    <section className="account-page">
      <div className="account-heading">
        <div>
          <p className="eyebrow">一起去看秋天</p>
          <h1>我的账户</h1>
        </div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void action(logout, '')}
        >
          <LogOut data-icon="inline-start" />
          退出登录
        </Button>
      </div>
      <Notice message={error} error />
      <Notice message={notice} />
      <InstallCard />
      <div className="account-grid">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>个人资料</h2>
            </CardTitle>
            <CardDescription>{user.username} · 成员</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveProfile}>
              <fieldset disabled={busy} className="account-fieldset">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="profile-name">名字</FieldLabel>
                    <Input
                      id="profile-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      maxLength={40}
                      autoComplete="nickname"
                    />
                  </Field>
                  <AvatarField
                    name={name}
                    value={avatar}
                    onChange={setAvatar}
                    onBusy={setAvatarBusy}
                  />
                  <SubmitButton busy={busy || avatarBusy}>
                    保存资料
                  </SubmitButton>
                </FieldGroup>
              </fieldset>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>修改密码</h2>
            </CardTitle>
            <CardDescription>
              更新后，保留本次登录，其他设备的登录状态失效。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={changePassword}>
              <fieldset disabled={busy} className="account-fieldset">
                <FieldGroup>
                  <input
                    type="hidden"
                    name="username"
                    value={user.username}
                    autoComplete="username"
                  />
                  <Field>
                    <FieldLabel htmlFor="current-password">当前密码</FieldLabel>
                    <Input
                      id="current-password"
                      name="currentPassword"
                      type="password"
                      autoComplete="current-password"
                      required
                      maxLength={128}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="new-password">
                      新密码（至少 10 个字符）
                    </FieldLabel>
                    <Input
                      id="new-password"
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={10}
                      maxLength={128}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="confirm-password">
                      再次输入新密码
                    </FieldLabel>
                    <Input
                      id="confirm-password"
                      name="confirm"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={10}
                      maxLength={128}
                    />
                  </Field>
                  <SubmitButton busy={busy}>更新密码</SubmitButton>
                </FieldGroup>
              </fieldset>
            </form>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
export function MemberManagement() {
  const [data, setData] = useState<MembersData | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [link, setLink] = useState<{
      url: string;
      expiresAt: number;
      title: string;
    } | null>(null),
    [copied, setCopied] = useState(false);
  const [confirmation, setConfirmation] = useState<AccountUser | null>(null);
  const [now, setNow] = useState(0);
  const reload = useCallback(async () => {
    const result = await accountApi<MembersData>('members');
    setData(result);
    setNow(Date.now());
  }, []);
  useEffect(() => {
    let active = true;
    void accountApi<MembersData>('members')
      .then((result) => {
        if (active) {
          setData(result);
          setNow(Date.now());
        }
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await work();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }
  const showLink = (
    result: IssuedLink,
    kind: 'invite' | 'reset',
    title: string,
  ) => {
    setLink({
      url: accountLink(kind, result.token),
      expiresAt: result.expiresAt,
      title,
    });
    setCopied(false);
  };
  return (
    <div className="account-management">
      <h2>成员与邀请</h2>
      <Notice message={error} error />
      <Card>
        <CardHeader>
          <CardTitle>邀请旅伴</CardTitle>
          <CardDescription>
            链接 72 小时内有效，只能注册一个普通成员。请只发给受邀的人。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void action(async () => {
                const result = await accountApi<IssuedLink>('invites', {
                  label: form.get('label'),
                });
                showLink(result, 'invite', '邀请链接');
              });
            }}
          >
            <fieldset disabled={busy} className="account-fieldset">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="invite-label">邀请备注</FieldLabel>
                  <Input
                    id="invite-label"
                    name="label"
                    placeholder="例如：同行旅伴"
                    required
                    maxLength={40}
                  />
                </Field>
                <SubmitButton busy={busy}>
                  <UserPlus data-icon="inline-start" />
                  生成邀请链接
                </SubmitButton>
              </FieldGroup>
            </fieldset>
          </form>
          {link && (
            <div className="account-link-result">
              <Field>
                <FieldLabel htmlFor="issued-link">{link.title}</FieldLabel>
                <Input
                  id="issued-link"
                  value={link.url}
                  readOnly
                  onFocus={(event) => event.target.select()}
                />
              </Field>
              <p>
                有效期至 {new Date(link.expiresAt).toLocaleString('zh-CN')}
                。链接仅在本次显示，刷新后请重新生成。
              </p>
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link.url);
                    setCopied(true);
                  } catch {
                    setError('无法自动复制，请选中链接手动复制');
                  }
                }}
              >
                <Copy data-icon="inline-start" />
                {copied ? '已复制' : '复制链接'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      {!data ? (
        error ? (
          <Button variant="outline" onClick={() => void action(reload)}>
            重新加载成员
          </Button>
        ) : (
          <Skeleton className="h-32 w-full" />
        )
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>成员</CardTitle>
              <CardDescription>
                停用后立即撤销登录；重新启用后可以再次登录。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="account-member-list">
                {data.members.length === 0 && (
                  <li>
                    <Empty>
                      <EmptyHeader>
                        <EmptyTitle>还没有旅行成员</EmptyTitle>
                        <EmptyDescription>
                          为自己和旅伴分别生成邀请，注册各自的个人账号。
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </li>
                )}
                {data.members.map((member) => (
                  <li key={member.id}>
                    <div className="account-member-info">
                      <MemberAvatar name={member.name} avatar={member.avatar} />
                      <div>
                        <strong>{member.name}</strong>
                        <p>{member.username}</p>
                      </div>
                      <Badge
                        variant={member.disabled ? 'outline' : 'secondary'}
                      >
                        {member.disabled
                          ? '已停用'
                          : member.role === 'admin'
                            ? '管理员'
                            : '成员'}
                      </Badge>
                    </div>
                    {member.role !== 'admin' && (
                      <div className="account-member-actions">
                        <Button
                          variant="outline"
                          disabled={busy || member.disabled}
                          onClick={() =>
                            void action(async () => {
                              const result = await accountApi<IssuedLink>(
                                'members/reset',
                                { id: member.id },
                              );
                              showLink(
                                result,
                                'reset',
                                `${member.name}的密码重置链接`,
                              );
                            })
                          }
                        >
                          重置密码
                        </Button>
                        <Button
                          variant={member.disabled ? 'outline' : 'destructive'}
                          disabled={busy}
                          onClick={() => {
                            if (member.disabled)
                              void action(async () => {
                                await accountApi('members/status', {
                                  id: member.id,
                                  disabled: false,
                                });
                              });
                            else setConfirmation(member);
                          }}
                        >
                          {member.disabled ? '重新启用' : '停用'}
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>最近的邀请</CardTitle>
            </CardHeader>
            <CardContent>
              {data.invites.length === 0 ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>还没有邀请</EmptyTitle>
                    <EmptyDescription>
                      生成链接，邀请旅伴加入。
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ul className="account-member-list">
                  {data.invites.map((invite) => {
                    const active = !invite.usedAt && invite.expiresAt > now;
                    return (
                      <li key={invite.id}>
                        <div>
                          <strong>{invite.label}</strong>
                          <p>
                            {invite.usedAt
                              ? '已使用或已撤销'
                              : active
                                ? `有效期至 ${new Date(invite.expiresAt).toLocaleString('zh-CN')}`
                                : '已过期'}
                          </p>
                        </div>
                        {active && (
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              void action(async () => {
                                await accountApi('invites/revoke', {
                                  id: invite.id,
                                });
                                setLink(null);
                              })
                            }
                          >
                            撤销邀请
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
      <AlertDialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmation(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              停用{confirmation?.name}的账号？
            </AlertDialogTitle>
            <AlertDialogDescription>
              对方会退出登录，暂时无法使用账户。账号资料保留，之后可以重新启用。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Notice message={error} error />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await accountApi('members/status', {
                    id: confirmation?.id,
                    disabled: true,
                  });
                  setConfirmation(null);
                })
              }
            >
              {busy ? '正在停用…' : '确认停用'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
