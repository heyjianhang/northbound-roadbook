export type XY = [number, number];
export type Priority = 'anchor' | 'required' | 'preferred' | 'optional';
export type Verification = 'pending' | 'confirmed';
export type Place = {
  id: string;
  name: string;
  kind: 'city' | 'sight' | 'camp' | 'food' | 'service';
  lng: number | null;
  lat: number | null;
  amapId: string;
  area: string;
  note: string;
  sourceUrl: string;
  checkedAt: string;
  verification: Verification;
  camping?: {
    permission: 'pending' | 'allowed' | 'forbidden';
    toilet: 'unknown' | 'clean' | 'poor' | 'none';
    note: string;
    backup: string;
  };
};
export type Visit = {
  id: string;
  placeId: string;
  priority: Priority;
  durationMin: number;
  enabled: boolean;
};
export type Day = {
  id: string;
  date: string;
  title: string;
  subtitle: string;
  note: string;
  visits: Visit[];
};
export type RouteRecord = {
  fromId: string;
  toId: string;
  distanceKm: number;
  drivingMin: number;
  fromCoord: string;
  toCoord: string;
  checkedAt: string;
  source: string;
  sourceUrl: string;
  path?: XY[];
};
export type Trip = {
  schemaVersion: 2;
  coordinateSystem: 'GCJ-02';
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  travelers: number;
  updatedAt: string;
  places: Place[];
  days: Day[];
  routeRecords: RouteRecord[];
  links: { id: string; title: string; url: string; note: string }[];
};
export type Leg = {
  id: string;
  dayId: string;
  from: Place;
  to: Place;
  fingerprint: string;
  distanceKm: number | null;
  drivingMin: number | null;
  source: string;
  checkedAt: string;
  path?: XY[];
};
export type Issue = {
  id: string;
  dayId?: string;
  legId?: string;
  message: string;
};
export const priorityNames: Record<Priority, string> = {
  anchor: '起终点',
  required: '必去',
  preferred: '计划去',
  optional: '可选',
};
export const kindNames: Record<Place['kind'], string> = {
  city: '城市',
  sight: '景点',
  camp: '过夜地点',
  food: '餐饮',
  service: '服务区',
};
export const uid = (prefix = 'id') => `${prefix}-${crypto.randomUUID()}`;
export const coord = (p: Pick<Place, 'lng' | 'lat'>) =>
  p.lng === null || p.lat === null ? '' : `${p.lng},${p.lat}`;
export const hours = (n: number | null) =>
  n === null ? '待查' : `${Math.floor(n / 60)}小时${Math.round(n % 60)}分`;
