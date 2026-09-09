import { validateTrip as validateLegacy } from '../planner.ts';
import { routeKey } from '../../features/trip/selectors.ts';
import type {
  RoadbookFile,
  RouteRecord,
  Stop,
} from '../../features/trip/types.ts';

export function migrateLegacy(input: unknown): RoadbookFile {
  const old = validateLegacy(input);
  const lookup = new Map(old.places.map((p) => [p.id, p]));
  const stop = (placeId: string, id: string, durationMin: number): Stop => {
    const p = lookup.get(placeId)!;
    return {
      id,
      name: p.name,
      lng: p.lng,
      lat: p.lat,
      amapId: p.amapId,
      area: p.area,
      durationMin,
      note: [p.note, p.camping?.note, p.camping?.backup]
        .filter(Boolean)
        .join('\n'),
      links: p.sourceUrl
        ? [
            {
              id: `source-${id}`,
              title: '原地点来源',
              url: p.sourceUrl,
              note: p.checkedAt,
            },
          ]
        : [],
    };
  };
  const activePlaces = new Set(
    old.days.flatMap((d) =>
      d.visits.filter((v) => v.enabled).map((v) => v.placeId),
    ),
  );
  const inactive = old.days.flatMap((d) =>
    d.visits
      .filter((v) => !v.enabled)
      .map((v) => stop(v.placeId, v.id, v.durationMin)),
  );
  const inactivePlaces = new Set(
    old.days.flatMap((d) =>
      d.visits.filter((v) => !v.enabled).map((v) => v.placeId),
    ),
  );
  const records = old.routeRecords.flatMap((r): RouteRecord[] => {
    const a = r.fromCoord.split(',').map(Number),
      b = r.toCoord.split(',').map(Number);
    if (
      !r.fromCoord ||
      !r.toCoord ||
      a.length !== 2 ||
      b.length !== 2 ||
      [...a, ...b].some((n) => !Number.isFinite(n)) ||
      Math.abs(a[0]) > 180 ||
      Math.abs(b[0]) > 180 ||
      Math.abs(a[1]) > 90 ||
      Math.abs(b[1]) > 90
    )
      return [];
    const from: [number, number] = [a[0], a[1]],
      to: [number, number] = [b[0], b[1]];
    return [
      {
        key: routeKey(from, to),
        from,
        to,
        policy: 0,
        distanceKm: r.distanceKm,
        drivingMin: r.drivingMin,
        path: r.path || [],
        checkedAt: r.checkedAt || old.updatedAt,
        source: r.source || '原路书路线记录',
      },
    ];
  });
  return {
    schemaVersion: 3,
    coordinateSystem: 'GCJ-02',
    id: old.id,
    title: old.title,
    startDate: old.startDate,
    endDate: old.endDate,
    travelers: old.travelers,
    updatedAt: old.updatedAt,
    days: old.days.map((d) => ({
      id: d.id,
      date: d.date,
      title: d.title,
      subtitle: d.subtitle,
      note: d.note,
      stops: d.visits
        .filter((v) => v.enabled)
        .map((v) => stop(v.placeId, v.id, v.durationMin)),
    })),
    links: old.links,
    unscheduled: [
      ...inactive,
      ...old.places
        .filter((p) => !activePlaces.has(p.id) && !inactivePlaces.has(p.id))
        .map((p) => stop(p.id, `unused-${p.id}`, 60)),
    ],
    routeRecords: [...new Map(records.map((r) => [r.key, r])).values()],
  };
}
