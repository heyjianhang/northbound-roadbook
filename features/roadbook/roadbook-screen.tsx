'use client';
import Link from '@/lib/navigation';
import Image from 'next/image';
import {
  ArrowDownUp,
  ArrowRight,
  CarFront,
  Clock3,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  Trees,
} from 'lucide-react';
import { AppShell, href, useCurrentDay } from '@/components/app-shell';
import { DayTabs } from '@/components/day-tabs';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { toast } from '@/components/ui/toast';
import { useTrip } from '@/features/trip/store';
import {
  dayHeading,
  duration,
  legsForDay,
  position,
  summary,
} from '@/features/trip/selectors';
import { removeStop, restoreStop } from '@/features/trip/commands';
import type { Day, Stop } from '@/features/trip/types';
import { RouteStatus } from '@/features/routing/route-status';
import { useRouting } from '@/features/routing/use-route-planning';
export function useDeleteStop() {
  const { commit } = useTrip();
  return (day: Day, stop: Stop) => {
    const index = day.stops.findIndex((s) => s.id === stop.id);
    void commit((t) => removeStop(t, day.id, stop.id))
      .then(() =>
        toast.add({
          title: `已删除「${stop.name}」`,
          actionProps: {
            children: '撤销',
            onClick: () => {
              void commit((t) => restoreStop(t, day.id, stop, index)).catch(
                (e) => toast.add({ title: e.message, type: 'error' }),
              );
            },
          },
        }),
      )
      .catch((e) => toast.add({ title: e.message, type: 'error' }));
  };
}
export function RoadbookScreen() {
  const { snapshot } = useTrip(),
    day = useCurrentDay(),
    remove = useDeleteStop(),
    { states, retry } = useRouting();
  if (!snapshot || !day)
    return (
      <AppShell>
        <></>
      </AppShell>
    );
  const total = summary(day, snapshot.records),
    legs = legsForDay(day, snapshot.records),
    index = snapshot.trip.days.indexOf(day);
  const loading = legs.some(
    (l) => l.key && states[l.key]?.status === 'loading',
  );
  return (
    <AppShell>
      <section className="trip-heading">
        <div>
          <p className="eyebrow">
            {snapshot.trip.startDate.slice(0, 4)} · AUTUMN ROAD TRIP
          </p>
          <h1>北行，去看秋天。</h1>
          <p className="muted">
            {snapshot.trip.days[0]?.stops[0]?.name
              ? `${snapshot.trip.days[0].stops[0].name}出发`
              : '自驾行程'}{' '}
            · {snapshot.trip.days.length} 天 · {snapshot.trip.travelers} 人同行
          </p>
        </div>
        <Link
          className="outline-link desktop-only"
          href={href('/settings', day)}
        >
          离线与备份 <ArrowRight />
        </Link>
      </section>
      <DayTabs day={day} />
      <div className="roadbook-layout">
        <section className="daily-roadbook">
          <div className="day-cover">
            <Image
              src="/images/forest-road.png"
              alt="秋日森林公路氛围插画"
              width={1672}
              height={941}
              unoptimized
              priority
            />
            <span className="cover-caption">森林公路 · 氛围插画</span>
            <div className="cover-title">
              <span>DAY {String(index + 1).padStart(2, '0')}</span>
              <h2>{day.subtitle}</h2>
            </div>
          </div>
          <div className="daily-heading">
            <div>
              <p className="eyebrow">{day.date.replaceAll('-', '.')}</p>
              <h2>{dayHeading(day)}</h2>
            </div>
            <Link
              className="icon-link"
              aria-label="调整地点顺序"
              href={href('/reorder', day)}
            >
              <ArrowDownUp />
            </Link>
          </div>
          <div className="day-stats">
            <div>
              <CarFront />
              <span>
                <strong>
                  {total.distanceKm === null
                    ? '待规划'
                    : `${total.distanceKm} km`}
                </strong>
                <small>驾车里程</small>
              </span>
            </div>
            <div>
              <Clock3 />
              <span>
                <strong>{duration(total.drivingMin)}</strong>
                <small>预计驾驶</small>
              </span>
            </div>
            <div>
              <Trees />
              <span>
                <strong>{duration(total.visitingMin)}</strong>
                <small>计划停留</small>
              </span>
            </div>
          </div>
          <p className="day-note">{day.note}</p>
          <RouteStatus day={day} />
          <div className="section-heading">
            <h3>
              今日地点 <span>{day.stops.length}</span>
            </h3>
            <Link className="text-link" href={href('/place/add', day)}>
              <Plus /> 添加地点
            </Link>
          </div>
          {day.stops.length === 0 && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>给今天留一点想象</EmptyTitle>
                <EmptyDescription>
                  添加一个想看的地方，从这里出发。
                </EmptyDescription>
              </EmptyHeader>
              <Link className="primary-link" href={href('/place/add', day)}>
                添加第一个地点
              </Link>
            </Empty>
          )}
          <ol className="stop-list">
            {day.stops.map((stop, i) => (
              <li key={stop.id}>
                <div className="stop-row">
                  <span className="stop-number">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <div className="stop-main">
                    <Link
                      className="stop-title"
                      href={href('/place', day, stop.id)}
                    >
                      {stop.name}
                      <ArrowRight />
                    </Link>
                    <p className="stop-meta">
                      <MapPin /> {stop.area || '地点'}
                      <span>·</span>
                      {stop.durationMin
                        ? `停留 ${duration(stop.durationMin)}`
                        : '短暂停靠'}
                      {!position(stop) && (
                        <span className="pending-coordinate">待选位置</span>
                      )}
                    </p>
                    {stop.note && <p className="stop-note">{stop.note}</p>}
                    <div className="stop-actions">
                      <Link href={href('/place/edit', day, stop.id)}>
                        <Pencil /> 编辑
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`删除 ${stop.name}`}
                        onClick={() => remove(day, stop)}
                      >
                        <Trash2 data-icon="inline-start" />
                        删除
                      </Button>
                    </div>
                  </div>
                </div>
                {i < legs.length && (
                  <div className="leg-row">
                    <CarFront />
                    <span>
                      {legs[i].record
                        ? `${legs[i].record!.distanceKm} km · ${duration(legs[i].record!.drivingMin)}`
                        : !legs[i].key
                          ? '选择位置后规划路线'
                          : states[legs[i].key!]?.status === 'loading'
                            ? '正在重新规划…'
                            : '路线待规划'}
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ol>
          <Link className="add-stop-link" href={href('/place/add', day)}>
            <Plus /> 再添一个想去的地方
          </Link>
        </section>
        <aside className="day-aside">
          <div className="aside-heading">
            <span className="eyebrow">ON THE ROAD</span>
            <h2>今天的路线</h2>
          </div>
          <div className="route-index">
            {day.stops.map((s, i) => (
              <Link key={s.id} href={href('/place', day, s.id)}>
                <span>{i + 1}</span>
                <div>
                  <strong>{s.name}</strong>
                  <small>{s.area}</small>
                </div>
                <ArrowRight />
              </Link>
            ))}
          </div>
          <Link className="primary-link" href={href('/map', day)}>
            <MapPin /> 在地图上查看
          </Link>
          <p className="aside-note">
            {day.stops.length < 2
              ? '添加两个地点后可规划驾车路线。'
              : total.missing
                ? `${total.missing} 个路段待规划，补齐位置后自动计算。`
                : '里程来自保存的高德驾车记录，出发时可重新查询。'}
          </p>
          <Button variant="outline" disabled={loading} onClick={retry}>
            {loading ? '正在规划…' : '重新查询高德路线'}
          </Button>
          <div className="aside-foot">
            <Trees />
            <p>把时间留给沿途的风景。</p>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
