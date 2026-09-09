'use client';
import { useState } from 'react';
import { useSearchParams } from '@/lib/navigation';
import Link from '@/lib/navigation';
import {
  ArrowUpRight,
  Clock3,
  Copy,
  MapPin,
  Navigation,
  Pencil,
  Trash2,
} from 'lucide-react';
import { AppShell, href, useCurrentDay } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { useTrip } from '@/features/trip/store';
import { emptyStop } from '@/features/trip/commands';
import { duration, position } from '@/features/trip/selectors';
import type { Stop } from '@/features/trip/types';
import { navigationUrl } from '@/lib/amap-navigation';
import { toast } from '@/components/ui/toast';
import { useDeleteStop } from '@/features/roadbook/roadbook-screen';
import { PlaceForm } from './place-form';
import { LocationPicker } from './location-picker';
async function copyText(value: string) {
  if (!navigator.clipboard?.writeText) throw new Error('复制不可用');
  await navigator.clipboard.writeText(value);
}
function MissingPlace() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>这个地点已不在当天路书中</EmptyTitle>
        <EmptyDescription>它可能已被删除或移动到其他日期。</EmptyDescription>
      </EmptyHeader>
      <Link className="primary-link" href="/">
        回到路书
      </Link>
    </Empty>
  );
}
export function AddPlaceScreen() {
  const day = useCurrentDay(),
    [draft, setDraft] = useState<Stop | null>(null);
  return (
    <AppShell title={draft ? '添加到路书' : '找一个想去的地方'}>
      {day && (
        <div className="narrow-page">
          {draft ? (
            <PlaceForm
              key={draft.id}
              initial={draft}
              day={day}
              isNew
              onCancel={() => setDraft(null)}
            />
          ) : (
            <>
              <p className="page-intro">
                {day.date.slice(5).replace('-', '月')}日 · {day.subtitle}
              </p>
              <LocationPicker
                day={day}
                onChoose={setDraft}
                onManual={() => setDraft(emptyStop())}
              />
            </>
          )}
        </div>
      )}
    </AppShell>
  );
}
export function EditPlaceScreen() {
  const day = useCurrentDay(),
    params = useSearchParams(),
    stop = day?.stops.find((s) => s.id === params.get('stop'));
  return (
    <AppShell title="编辑地点" back={href('/place', day, stop?.id)}>
      <div className="narrow-page">
        {day && stop ? (
          <PlaceForm key={stop.id} initial={stop} day={day} />
        ) : (
          <MissingPlace />
        )}
      </div>
    </AppShell>
  );
}
export function PlaceScreen() {
  const day = useCurrentDay(),
    params = useSearchParams(),
    { snapshot } = useTrip(),
    remove = useDeleteStop();
  const stop = day?.stops.find((s) => s.id === params.get('stop')),
    navigation = stop && navigationUrl(stop);
  return (
    <AppShell title="地点详情">
      {!stop || !day ? (
        <MissingPlace />
      ) : (
        <div className="narrow-page place-detail">
          <p className="eyebrow">
            DAY {snapshot!.trip.days.indexOf(day) + 1} · 第{' '}
            {day.stops.indexOf(stop) + 1} 个地点
          </p>
          <h2>{stop.name}</h2>
          <p className="detail-meta">
            <MapPin />
            {stop.area || '区域待补充'}
            <span>·</span>
            <Clock3 />
            {duration(stop.durationMin)}
          </p>
          <div className="detail-actions">
            {navigation ? (
              <a
                className="primary-link"
                href={navigation}
                target="_blank"
                rel="noreferrer"
              >
                <Navigation />
                用高德导航
              </a>
            ) : (
              <Link
                className="primary-link"
                href={href('/place/edit', day, stop.id)}
              >
                <MapPin />
                选择具体位置
              </Link>
            )}
            <Link className="outline-link" href={href('/map', day, stop.id)}>
              在地图上查看
            </Link>
          </div>
          <section className="detail-section">
            <h3>随手记</h3>
            <p className="long-note">
              {stop.note || '还没有备注。记下想看的风景、停车位置或入口。'}
            </p>
          </section>
          <section className="detail-section">
            <h3>位置</h3>
            <p>
              {position(stop) ? `${stop.lng}, ${stop.lat}` : '待选具体位置'}
            </p>
            {position(stop) && (
              <Button
                variant="ghost"
                onClick={() => {
                  void copyText(`${stop.name}\n${stop.lng},${stop.lat}`)
                    .then(() => toast.add({ title: '已复制', type: 'success' }))
                    .catch(() =>
                      toast.add({
                        title: '复制失败，请手动选择坐标复制',
                        type: 'error',
                      }),
                    );
                }}
              >
                <Copy data-icon="inline-start" />
                复制地点与坐标
              </Button>
            )}
          </section>
          <section className="detail-section">
            <h3>攻略与参考</h3>
            {stop.links.length ? (
              <div className="guide-links">
                {stop.links.map((l) => (
                  <a key={l.id} href={l.url} target="_blank" rel="noreferrer">
                    <div>
                      <strong>{l.title}</strong>
                      {l.note && <small>{l.note}</small>}
                    </div>
                    <ArrowUpRight />
                  </a>
                ))}
              </div>
            ) : (
              <p className="muted">可在编辑中添加小红书或其他攻略链接。</p>
            )}
          </section>
          <div className="detail-footer">
            <Link
              className="outline-link"
              href={href('/place/edit', day, stop.id)}
            >
              <Pencil />
              编辑地点
            </Link>
            <Button variant="destructive" onClick={() => remove(day, stop)}>
              <Trash2 data-icon="inline-start" />
              从当天删除
            </Button>
          </div>
        </div>
      )}
    </AppShell>
  );
}
