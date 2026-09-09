import type {
  GuideLink,
  RoadbookFile,
  RouteRecord,
  Stop,
  XY,
} from '../../features/trip/types.ts';
import { routeKey } from '../../features/trip/selectors.ts';
import { migrateLegacy } from './migrations.ts';

export function safeUrl(value: string): boolean {
  try {
    return ['https:', 'http:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
function fail(message: string): never {
  throw new Error(`路书格式不正确：${message}`);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('需要对象');
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max = 10000): string {
  if (typeof value !== 'string' || value.length > max) fail(label);
  return value;
}
function list(value: unknown, max = 1000): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail('列表缺失或过长');
  return value;
}
function num(value: unknown, min: number, max: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    fail('数值超出范围');
  return value;
}
function id(value: unknown): string {
  const s = text(value, 'ID', 200);
  if (!/^[A-Za-z0-9_-]+$/.test(s)) fail('ID');
  return s;
}
function date(value: unknown): string {
  const s = text(value, '日期', 100);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    !Number.isFinite(Date.parse(s)) ||
    new Date(s).toISOString().slice(0, 10) !== s
  )
    fail('日期');
  return s;
}
function timestamp(value: unknown): string {
  const s = text(value, '更新时间', 100);
  if (!Number.isFinite(Date.parse(s))) fail('更新时间');
  return s;
}
function unique(ids: string[]) {
  if (new Set(ids).size !== ids.length) fail('存在重复 ID');
}
function links(value: unknown): GuideLink[] {
  const result = list(value, 200).map((item) => {
    const l = object(item);
    const url = text(l.url, '攻略网址', 4000);
    if (!safeUrl(url)) fail('攻略仅支持 http/https 网址');
    return {
      id: id(l.id),
      title: text(l.title, '攻略标题', 300),
      url,
      note: text(l.note, '攻略备注'),
    };
  });
  unique(result.map((l) => l.id));
  return result;
}
function point(value: unknown): XY {
  const a = list(value, 2);
  if (a.length !== 2) fail('坐标');
  return [num(a[0], -180, 180), num(a[1], -90, 90)];
}
function stop(value: unknown): Stop {
  const s = object(value),
    name = text(s.name, '地点名称', 300).trim();
  if (!name) fail('地点名称不能为空');
  if ((s.lng === null) !== (s.lat === null)) fail('经纬度应同时填写');
  return {
    id: id(s.id),
    name,
    lng: s.lng === null ? null : num(s.lng, -180, 180),
    lat: s.lat === null ? null : num(s.lat, -90, 90),
    amapId: text(s.amapId, '高德 ID', 200),
    area: text(s.area, '区域', 300),
    durationMin: num(s.durationMin, 0, 1440),
    note: text(s.note, '地点备注'),
    links: links(s.links),
  };
}
export function validateRoadbook(input: unknown): RoadbookFile {
  const root = object(input);
  if (root.schemaVersion === 1 || root.schemaVersion === 2)
    return validateRoadbook(migrateLegacy(root));
  if (root.schemaVersion !== 3 || root.coordinateSystem !== 'GCJ-02')
    fail('不支持的版本或坐标系');
  const startDate = date(root.startDate),
    endDate = date(root.endDate);
  if (startDate > endDate) fail('起止日期');
  const days = list(root.days, 60).map((value) => {
    const d = object(value);
    return {
      id: id(d.id),
      date: date(d.date),
      title: text(d.title, '每天标题', 300),
      subtitle: text(d.subtitle, '每天简介', 300),
      note: text(d.note, '每天备注'),
      stops: list(d.stops, 100).map(stop),
    };
  });
  if (!days.length) fail('至少需要一天');
  unique(days.map((d) => d.id));
  days.forEach((d, i) => {
    if (
      d.date < startDate ||
      d.date > endDate ||
      (i > 0 && d.date <= days[i - 1].date)
    )
      fail('每日日期应按顺序且位于行程内');
  });
  const unscheduled = list(root.unscheduled).map(stop);
  unique([...days.flatMap((d) => d.stops), ...unscheduled].map((s) => s.id));
  const routeRecords: RouteRecord[] = list(root.routeRecords ?? [], 2000).map(
    (value) => {
      const r = object(value),
        from = point(r.from),
        to = point(r.to);
      if (r.policy !== 0 || r.key !== routeKey(from, to))
        fail('路线与坐标不匹配');
      return {
        key: routeKey(from, to),
        from,
        to,
        policy: 0,
        distanceKm: num(r.distanceKm, 0, 20000),
        drivingMin: num(r.drivingMin, 0, 30000),
        path: list(r.path, 50000).map(point),
        checkedAt: timestamp(r.checkedAt),
        source: text(r.source, '路线来源', 500),
      };
    },
  );
  unique(routeRecords.map((r) => r.key));
  const travelers = num(root.travelers, 1, 100);
  if (!Number.isInteger(travelers)) fail('人数');
  return {
    schemaVersion: 3,
    coordinateSystem: 'GCJ-02',
    id: id(root.id),
    title: text(root.title, '标题', 300),
    startDate,
    endDate,
    travelers,
    updatedAt: timestamp(root.updatedAt),
    days,
    links: links(root.links),
    unscheduled,
    routeRecords,
  };
}
export function parseRoadbook(raw: string): RoadbookFile {
  if (new TextEncoder().encode(raw).length > 10_000_000)
    throw new Error('文件超过 10 MB，请缩小后重试');
  try {
    return validateRoadbook(JSON.parse(raw));
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error('文件不是有效的 JSON 路书');
    throw e;
  }
}
export function downloadText(content: string, filename: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: 'application/json;charset=utf-8' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
