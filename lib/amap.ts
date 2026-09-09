import type { Place } from './planner';
import { dateNow } from './planner';
import { cachedMapQuery, invalidateMapQuery } from './map-query-cache';
import { mapPosition } from './map-lifecycle';
export type XY = [number, number];
export type LngLat = { lng: number; lat: number };
export type MapObject = {
  add: (overlays: unknown) => void;
  clearMap: () => void;
  setFitView: (
    overlays?: unknown[],
    immediately?: boolean,
    avoid?: number[],
    maxZoom?: number,
  ) => void;
  remove: (overlays: unknown) => void;
  getCenter: () => LngLat;
  getZoom: (digits?: number) => number;
  zoomIn: () => void;
  zoomOut: () => void;
  destroy: () => void;
  addControl: (control: unknown) => void;
  on: {
    (event: 'complete', cb: () => void): void;
    (event: 'click', cb: (e: { lnglat: LngLat }) => void): void;
  };
  off: {
    (event: 'complete', cb: () => void): void;
    (event: 'click', cb: (e: { lnglat: LngLat }) => void): void;
  };
  setZoomAndCenter: (zoom: number, point: XY) => void;
};
export type Poi = {
  id: string;
  name: string;
  location: LngLat;
  address?: string;
  cityname?: string;
  adname?: string;
  type?: string;
};
type Callback = (status: string, result: unknown) => void;
export type AMapSDK = {
  Map: new (el: HTMLElement, opts: object) => MapObject;
  Marker: new (opts: object) => unknown;
  Polyline: new (opts: object) => unknown;
  Pixel: new (x: number, y: number) => unknown;
  Circle: new (opts: object) => unknown;
  CircleMarker: new (opts: object) => unknown;
  Scale: new () => unknown;
  ToolBar: new () => unknown;
  Driving: new (opts: object) => {
    search: (start: XY, end: XY, cb: Callback) => void;
  };
  PlaceSearch: new (opts: object) => {
    search: (keywords: string, cb: Callback) => void;
    searchNearBy: (
      keywords: string,
      center: XY,
      radius: number,
      cb: Callback,
    ) => void;
  };
};
declare global {
  interface Window {
    AMap?: AMapSDK;
    _AMapSecurityConfig?: { serviceHost: string };
  }
}
let loading: Promise<AMapSDK> | null = null;
export function loadAmap(): Promise<AMapSDK> {
  if (loading) return loading;
  loading = (async () => {
    if (window.AMap) return window.AMap;
    const response = await fetch('/api/amap-config');
    if (!response.ok) throw new Error('暂时无法连接高德地图服务，请稍后重试。');
    const config = (await response.json()) as {
      configured: boolean;
      key: string;
      proxyPath: string;
    };
    if (!config.configured)
      throw new Error('高德尚未配置，请在服务端配置 Web端 Key 与安全密钥。');
    window._AMapSecurityConfig = {
      serviceHost: `${window.location.origin}${config.proxyPath}`,
    };
    return await new Promise<AMapSDK>((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => {
        script.remove();
        reject(new Error('高德地图加载超时，请检查网络后重试。'));
      }, 20000);
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(config.key)}&plugin=AMap.Driving,AMap.PlaceSearch,AMap.Scale,AMap.ToolBar`;
      script.onload = () => {
        clearTimeout(timer);
        if (window.AMap) resolve(window.AMap);
        else
          reject(new Error('高德 SDK 未就绪，请检查 Key 类型与域名白名单。'));
      };
      script.onerror = () => {
        clearTimeout(timer);
        script.remove();
        reject(new Error('高德地图加载失败，请检查网络。'));
      };
      document.head.appendChild(script);
    });
  })().catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}
function query<T>(
  invoke: (callback: Callback) => void,
  parse: (data: Record<string, unknown>) => T,
  empty?: T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('高德查询超时，请稍后重试。')),
      20000,
    );
    invoke((status, result) => {
      clearTimeout(timer);
      if (status === 'no_data' && empty !== undefined) {
        resolve(empty);
        return;
      }
      if (status !== 'complete') {
        reject(
          new Error(
            status === 'no_data'
              ? '没有找到结果，请更换关键词或位置。'
              : '高德查询失败，请检查额度、Key 类型及安全密钥配置。',
          ),
        );
        return;
      }
      try {
        resolve(parse(result as Record<string, unknown>));
      } catch {
        reject(new Error('高德返回的数据不完整，请重试。'));
      }
    });
  });
}
async function requestDriving(
  from: Pick<Place, 'lng' | 'lat'>,
  to: Pick<Place, 'lng' | 'lat'>,
) {
  if (
    from.lng === null ||
    from.lat === null ||
    to.lng === null ||
    to.lat === null
  )
    throw new Error('先补全路段两端的高德坐标。');
  const AMap = await loadAmap();
  return query(
    (cb) =>
      new AMap.Driving({ policy: 0, extensions: 'all' }).search(
        [from.lng!, from.lat!],
        [to.lng!, to.lat!],
        cb,
      ),
    (data) => {
      const r = (
        data.routes as {
          distance: number;
          time: number;
          steps: { path: LngLat[] }[];
        }[]
      )[0];
      if (!r || !Number.isFinite(r.distance) || !Number.isFinite(r.time))
        throw new Error('缺少路线');
      const raw = r.steps.flatMap((s) =>
        s.path.map((p) => {
          const position = mapPosition(p);
          if (!position) throw new Error('路线包含无效坐标');
          return position;
        }),
      );
      // 仅保留路线展示所需精度；累计里程仍用高德驾车结果。
      const stride = Math.max(1, Math.ceil(raw.length / 1500)),
        path = raw.filter((_, i) => i % stride === 0 || i === raw.length - 1);
      return {
        distanceKm: Math.round(r.distance / 100) / 10,
        drivingMin: Math.round(r.time / 60),
        path,
      };
    },
  );
}
async function requestPois(keywords: string, city: string, near?: XY) {
  const AMap = await loadAmap();
  const search = new AMap.PlaceSearch({
    pageSize: 20,
    pageIndex: 1,
    city: city || '全国',
    citylimit: false,
    extensions: 'all',
  });
  const queryWords = keywords;
  return query(
    (cb) =>
      near
        ? search.searchNearBy(queryWords, near, 10000, cb)
        : search.search(queryWords, cb),
    (data) => {
      const pois = (data.poiList as { pois: Poi[] }).pois;
      return pois.flatMap((p) => {
        const position = mapPosition(p.location);
        return p.id && p.name && position
          ? [{ ...p, location: { lng: position[0], lat: position[1] } }]
          : [];
      });
    },
    [],
  );
}
export function poiPlace(p: Poi): Place {
  return {
    id: `amap-${p.id}`,
    amapId: p.id,
    name: p.name,
    kind: 'sight',
    lng: p.location.lng,
    lat: p.location.lat,
    area: p.adname || p.cityname || '',
    note: typeof p.address === 'string' ? p.address : '',
    sourceUrl: `https://ditu.amap.com/place/${encodeURIComponent(p.id)}`,
    checkedAt: dateNow(),
    verification: 'pending',
  };
}
export type DrivingRoute = {
  distanceKm: number;
  drivingMin: number;
  path: XY[];
};
export function driving(
  from: Pick<Place, 'lng' | 'lat'>,
  to: Pick<Place, 'lng' | 'lat'>,
  refresh = false,
): Promise<DrivingRoute> {
  if (refresh)
    invalidateMapQuery(`drive:${from.lng},${from.lat}>${to.lng},${to.lat}`);
  return cachedMapQuery(
    `drive:${from.lng},${from.lat}>${to.lng},${to.lat}`,
    () => requestDriving(from, to),
  );
}
export function searchPois(
  keywords: string,
  city: string,
  near?: XY,
): Promise<Poi[]> {
  return cachedMapQuery(
    `search:${keywords}|${city}|${near?.join(',') ?? ''}`,
    () => requestPois(keywords, city, near),
  );
}
