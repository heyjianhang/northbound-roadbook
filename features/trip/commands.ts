import type { Trip, Stop } from './types.ts';

export const uid = (prefix = 'stop') => `${prefix}-${crypto.randomUUID()}`;
export const emptyStop = (): Stop => ({
  id: uid(),
  name: '',
  lng: null,
  lat: null,
  amapId: '',
  area: '',
  durationMin: 60,
  note: '',
  links: [],
});
function changed(trip: Trip, days: Trip['days']): Trip {
  return { ...trip, days, updatedAt: new Date().toISOString() };
}
export function putStop(
  trip: Trip,
  dayId: string,
  stop: Stop,
  position: number,
): Trip {
  const destination = trip.days.find((d) => d.id === dayId);
  if (!destination) throw new Error('找不到目标日期');
  if (!stop.name.trim()) throw new Error('请填写地点名称');
  if (
    !Number.isInteger(position) ||
    !Number.isFinite(stop.durationMin) ||
    stop.durationMin < 0 ||
    stop.durationMin > 1440
  )
    throw new Error('地点顺序或停留时间无效');
  if (destination.stops.filter((s) => s.id !== stop.id).length >= 100)
    throw new Error('每天最多安排 100 个地点');
  return changed(
    trip,
    trip.days.map((day) => {
      const stops = day.stops.filter((s) => s.id !== stop.id);
      if (day.id === dayId)
        stops.splice(
          Math.max(0, Math.min(position, stops.length)),
          0,
          structuredClone(stop),
        );
      return { ...day, stops };
    }),
  );
}
export function removeStop(trip: Trip, dayId: string, stopId: string): Trip {
  return changed(
    trip,
    trip.days.map((d) =>
      d.id === dayId
        ? { ...d, stops: d.stops.filter((s) => s.id !== stopId) }
        : d,
    ),
  );
}
export function reorderStops(trip: Trip, dayId: string, ids: string[]): Trip {
  const day = trip.days.find((d) => d.id === dayId);
  if (
    !day ||
    ids.length !== day.stops.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !day.stops.some((s) => s.id === id))
  )
    throw new Error('地点列表发生变化，请重新排序');
  const lookup = new Map(day.stops.map((s) => [s.id, s]));
  return changed(
    trip,
    trip.days.map((d) =>
      d.id === dayId ? { ...d, stops: ids.map((id) => lookup.get(id)!) } : d,
    ),
  );
}
export function restoreStop(
  trip: Trip,
  dayId: string,
  stop: Stop,
  position: number,
): Trip {
  if (trip.days.some((d) => d.stops.some((s) => s.id === stop.id))) return trip;
  return putStop(trip, dayId, stop, position);
}
