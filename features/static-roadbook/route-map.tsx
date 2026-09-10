'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowRight,
  LocateFixed,
  Maximize,
  Navigation,
  X,
  Plus,
  Minus,
} from 'lucide-react';
import { loadAmap, type MapObject, type AMapSDK, type XY } from '@/lib/amap';
import { whenMapComplete, mapPosition } from '@/lib/map-lifecycle';
import { wgsToGcj } from '../../scripts/map-coordinates.mjs';
import Link from '@/lib/navigation';
import { useMobilePlatform } from '@/lib/use-mobile-platform';
import type { Day } from '@/features/trip/types';
import { amapLink, pageUrl, mapPlaceUrl, roadbook } from './data';
import routes from '../../data/map-routes.json';
import centers from '../../data/map-centers.json';
const colors = [
  '#b64c25',
  '#287550',
  '#287caa',
  '#8055a1',
  '#a07813',
  '#ce4260',
];
type PlaceName = keyof typeof routes.places;
type Position = { lat: number; lng: number; accuracy: number };
const paths = routes.days.map((d) => ({
  id: d.id,
  path: d.path.map((p) => wgsToGcj([p[0], p[1]]) as XY),
}));
const points = Object.fromEntries(
  roadbook.days.flatMap((d) =>
    d.stops.map((s) => [
      s.name,
      s.lng !== null && s.lat !== null
        ? [s.lng, s.lat]
        : centers[s.name as keyof typeof centers].gcj02,
    ]),
  ),
) as Record<PlaceName, XY>;
let savedView: {
  day: string;
  center: XY;
  zoom: number;
  scope: 'all' | 'day';
  selected: PlaceName | null;
} | null = null;

