'use client';
import { useEffect, useRef, useState } from 'react';
import { Map as MapIcon, RefreshCw, Search, Plus, MapPin } from 'lucide-react';
import { mapPosition, whenMapComplete } from '@/lib/map-lifecycle';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TextField, Choice, Notice } from './controls';
import {
  loadAmap,
  driving,
  searchPois,
  poiPlace,
  type MapObject,
  type Poi,
  type XY,
} from '@/lib/amap';
import {
  deriveLegs,
  coord,
  dateNow,
  uid,
  type Trip,
  type Place,
  type RouteRecord,
  type Leg,
} from '@/lib/planner';
export type RouteUpdate = { leg: Leg; record: RouteRecord };
export function MapPanel({
  trip,
  dayId,
  legId,
  onLeg,
  onPlace,
  onRoutes,
  onSettings,
}: {
  trip: Trip;
  dayId: string;
  legId: string;
  onLeg: (id: string) => void;
  onPlace: (p: Place) => void;
  onRoutes: (records: RouteUpdate[]) => void;
  onSettings: () => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<MapObject | null>(null);
  const [loadedMap, setLoadedMap] = useState<MapObject | null>(null),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0),
    [busy, setBusy] = useState(''),
    [message, setMessage] = useState('');
  const ready = loadedMap !== null;
  const [keyword, setKeyword] = useState(''),
    [city, setCity] = useState('呼伦贝尔'),
    [pois, setPois] = useState<Poi[]>([]),
    [picked, setPicked] = useState<XY | null>(null);
  const day = trip.days.find((d) => d.id === dayId)!,
    legs = deriveLegs(trip).filter((l) => l.dayId === dayId),
    leg = legs.find((l) => l.id === legId) || legs[0];
  const scope = useRef(dayId);
  useEffect(() => {
    scope.current = dayId;
  }, [dayId]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    let instance: MapObject | null = null;
    let stopWaiting = () => {};
    const click = (event: { lnglat: unknown }) => {
      const position = mapPosition(event.lnglat);
      if (!cancelled && position) setPicked(position);
    };
    loadAmap()
      .then((A) => {
        if (cancelled || !container.current) return;
        const m = new A.Map(container.current, {
          zoom: 7,
          center: [120.1, 50.3],
          viewMode: '2D',
        });
        instance = m;
        map.current = m;
        stopWaiting = whenMapComplete(
          m,
          () => {
            if (cancelled || map.current !== m) return;
            m.addControl(new A.Scale());
            m.addControl(new A.ToolBar());
            m.on('click', click);
            setError('');
            setLoadedMap(m);
          },
          () => {
            if (cancelled) return;
            setLoadedMap(null);
            setError('地图加载超时，请检查网络后重试。');
          },
        );
      })
      .catch(() => {
        if (!cancelled) {
          setLoadedMap(null);
          setError('地图加载失败，请检查高德配置和网络后重试。');
        }
      });
    return () => {
      cancelled = true;
      stopWaiting();
      instance?.off('click', click);
      instance?.destroy();
      if (map.current === instance) map.current = null;
    };
  }, [retry]);
  const routeInputs = JSON.stringify(
    legs.map((l) => ({
      id: l.id,
      fingerprint: l.fingerprint,
      from: l.from,
      to: l.to,
      hasPath: !!l.path?.length,
      dayId: l.dayId,
    })),
  );
  const routeCallback = useRef(onRoutes);
  useEffect(() => {
    routeCallback.current = onRoutes;
  }, [onRoutes]);
  useEffect(() => {
    if (!loadedMap) return;
    let cancelled = false;
    const pending = (
      JSON.parse(routeInputs) as (Leg & { hasPath: boolean })[]
    ).filter((l) => !l.hasPath);
    if (!pending.length) return;
    void (async () => {
      const updates: RouteUpdate[] = [];
      let failed = 0;
      for (const l of pending) {
        if (cancelled) return;
        try {
          const result = await driving(l.from, l.to);
          updates.push({
            leg: l,
            record: {
              fromId: l.from.id,
              toId: l.to.id,
              fromCoord: coord(l.from),
              toCoord: coord(l.to),
              ...result,
              checkedAt: dateNow(),
              source: '高德 JS API · 速度优先 · 基础路线',
              sourceUrl:
                'https://lbs.amap.com/api/javascript-api-v2/guide/services/navigation',
            },
          });
        } catch {
          failed++;
        }
      }
      if (cancelled) return;
      if (updates.length) routeCallback.current(updates);
      setMessage(
        failed
          ? `${failed} 段高德路线未查询成功，可点击“重新算路”重试。`
          : '已自动加载当天高德驾车路线。',
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [loadedMap, routeInputs]);
  const visual = JSON.stringify({
    places: day.visits
      .filter((v) => v.enabled)
      .map((v) => trip.places.find((p) => p.id === v.placeId)),
    legs: legs.map((l) => ({
      path: l.path,
      from: l.from,
      to: l.to,
    })),
    pois,
    picked,
    legId,
  });
  useEffect(() => {
    const m = map.current,
      A = window.AMap;
    if (!m || !A || loadedMap !== m) return;
    try {
      m.clearMap();
      const data = JSON.parse(visual) as {
        places: Place[];
        legs: Leg[];
        pois: Poi[];
        picked: XY | null;
        legId: string;
      };
      const overlays: unknown[] = [];
      data.places.forEach((p, i) => {
        const position = mapPosition(p);
        if (position) {
          const el = document.createElement('div');
          el.className = 'map-stop';
          el.textContent = String(i + 1);
          el.title = p.name;
          overlays.push(
            new A.Marker({
              position,
              content: el,
              title: p.name,
              anchor: 'center',
            }),
          );
        }
      });
      data.legs.forEach((l) => {
        if (
          l.path &&
          l.path.length > 1 &&
          l.path.every((point) => mapPosition(point))
        )
          overlays.push(
            new A.Polyline({
              path: l.path,
              strokeColor: '#bd4d29',
              strokeWeight: 5,
              strokeOpacity: 0.8,
              showDir: true,
            }),
          );
      });
      data.pois.forEach((p, i) => {
        const position = mapPosition(p.location);
        if (!position) return;
        const el = document.createElement('div');
        el.className = 'map-poi';
        el.textContent = String(i + 1);
        el.title = p.name;
        overlays.push(
          new A.Marker({
            position,
            content: el,
            title: p.name,
            anchor: 'center',
          }),
        );
      });
      const pickedPosition = mapPosition(data.picked);
      if (pickedPosition)
        overlays.push(
          new A.Marker({ position: pickedPosition, title: '手动选点' }),
        );
      if (overlays.length) {
        m.add(overlays);
        m.setFitView();
      }
    } catch {
      // SDK 绘制失败只影响地图，行程编辑与本地数据仍然可用。
      queueMicrotask(() => {
        if (map.current !== m) return;
        setLoadedMap(null);
        setError('地图标记绘制失败，请重试加载地图。');
      });
    }
    // 所有绘图数据由 visual 快照提供，避免输入表单时重置地图。
  }, [visual, loadedMap]);
  async function run(task: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(task);
    setMessage('');
    try {
      await fn();
    } catch (e) {
      if (mounted.current)
        setMessage(e instanceof Error ? e.message : '查询失败');
    } finally {
      if (mounted.current) setBusy('');
    }
  }
  async function routes() {
    const requestDay = dayId;
    await run('route', async () => {
      const updates: RouteUpdate[] = [];
      const failures: string[] = [];
      for (const l of legs) {
        try {
          const result = await driving(l.from, l.to);
          updates.push({
            leg: l,
            record: {
              fromId: l.from.id,
              toId: l.to.id,
              fromCoord: coord(l.from),
              toCoord: coord(l.to),
              ...result,
              checkedAt: dateNow(),
              source: '高德 JS API · 速度优先 · 基础路线',
              sourceUrl:
                'https://lbs.amap.com/api/javascript-api-v2/guide/services/navigation',
            },
          });
        } catch (e) {
          failures.push(
            `${l.from.name} → ${l.to.name}：${e instanceof Error ? e.message : '查询失败'}`,
          );
        }
      }
      if (!mounted.current || scope.current !== requestDay) return;
      onRoutes(updates);
      setMessage(`已查询 ${updates.length} 段行程路线。${failures.join('；')}`);
    });
  }
  async function search() {
    const requestDay = dayId;
    await run('search', async () => {
      const results = await searchPois(keyword, city);
      if (!mounted.current || scope.current !== requestDay) return;
      setPois(results);
      setMessage('搜索完成，可加入当天行程；过夜许可和入口需另行确认。');
    });
  }
  return (
    <section className="map-panel">
      <div className="map-heading">
        <div>
          <h3>
            <MapIcon size={18} />
            高德地图
          </h3>
          <p>橙色：行程点与驾车路线 · 绿色：搜索结果</p>
        </div>
        <div className="actions">
          <Badge variant="outline">
            {ready
              ? `${legs.filter((l) => !!l.path?.length).length}/${legs.length} 段驾车路径`
              : '等待连接'}
          </Badge>
          <Button
            variant="outline"
            disabled={!ready || !!busy}
            onClick={routes}
          >
            <RefreshCw />
            {busy === 'route' ? '正在算路…' : '重新算路'}
          </Button>
        </div>
      </div>
      <div
        className="amap-container"
        ref={container}
        aria-label="高德路线地图"
      />
      {!ready && (
        <div className="map-empty">
          <MapIcon size={36} />
          <h4>{error ? '高德地图尚未连接' : '正在加载高德地图…'}</h4>
          <p>{error || '加载底图与路线服务'}</p>
          {error && (
            <div className="actions">
              <Button onClick={onSettings}>查看配置说明</Button>
              <Button
                variant="outline"
                onClick={() => {
                  setError('');
                  setLoadedMap(null);
                  setRetry((n) => n + 1);
                }}
              >
                重试连接
              </Button>
            </div>
          )}
        </div>
      )}
      <div className="map-tools">
        <form
          className="search-grid"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <TextField
            label="搜索景点、过夜地点或餐厅"
            value={keyword}
            required
            placeholder="例如：敖鲁古雅、黑山头民宿"
            onChange={(e) => setKeyword(e.target.value)}
          />
          <TextField
            label="城市 / 区域"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
          <Button type="submit" disabled={!ready || !!busy}>
            <Search />
            搜索地点
          </Button>
        </form>
        <div className="route-summary">
          <Choice
            label="查看路段"
            value={leg?.id ?? ''}
            options={legs.map((l) => ({
              value: l.id,
              label: `${l.from.name} → ${l.to.name}`,
            }))}
            onChange={onLeg}
          />
          <p className="helper">
            {leg?.distanceKm === null
              ? '里程待查询'
              : `${leg?.distanceKm ?? 0} 公里`}{' '}
            ·{' '}
            {leg?.drivingMin === null
              ? '驾驶时间待查询'
              : `约 ${leg?.drivingMin ?? 0} 分钟`}
          </p>
        </div>
        {picked && (
          <div className="picked">
            <MapPin size={16} />
            <span>地图选点：{picked.map((v) => v.toFixed(6)).join(', ')}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onPlace({
                  id: uid('place'),
                  name: '地图选点',
                  kind: 'sight',
                  lng: picked[0],
                  lat: picked[1],
                  amapId: '',
                  area: '',
                  note: '地图手动选点，入口待确认',
                  sourceUrl: '',
                  checkedAt: dateNow(),
                  verification: 'pending',
                })
              }
            >
              加入当天行程
            </Button>
          </div>
        )}
        {message && <Notice>{message}</Notice>}
        {pois.length > 0 && (
          <div className="search-results">
            {pois.map((p, i) => (
              <article key={p.id}>
                <span className="result-number">{i + 1}</span>
                <div>
                  <strong>{p.name}</strong>
                  <p>
                    {typeof p.address === 'string' ? p.address : ''} ·{' '}
                    {p.adname}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onPlace(poiPlace(p))}
                >
                  <Plus />
                  行程点
                </Button>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
