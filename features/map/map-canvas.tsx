'use client';
import { useEffect, useRef, useState } from 'react';
import { Compass, RefreshCw } from 'lucide-react';
import { loadAmap, type AMapSDK, type MapObject, type XY } from '@/lib/amap';
import { mapPosition, whenMapComplete } from '@/lib/map-lifecycle';
import { legsForDay, position } from '@/features/trip/selectors';
import type { Day, RouteRecord } from '@/features/trip/types';
import { Button } from '@/components/ui/button';

export function MapCanvas({
  day,
  records,
  selected,
  onSelect,
  onPick,
  pick,
}: {
  day: Day;
  records: RouteRecord[];
  selected?: string;
  onSelect?: (id: string) => void;
  onPick?: (point: XY) => void;
  pick?: XY | null;
}) {
  const host = useRef<HTMLDivElement>(null),
    instance = useRef<MapObject | null>(null),
    sdk = useRef<AMapSDK | null>(null);
  const callbacks = useRef({ onSelect, onPick });
  useEffect(() => {
    callbacks.current = { onSelect, onPick };
  }, [onSelect, onPick]);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  const [initial] = useState(
    () => day.stops.map(position).find(Boolean) || [120.4, 50.3],
  );
  useEffect(() => {
    let canceled = false,
      dispose: (() => void) | undefined,
      map: MapObject | undefined;
    void loadAmap()
      .then((AMap) => {
        if (canceled || !host.current) return;
        sdk.current = AMap;
        map = new AMap.Map(host.current, {
          zoom: 8,
          center: initial,
          resizeEnable: true,
          viewMode: '2D',
        });
        instance.current = map;
        map.addControl(new AMap.Scale());
        map.addControl(new AMap.ToolBar());
        const click = (e: { lnglat: { lng: number; lat: number } }) => {
          const point = mapPosition(e.lnglat);
          if (point) callbacks.current.onPick?.(point);
        };
        map.on('click', click);
        const stopWaiting = whenMapComplete(
          map,
          () => {
            if (!canceled) setReady(true);
          },
          () => {
            if (!canceled) setError('地图加载超时，请重试');
          },
        );
        dispose = () => {
          stopWaiting();
          map?.off('click', click);
        };
      })
      .catch((e) => {
        if (!canceled)
          setError(e instanceof Error ? e.message : '地图连接失败');
      });
    return () => {
      canceled = true;
      dispose?.();
      instance.current = null;
      map?.destroy();
    };
  }, [attempt, initial]);
  useEffect(() => {
    if (!ready || !instance.current || !sdk.current) return;
    const map = instance.current,
      AMap = sdk.current;
    map.clearMap();
    const overlays: unknown[] = [];
    for (const leg of legsForDay(day, records))
      if (leg.record?.path.length)
        overlays.push(
          new AMap.Polyline({
            path: leg.record.path,
            strokeColor: '#b64c25',
            strokeWeight: 5,
            strokeOpacity: 0.86,
            showDir: true,
            lineJoin: 'round',
          }),
        );
    day.stops.forEach((s, i) => {
      const point = position(s);
      if (!point) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `amap-stop-marker${selected === s.id ? ' selected' : ''}`;
      button.textContent = String(i + 1);
      button.setAttribute('aria-label', s.name);
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        callbacks.current.onSelect?.(s.id);
      });
      overlays.push(
        new AMap.Marker({ position: point, content: button, anchor: 'center' }),
      );
    });
    if (pick) overlays.push(new AMap.Marker({ position: pick }));
    if (overlays.length) {
      map.add(overlays);
      if (!pick) map.setFitView();
    }
    const focused = day.stops.find((s) => s.id === selected);
    if (focused && position(focused))
      map.setZoomAndCenter(11, position(focused)!);
  }, [ready, day, records, selected, pick]);
  return (
    <div className="map-container">
      <div className="map-host" ref={host} aria-label="高德路线地图" />
      {(!ready || error) && (
        <div className="map-message">
          <Compass />
          <h3>{error ? '在线地图暂未连接' : '正在打开地图…'}</h3>
          <p>{error || '正在加载当天地点与路线'}</p>
          {error && (
            <Button
              variant="outline"
              onClick={() => {
                setReady(false);
                setError('');
                setAttempt((n) => n + 1);
              }}
            >
              <RefreshCw data-icon="inline-start" />
              重试连接
            </Button>
          )}
        </div>
      )}
      {ready && onPick && (
        <span className="map-pick-hint">点击地图，选择一个位置</span>
      )}
    </div>
  );
}
