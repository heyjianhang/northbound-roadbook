'use client';
import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { useAccount } from './context';
import { MemberManagement } from './account-page';
import { Notice } from './shared';
import { AgentSettings } from '@/features/agent/admin-settings';

export function AdminPage() {
  const { session, logout } = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <main id="main-content" className="account-page account-admin-page">
      <div className="account-heading">
        <div>
          <p className="eyebrow">北行路书 · {session.user!.name}</p>
          <h1>成员管理</h1>
        </div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await logout();
            } catch (e) {
              setError(e instanceof Error ? e.message : '退出失败，请重试');
            } finally {
              setBusy(false);
            }
          }}
        >
          <LogOut data-icon="inline-start" />
          退出管理
        </Button>
      </div>
      <Notice message={error} error />
      <Card>
        <CardHeader>
          <CardTitle>给每位旅伴一个自己的账号</CardTitle>
          <CardDescription>
            用邀请链接为自己和旅伴分别注册。日常使用路书时，登录各自的个人账号；需要管理成员时，再使用管理账号。
          </CardDescription>
        </CardHeader>
      </Card>
      <MemberManagement />
      <AgentSettings />
    </main>
  );
}
