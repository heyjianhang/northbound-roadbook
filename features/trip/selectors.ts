import type { Day, RouteRecord, Stop, Trip, XY } from './types.ts';

export function position(stop: Pick<Stop, 'lng' | 'lat'>): XY | null {
  return typeof stop.lng === 'number' &&
    typeof stop.lat === 'number' &&
    Number.isFinite(stop.lng) &&
    Number.isFinite(stop.lat) &&
    Math.abs(stop.lng) <= 180 &&
    Math.abs(stop.lat) <= 90
    ? [stop.lng, stop.lat]
    : null;
}
export const routeKey = (from: XY, to: XY) =>
  `driving:0:${from.join(',')}>${to.join(',')}`;
export function legsForDay(day: Day, records: RouteRecord[] = []) {
  const cache = new Map(records.map((r) => [r.key, r]));
  return day.stops.slice(1).map((to, i) => {
    const from = day.stops[i],
      a = position(from),
      b = position(to);
    const key = a && b ? routeKey(a, b) : null;
    return {
      id: `${day.id}:${from.id}>${to.id}`,
      dayId: day.id,
      from,
      to,
      key,
      record: key ? cache.get(key) : undefined,
    };
  });
}
export function allLegs(trip: Trip, records: RouteRecord[] = []) {
  return trip.days.flatMap((d) => legsForDay(d, records));
}
export function routeSignature(trip: Trip) {
  return JSON.stringify(
    trip.days.map((d) => [d.id, ...d.stops.map((s) => [s.id, s.lng, s.lat])]),
  );
}
export function summary(day: Day, records: RouteRecord[]) {
  const legs = legsForDay(day, records);
  const complete = legs.length > 0 && legs.every((l) => l.record);
  return {
    complete,
    missing: legs.filter((l) => !l.record).length,
    distanceKm: complete
      ? Math.round(legs.reduce((n, l) => n + l.record!.distanceKm, 0) * 10) / 10
      : null,
    drivingMin: complete
      ? legs.reduce((n, l) => n + l.record!.drivingMin, 0)
      : null,
    visitingMin: day.stops.reduce((n, s) => n + s.durationMin, 0),
  };
}
export function duration(minutes: number | null) {
  if (minutes === null) return '待规划';
  const n = Math.round(minutes);
  return n >= 60
    ? `${Math.floor(n / 60)} 小时${n % 60 ? ` ${n % 60} 分` : ''}`
    : `${n} 分钟`;
}
export function dayHeading(day: Day) {
  return day.stops.length > 1
    ? `${day.stops[0].name} → ${day.stops.at(-1)!.name}`
    : day.stops[0]?.name || '今天，想去哪里';
}