export const dateNow = () => new Date().toLocaleDateString('sv-SE');
export function setVisit(
  trip: Trip,
  dayId: string,
  visitId: string,
  changes: Partial<Visit>,
): Trip {
  return {
    ...trip,
    days: trip.days.map((d) =>
      d.id !== dayId
        ? d
        : {
            ...d,
            visits: d.visits.map((v) => {
              if (v.id !== visitId) return v;
              const next = { ...v, ...changes };
              if (next.priority === 'required' || next.priority === 'anchor')
                next.enabled = true;
              return next;
            }),
          },
    ),
  };
}
export function moveVisit(
  trip: Trip,
  dayId: string,
  visitId: string,
  delta: number,
): Trip {
  return {
    ...trip,
    days: trip.days.map((d) => {
      if (d.id !== dayId) return d;
      const visits = [...d.visits],
        i = visits.findIndex((v) => v.id === visitId),
        j = i + delta;
      if (i <= 0 || i >= visits.length - 1 || j <= 0 || j >= visits.length - 1)
        return d;
      [visits[i], visits[j]] = [visits[j], visits[i]];
      return { ...d, visits };
    }),
  };
}
export function deriveLegs(trip: Trip): Leg[] {
  const places = new Map(trip.places.map((p) => [p.id, p]));
  return trip.days.flatMap((d) => {
    const visits = d.visits.filter((v) => v.enabled);
    return visits.slice(1).map((v, i) => {
      const from = places.get(visits[i].placeId)!,
        to = places.get(v.placeId)!;
      const record = trip.routeRecords.find(
        (r) =>
          r.fromId === from.id &&
          r.toId === to.id &&
          coord(from) !== '' &&
          r.fromCoord === coord(from) &&
          r.toCoord === coord(to),
      );
      return {
        id: `${d.id}--${visits[i].id}--${v.id}`,
        dayId: d.id,
        from,
        to,
        fingerprint: `${from.id}@${coord(from)}>${to.id}@${coord(to)}`,
        distanceKm: record?.distanceKm ?? null,
        drivingMin: record?.drivingMin ?? null,
        source: record?.source ?? '',
        checkedAt: record?.checkedAt ?? '',
        path: record?.path,
      };
    });
  });
}
export function issues(trip: Trip): Issue[] {
  const all: Issue[] = [];
  for (const [i, day] of trip.days.entries()) {
    const prev = trip.days[i - 1];
    if (prev && prev.visits.at(-1)?.placeId !== day.visits[0]?.placeId)
      all.push({
        id: `continuity-${day.id}`,
        dayId: day.id,
        message: '当天起点与前一天终点不一致，请确认过夜地点。',
      });
  }
  for (const leg of deriveLegs(trip)) {
    if (leg.distanceKm === null)
      all.push({
        id: `${leg.id}-distance`,
        dayId: leg.dayId,
        legId: leg.id,
        message: '路段里程待查，请补齐坐标后查询高德路线。',
      });
    else if (!leg.source || !leg.checkedAt)
      all.push({
        id: `${leg.id}-source`,
        dayId: leg.dayId,
        legId: leg.id,
        message: '里程缺少查询来源或日期。',
      });
  }
  const used = new Set(
    trip.days.flatMap((d) =>
      d.visits.filter((v) => v.enabled).map((v) => v.placeId),
    ),
  );
  for (const p of trip.places.filter((p) => used.has(p.id))) {
    if (!coord(p))
      all.push({ id: `${p.id}-coord`, message: `${p.name}：地图坐标待补齐。` });
    if (p.kind === 'camp') {
      if (p.camping?.permission === 'forbidden')
        all.push({
          id: `${p.id}-camp`,
          message: `${p.name}：已记录不允许扎营，请更换过夜方案。`,
        });
      else if (
        p.verification !== 'confirmed' ||
        p.camping?.permission !== 'allowed'
      )
        all.push({
          id: `${p.id}-camp`,
          message: `${p.name}：国庆能否入住或搭帐篷过夜待确认。`,
        });
      if (!p.camping || ['unknown', 'poor', 'none'].includes(p.camping.toilet))
        all.push({
          id: `${p.id}-toilet`,
          message: `${p.name}：厕所及卫生条件需要确认。`,
        });
    }
  }
  return all;
}
export function exportTrip(trip: Trip) {
  return {
    ...trip,
    derived: {
      generatedAt: new Date().toISOString(),
      legs: deriveLegs(trip).map((l) => ({
        id: l.id,
        dayId: l.dayId,
        fromId: l.from.id,
        toId: l.to.id,
        fingerprint: l.fingerprint,
        distanceKm: l.distanceKm,
        drivingMin: l.drivingMin,
        source: l.source,
        checkedAt: l.checkedAt,
      })),
      issues: issues(trip),
    },
  };
}
export function safeUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}
// 校验整个导入文件后才替换浏览器数据；校验器同时供 App 接入与测试使用。
export function validateTrip(input: unknown): Trip {
  function fail(message: string): never {
    throw new Error(`数据格式不正确：${message}`);
  }
  function obj(v: unknown, path: string): Record<string, unknown> {
    if (!v || typeof v !== 'object' || Array.isArray(v)) fail(path);
    return v as Record<string, unknown>;
  }
  function str(v: unknown, path: string, max = 10000): asserts v is string {
    if (typeof v !== 'string' || v.length > max) fail(path);
  }
  function id(v: unknown, path: string) {
    str(v, path, 200);
    if (!/^[A-Za-z0-9_-]+$/.test(v)) fail(path);
  }
  function num(
    v: unknown,
    path: string,
    min = 0,
    max = 100000,
    nullable = false,
  ) {
    if (nullable && v === null) return;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
      fail(path);
  }
  function one(v: unknown, list: unknown[], path: string) {
    if (!list.includes(v)) fail(path);
  }
  function list(v: unknown, path: string, max = 1000): unknown[] {
    if (!Array.isArray(v) || v.length > max) fail(path);
    return v;
  }
  function fields(o: Record<string, unknown>, keys: string[]) {
    keys.forEach((k) => str(o[k], k));
  }
  function unique(items: Record<string, unknown>[], name: string) {
    const ids = new Set();
    items.forEach((o) => {
      id(o.id, `${name}.id`);
      if (ids.has(o.id)) fail(`${name} ID 重复`);
      ids.add(o.id);
    });
    return ids;
  }
  function url(v: unknown, path: string) {
    str(v, path, 4000);
    if (v && !safeUrl(v)) fail(`${path} 仅支持 http/https`);
  }
  function date(v: unknown, path: string, empty = false) {
    str(v, path, 100);
    if (empty && v === '') return;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
      !Number.isFinite(Date.parse(v)) ||
      new Date(v).toISOString().slice(0, 10) !== v
    )
      fail(path);
  }
  function path(o: Record<string, unknown>) {
    if (o.path === undefined) return;
    list(o.path, '路线轨迹', 50000).forEach((p) => {
      if (!Array.isArray(p) || p.length !== 2) fail('轨迹坐标');
      num(p[0], '轨迹经度', -180, 180);
      num(p[1], '轨迹纬度', -90, 90);
    });
  }
  function coords(o: Record<string, unknown>) {
    num(o.lng, '经度', -180, 180, true);
    num(o.lat, '纬度', -90, 90, true);
    if ((o.lng === null) !== (o.lat === null)) fail('经纬度必须同时填写');
  }
  const root = obj(input, '根对象');
  one(root.schemaVersion, [1, 2], '仅支持 schemaVersion 1 或 2');
  one(root.coordinateSystem, ['GCJ-02'], '坐标系');
  id(root.id, '行程 ID');
  fields(root, ['title', 'updatedAt']);
  date(root.startDate, '出发日期');
  date(root.endDate, '结束日期');
  if (String(root.startDate) > String(root.endDate)) fail('日期顺序');
  num(root.travelers, '人数', 1, 100);
  if (!Number.isInteger(root.travelers)) fail('人数应为整数');
  if (!Number.isFinite(Date.parse(String(root.updatedAt)))) fail('更新时间');
  const places = list(root.places, '地点').map((v) => obj(v, '地点')),
    pids = unique(places, '地点');
  places.forEach((p) => {
    fields(p, ['name', 'amapId', 'area', 'note']);
    if (!String(p.name).trim()) fail('地点名称为空');
    one(p.kind, ['city', 'sight', 'camp', 'food', 'service'], '地点类型');
    one(p.verification, ['pending', 'confirmed'], '地点核实状态');
    coords(p);
    if (p.camping !== undefined) {
      const c = obj(p.camping, '过夜条件');
      one(c.permission, ['pending', 'allowed', 'forbidden'], '过夜许可');
      one(c.toilet, ['unknown', 'clean', 'poor', 'none'], '卫生条件');
      fields(c, ['note', 'backup']);
    }
    url(p.sourceUrl, '地点来源');
    date(p.checkedAt, '地点核实日期', true);
  });
  const legacyCopy: Record<string, string> = {
    '长途赶路 · 途中补电待细分': '长途赶路 · 抵达海拉尔',
    '基础车程约12小时，不含补电、排队、休息及国庆拥堵。需先逐段补齐服务区充电点。':
      '基础驾驶约12小时，全天实际用时另计途中停留及国庆拥堵；抵达后以休息为主。',
    '敖鲁古雅必去；森林公园不坐小火车。园内里程与补电单独计入。':
      '敖鲁古雅必去；莫尔道嘎是否进入园区及自驾开放范围需另行确认。',
    '可添加骑马、博物馆或当地餐厅。抵达海拉尔后准备返程补电。':
      '可添加骑马、博物馆或当地餐厅，抵达海拉尔后早点休息，为返程留足精力。',
    '返程 · 途中补电待细分': '返程 · 回到沈阳',
    '返程核对服务区行驶方向，不直接套用去程对向充电站。':
      '返程单独查询高德路线，安排好途中休息，视实际路况调整出发时间。',
  };
  const days = list(root.days, '天数', 60).map((v) => {
    const d = obj(v, '每天行程');
    return root.schemaVersion === 1
      ? {
          ...d,
          subtitle: legacyCopy[String(d.subtitle)] ?? d.subtitle,
          note: legacyCopy[String(d.note)] ?? d.note,
        }
      : d;
  });
  if (!days.length) fail('行程至少一天');
  unique(days, '天');
  let previous = '';
  const vids = new Set();
  days.forEach((d) => {
    fields(d, ['title', 'subtitle', 'note']);
    date(d.date, '日期');
    const ds = String(d.date);
    if (
      ds <= previous ||
      ds < String(root.startDate) ||
      ds > String(root.endDate)
    )
      fail('日期超出范围或未按顺序');
    previous = ds;
    const visits = list(d.visits, '停靠点', 100).map((v) => obj(v, '停靠点'));
    if (visits.length < 2) fail('每天需要起点和终点');
    visits.forEach((v, i) => {
      id(v.id, '停靠点 ID');
      if (vids.has(v.id)) fail('停靠点 ID 重复');
      vids.add(v.id);
      if (!pids.has(v.placeId)) fail('停靠点引用不存在的地点');
      one(
        v.priority,
        ['anchor', 'required', 'preferred', 'optional'],
        '优先级',
      );
      if (typeof v.enabled !== 'boolean') fail('启用状态');
      if ((v.priority === 'required' || v.priority === 'anchor') && !v.enabled)
        fail('必去点和起终点不能停用');
      if ((i === 0 || i === visits.length - 1) !== (v.priority === 'anchor'))
        fail('首尾必须为起终点，中间不能为起终点');
      num(v.durationMin, '停留时间', 0, 1440);
    });
  });
  const records = list(root.routeRecords, '路段记录', 2000).map((v) =>
    obj(v, '路段记录'),
  );
  records.forEach((r) => {
    path(r);
    if (!pids.has(r.fromId) || !pids.has(r.toId)) fail('路段引用不存在的地点');
    num(r.distanceKm, '路程', 0, 20000);
    num(r.drivingMin, '驾驶时长', 0, 30000);
    fields(r, ['fromCoord', 'toCoord', 'source']);
    url(r.sourceUrl, '路线来源');
    date(r.checkedAt, '路线日期', true);
  });
  const links = list(root.links, '攻略', 200).map((v) => obj(v, '攻略'));
  unique(links, '攻略');
  links.forEach((l) => {
    fields(l, ['title', 'note']);
    url(l.url, '攻略链接');
  });
  const {
    coordinateSystem,
    id: tripId,
    title,
    startDate,
    endDate,
    travelers,
    updatedAt,
  } = root;
  return structuredClone({
    schemaVersion: 2,
    coordinateSystem,
    id: tripId,
    title,
    startDate,
    endDate,
    travelers,
    updatedAt,
    places,
    days,
    routeRecords: records,
    links,
  }) as Trip;
}
export function parseTrip(json: string): Trip {
  if (json.length > 10_000_000)
    throw new Error('文件超过 10 MB，请缩小后重试。');
  return validateTrip(JSON.parse(json));
}
