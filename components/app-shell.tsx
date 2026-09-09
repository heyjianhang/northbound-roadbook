'use client';
import Link from '@/lib/navigation';
import { useSearchParams } from '@/lib/navigation';
import {
  ArrowLeft,
  BookOpen,
  Compass,
  Map,
  Settings,
  CloudOff,
  Check,
  LoaderCircle,
} from 'lucide-react';
import { useTrip } from '@/features/trip/store';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { downloadText } from '@/lib/storage/import-export';
import type { Day } from '@/features/trip/types';
export function href(path: string, day?: Day | string, stop?: string) {
  const params = new URLSearchParams();
  if (day) params.set('day', typeof day === 'string' ? day : day.id);
  if (stop) params.set('stop', stop);
  return `${path}${params.size ? `?${params}` : ''}`;
}
export function useCurrentDay() {
  const { snapshot } = useTrip(),
    params = useSearchParams(),
    selected = params.get('day');
  return (
    snapshot?.trip.days.find((d) => d.id === selected || d.date === selected) ||
    snapshot?.trip.days.find(
      (d) => d.date === new Date().toLocaleDateString('sv-SE'),
    ) ||
    snapshot?.trip.days[2] ||
    snapshot?.trip.days[0]
  );
}
export function AppShell({
  children,
  active = 'roadbook',
  title,
  back,
}: {
  children: React.ReactNode;
  active?: 'roadbook' | 'map' | 'settings';
  title?: string;
  back?: string;
}) {
  const { snapshot, ready, saving, error, online, retrySave, reload } =
      useTrip(),
    day = useCurrentDay();
  return (
    <div className="app-shell">
      <header className="site-header">
        <Link className="brand" href={href('/', day)} aria-label="北行路书首页">
          <span className="brand-symbol">
            <Compass aria-hidden="true" />
          </span>
          <span>
            北行<span className="brand-sub">路书</span>
          </span>
        </Link>
        <nav className="desktop-nav" aria-label="主导航">
          <Link
            aria-current={active === 'roadbook' ? 'page' : undefined}
            href={href('/', day)}
          >
            每日路书
          </Link>
          <Link
            aria-current={active === 'map' ? 'page' : undefined}
            href={href('/map', day)}
          >
            路线地图
          </Link>
        </nav>
        <div className="header-actions">
          <output className="save-state">
            {!online ? (
              <>
                <CloudOff /> 离线
              </>
            ) : saving ? (
              <>
                <LoaderCircle className="spin" /> 保存中
              </>
            ) : ready && !error ? (
              <>
                <Check /> 已保存到本机
              </>
            ) : null}
          </output>
          <Link
            className="icon-link"
            aria-label="设置与备份"
            href={href('/settings', day)}
          >
            <Settings />
          </Link>
        </div>
      </header>
      <main id="main-content">
        {title && (
          <div className="subpage-heading">
            <Link
              className="icon-link"
              aria-label="返回"
              href={back || href('/', day)}
            >
              <ArrowLeft />
            </Link>
            <h1>{title}</h1>
          </div>
        )}
        {error && (
          <Alert variant="destructive" className="storage-alert">
            <AlertTitle>本机保存需要处理</AlertTitle>
            <AlertDescription>
              <p>{error}</p>
              <div className="actions">
                {snapshot && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      downloadText(
                        JSON.stringify(
                          { ...snapshot.trip, routeRecords: snapshot.records },
                          null,
                          2,
                        ),
                        '北行路书-待保存备份.json',
                      )
                    }
                  >
                    导出当前编辑
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => void retrySave().catch(() => {})}
                >
                  重试保存
                </Button>
                <Button variant="outline" onClick={reload}>
                  重新载入
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}
        {!ready && !(error && active === 'settings') ? (
          <div className="loading-state">
            <p>{error ? '原有数据保持不变。' : '正在打开你的路书…'}</p>
            {error ? (
              <Link className="primary-link" href="/settings">
                导入路书或恢复备份
              </Link>
            ) : (
              <>
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-56 w-full" />
              </>
            )}
          </div>
        ) : (
          children
        )}
      </main>
      <nav className="mobile-nav" aria-label="底部导航">
        <Link
          aria-current={active === 'roadbook' ? 'page' : undefined}
          href={href('/', day)}
        >
          <BookOpen />
          路书
        </Link>
        <Link
          aria-current={active === 'map' ? 'page' : undefined}
          href={href('/map', day)}
        >
          <Map />
          地图
        </Link>
      </nav>
    </div>
  );
}
