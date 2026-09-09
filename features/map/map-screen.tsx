'use client';
import Link from '@/lib/navigation';
import { useState } from 'react';
import { useSearchParams } from '@/lib/navigation';
import { MapPin, Navigation, Plus, Trash2, X } from 'lucide-react';
import { AppShell, href, useCurrentDay } from '@/components/app-shell';
import { DayTabs } from '@/components/day-tabs';
import { Button } from '@/components/ui/button';
import { useTrip } from '@/features/trip/store';
import { dayHeading, duration, summary } from '@/features/trip/selectors';
import { RouteStatus } from '@/features/routing/route-status';
import { useRouting } from '@/features/routing/use-route-planning';
import { useDeleteStop } from '@/features/roadbook/roadbook-screen';
import { navigationUrl } from '@/lib/amap-navigation';
import { MapCanvas } from './map-canvas';
export function MapScreen() {
  const { snapshot, online } = useTrip(),
    day = useCurrentDay(),
    params = useSearchParams(),
    { retry } = useRouting(),
    remove = useDeleteStop();
  const [selected, setSelected] = useState<string | null>(null);
  if (!snapshot || !day)
    return (
      <AppShell active="map">
        <></>
      </AppShell>
    );
  const stop = day.stops.find((s) => s.id === (selected ?? params.get('stop'))),
    total = summary(day, snapshot.records),
    navigation = stop && navigationUrl(stop);
  return (
    <AppShell active="map">
      <div className="map-heading">
        <div>
          <p className="eyebrow">THE WAY NORTH</p>
          <h1>沿途，都是风景。</h1>
        </div>
        <Link className="primary-link" href={href('/place/add', day)}>
          <Plus />
          添加地点
        </Link>
      </div>
      <DayTabs day={day} path="/map" />
      <RouteStatus day={day} />
      <div className="map-layout">
        <div className="map-stage">
          <MapCanvas
            day={day}
            records={snapshot.records}
            selected={stop?.id}
            onSelect={setSelected}
          />
          {stop && (
            <div className="map-stop-sheet">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">
                    第 {day.stops.indexOf(stop) + 1} 个地点
                  </p>
                  <h2>{stop.name}</h2>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="关闭地点卡片"
                  onClick={() => setSelected('')}
                >
                  <X />
                </Button>
              </div>
              <p className="muted">
                {stop.area} · {duration(stop.durationMin)}
              </p>
              <div className="actions">
                <Link
                  className="primary-link"
                  href={href('/place', day, stop.id)}
                >
                  查看详情
                </Link>
                {navigation && (
                  <a
                    className="outline-link"
                    href={navigation}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Navigation />
                    导航
                  </a>
                )}
                <Button
                  variant="ghost"
                  aria-label={`删除 ${stop.name}`}
                  onClick={() => remove(day, stop)}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          )}
        </div>
        <aside className="map-itinerary">
          <p className="eyebrow">{day.date.replaceAll('-', '.')}</p>
          <h2>{dayHeading(day)}</h2>
          <p className="muted">
            {total.distanceKm === null
              ? '路线待规划'
              : `${total.distanceKm} km · ${duration(total.drivingMin)}`}
          </p>
          <div className="map-stops">
            {day.stops.map((s, i) => (
              <button
                type="button"
                className="map-stop-option"
                aria-pressed={stop?.id === s.id}
                key={s.id}
                onClick={() => setSelected(s.id)}
              >
                <span>{i + 1}</span>
                <div>
                  <strong>{s.name}</strong>
                  <small>{s.area || '待补充区域'}</small>
                </div>
                <MapPin />
              </button>
            ))}
          </div>
          {!day.stops.length && (
            <p className="muted">今天还没有地点，添加后会显示在地图上。</p>
          )}
          <Button variant="outline" onClick={retry} disabled={!online}>
            重新查询路线
          </Button>
          <p className="aside-note">
            {online
              ? '按地点顺序规划，不会自动调整游览顺序。'
              : '当前离线。地点和备注可编辑，联网后重新规划路线。'}
          </p>
        </aside>
      </div>
    </AppShell>
  );
}