export function RouteMap({ day }: { day: Day }) {
  const platform = useMobilePlatform();
  const [restore] = useState(() =>
    savedView?.day === day.id ? savedView : null,
  );
  const restored = useRef(false);
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<MapObject | null>(null);
  const sdk = useRef<AMapSDK | null>(null);
  const routeLines = useRef<{ day: string; overlay: unknown }[]>([]);
  const watch = useRef<number | null>(null);
  const alive = useRef(false),
    centered = useRef(false);
  const [ready, setReady] = useState(false),
    [attempt, setAttempt] = useState(0),
    [error, setError] = useState('');
  const [scope, setScope] = useState<'all' | 'day'>(restore?.scope || 'all');
  const [selected, setSelected] = useState<PlaceName | null>(
    restore?.selected || null,
  );
  const [position, setPosition] = useState<Position | null>(null);
  const [locating, setLocating] = useState(false),
    [locationError, setLocationError] = useState('');
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (watch.current !== null)
        navigator.geolocation.clearWatch(watch.current);
    };
  }, []);
  useEffect(() => {
    let disposed = false,
      instance: MapObject | undefined,
      stopWaiting: (() => void) | undefined;
    void loadAmap()
      .then((AMap) => {
        if (disposed || !host.current) return;
        sdk.current = AMap;
        instance = new AMap.Map(host.current, {
          center: [120.1, 49.8],
          zoom: 7,
          resizeEnable: true,
          viewMode: '2D',
          dragEnable: true,
          zoomEnable: true,
          scrollWheel: true,
          doubleClickZoom: true,
          touchZoom: true,
        });
        map.current = instance;
        instance.addControl(new AMap.Scale());
        stopWaiting = whenMapComplete(
          instance,
          () => {
            if (!disposed) setReady(true);
          },
          () => {
            if (!disposed) setError('高德底图加载超时，请重试');
          },
        );
      })
      .catch((e) => {
        if (!disposed)
          setError(e instanceof Error ? e.message : '高德地图加载失败');
      });
    return () => {
      disposed = true;
      stopWaiting?.();
      map.current = null;
      instance?.destroy();
    };
  }, [attempt]);
  useEffect(() => {
    if (!ready || !map.current || !sdk.current) return;
    const AMap = sdk.current,
      instance = map.current,
      overlays: unknown[] = [];
    routeLines.current = [];
    const ordered = [...paths].sort(
      (a, b) => Number(a.id === day.id) - Number(b.id === day.id),
    );
    for (const route of ordered) {
      const current = route.id === day.id;
      const line = new AMap.Polyline({
        path: route.path,
        strokeColor: colors[roadbook.days.findIndex((d) => d.id === route.id)],
        strokeWeight: current ? 7 : 4,
        strokeOpacity: current ? 1 : 0.55,
        isOutline: current,
        borderWeight: 2,
        outlineColor: '#ffffff',
        lineJoin: 'round',
        showDir: current,
        zIndex: current ? 100 : 50,
      });
      overlays.push(line);
      routeLines.current.push({ day: route.id, overlay: line });
    }
    for (const [name, point] of Object.entries(points)) {
      const number = day.stops.findIndex((s) => s.name === name),
        current = number !== -1;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `trip-map-pin${current ? ' is-current' : ''}`;
      button.style.setProperty(
        '--day-color',
        colors[roadbook.days.indexOf(day)],
      );
      if (current) button.textContent = String(number + 1);
      else {
        const dot = document.createElement('span');
        dot.className = 'map-pin-dot';
        button.appendChild(dot);
      }
      button.setAttribute('aria-label', name);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        setSelected(name as PlaceName);
      });
      overlays.push(
        new AMap.Marker({
          position: point,
          content: button,
          anchor: 'center',
          offset: new AMap.Pixel(0, 0),
          title: name,
          zIndex: current ? 200 : 120,
        }),
      );
    }
    instance.add(overlays);
    return () => {
      if (map.current === instance) instance.remove(overlays);
    };
  }, [ready, day]);
  function fit(target: 'all' | 'day') {
    const lines = routeLines.current
      .filter((r) => target === 'all' || r.day === day.id)
      .map((r) => r.overlay);
    if (lines.length)
      map.current?.setFitView(lines, true, [90, 65, 120, 40], 11);
  }
  useEffect(() => {
    if (!ready || !map.current) return;
    if (restore && !restored.current) {
      restored.current = true;
      savedView = null;
      map.current.setZoomAndCenter(restore.zoom, restore.center);
      return;
    }
    const lines = routeLines.current
      .filter((r) => scope === 'all' || r.day === day.id)
      .map((r) => r.overlay);
    if (lines.length)
      map.current.setFitView(lines, true, [90, 65, 120, 40], 11);
  }, [ready, day, scope, restore]);
  useEffect(() => {
    if (!ready || !position || !map.current || !sdk.current) return;
    const AMap = sdk.current,
      instance = map.current;
    const point = mapPosition(wgsToGcj([position.lng, position.lat]));
    if (!point) return;
    const overlays = [
      new AMap.Circle({
        center: point,
        radius: position.accuracy,
        strokeColor: '#2479df',
        strokeWeight: 1,
        fillColor: '#2479df',
        fillOpacity: 0.1,
        zIndex: 250,
      }),
      new AMap.CircleMarker({
        center: point,
        radius: 8,
        strokeColor: '#fff',
        strokeWeight: 3,
        fillColor: '#2479df',
        fillOpacity: 1,
        zIndex: 300,
      }),
    ];
    instance.add(overlays);
    if (!centered.current) {
      centered.current = true;
      instance.setZoomAndCenter(13, point);
    }
    return () => {
      if (map.current === instance) instance.remove(overlays);
    };
  }, [ready, position]);
  function locate() {
    if (position) {
      map.current?.setZoomAndCenter(
        13,
        wgsToGcj([position.lng, position.lat]) as XY,
      );
      return;
    }
    if (!navigator.geolocation) {
      setLocationError('当前浏览器不支持定位');
      return;
    }
    if (!window.isSecureContext) {
      setLocationError('请通过 HTTPS 打开后定位');
      return;
    }
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    setLocating(true);
    setLocationError('');
    centered.current = false;
    watch.current = navigator.geolocation.watchPosition(
      (result) => {
        if (!alive.current) return;
        setLocating(false);
        setLocationError('');
        setPosition({
          lat: result.coords.latitude,
          lng: result.coords.longitude,
          accuracy: result.coords.accuracy,
        });
      },
      (failure) => {
        if (!alive.current) return;
        setLocating(false);
        setLocationError(
          failure.code === 1
            ? '未获得定位权限，可在浏览器设置中允许后重试'
            : failure.code === 3
              ? '定位超时，请重试'
              : '暂时无法获取位置，请重试',
        );
        if (watch.current !== null)
          navigator.geolocation.clearWatch(watch.current);
        watch.current = null;
        setPosition(null);
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 15000 },
    );
  }

  const selectedDay =
    selected &&
    (day.stops.some((s) => s.name === selected)
      ? day
      : roadbook.days.find((d) => d.stops.some((s) => s.name === selected)));
  const selectedStop = selectedDay?.stops.find((s) => s.name === selected);
  const navigation = selectedStop ? amapLink(selectedStop, platform) : null;
  return (
    <section className="trip-route" aria-label="六天路线地图">
      <h1 className="sr-only">六天路线地图</h1>
      <div className="trip-map-frame">
        <div
          className="trip-map-host"
          ref={host}
          aria-label="可缩放的六天路线地图"
        />
        <button
          type="button"
          className="map-locate"
          onClick={locate}
          disabled={!ready || locating}
          aria-label={locating ? '正在定位' : '我的位置'}
          title="我的位置"
        >
          <LocateFixed aria-hidden="true" />
        </button>
        <div className="map-zoom" aria-label="地图缩放">
          <button
            type="button"
            aria-label="放大地图"
            disabled={!ready}
            onClick={() => map.current?.zoomIn()}
          >
            <Plus />
          </button>
          <button
            type="button"
            aria-label="缩小地图"
            disabled={!ready}
            onClick={() => map.current?.zoomOut()}
          >
            <Minus />
          </button>
        </div>
        <nav className="route-day-tabs" aria-label="地图日期">
          {roadbook.days.map((d, i) => (
            <Link
              key={d.id}
              href={pageUrl('route', d.id)}
              style={{ '--day-color': colors[i] } as CSSProperties}
              aria-label={`10月${i + 1}日`}
              aria-current={day.id === d.id ? 'date' : undefined}
              onClick={() => {
                setScope('day');
                setSelected(null);
              }}
            >
              <i aria-hidden="true" />
              <span>10/{i + 1}</span>
            </Link>
          ))}
        </nav>
        <div className="map-view-controls" aria-label="地图范围">
          <button
            type="button"
            aria-pressed={scope === 'all'}
            disabled={!ready}
            onClick={() => {
              setScope('all');
              setSelected(null);
              fit('all');
            }}
          >
            <Maximize />
            全程
          </button>
          <button
            type="button"
            aria-pressed={scope === 'day'}
            disabled={!ready}
            onClick={() => {
              setScope('day');
              setSelected(null);
              fit('day');
            }}
          >
            当天
          </button>
        </div>
        {(!ready || error) && (
          <output className="trip-map-loading">
            {error || '正在打开地图…'}
            {error && (
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setReady(false);
                  setAttempt((n) => n + 1);
                }}
              >
                重试
              </button>
            )}
          </output>
        )}
        {selectedStop && selectedDay && navigation && (
          <div className="map-place-card">
            <button
              className="map-card-close"
              type="button"
              aria-label="关闭地点"
              onClick={() => setSelected(null)}
            >
              <X />
            </button>
            <strong>{selectedStop.name}</strong>
            {routes.places[selected as PlaceName].approximate && (
              <small>镇区 / 城区参考位置</small>
            )}
            <div>
              <Link
                href={mapPlaceUrl(selectedDay.id, selectedStop.id, day.id)}
                onClick={() => {
                  const center = map.current?.getCenter();
                  if (center && map.current)
                    savedView = {
                      day: day.id,
                      center: [center.lng, center.lat],
                      zoom: map.current.getZoom(10),
                      scope,
                      selected,
                    };
                }}
              >
                地点帖子
                <ArrowRight />
              </Link>
              <a
                href={navigation.href}
                target={navigation.target}
                rel="noopener noreferrer"
              >
                <Navigation />
                {navigation.label}
              </a>
            </div>
          </div>
        )}
        {locationError && (
          <p className="map-feedback" role="alert">
            {locationError}
          </p>
        )}
      </div>
    </section>
  );
}
