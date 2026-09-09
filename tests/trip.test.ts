import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validateRoadbook,
  parseRoadbook,
} from '../lib/storage/import-export.ts';
import {
  putStop,
  removeStop,
  reorderStops,
  restoreStop,
} from '../features/trip/commands.ts';
import {
  legsForDay,
  routeKey,
  routeSignature,
  summary,
} from '../features/trip/selectors.ts';
import { routeStillCurrent } from '../features/routing/plan-routes.ts';
import type { Day, RouteRecord, Stop, Trip } from '../features/trip/types.ts';
const fresh = () =>
  validateRoadbook(
    JSON.parse(
      readFileSync(new URL('../data/seed-trip.json', import.meta.url), 'utf8'),
    ),
  );
const fixtureStop = (id: string, lng: number): Stop => ({
  id,
  name: id,
  lng,
  lat: 50,
  amapId: 'same-poi',
  area: '',
  durationMin: 30,
  note: '',
  links: [],
});
const day: Day = {
  id: 'day',
  date: '2026-10-01',
  title: '',
  subtitle: '',
  note: '',
  stops: [fixtureStop('A', 120), fixtureStop('B', 121), fixtureStop('C', 122)],
};
const trip = (): Trip => ({ ...fresh(), days: [structuredClone(day)] });
const record = (a: Stop, b: Stop): RouteRecord => ({
  key: routeKey([a.lng!, a.lat!], [b.lng!, b.lat!]),
  from: [a.lng!, a.lat!],
  to: [b.lng!, b.lat!],
  policy: 0,
  distanceKm: 12,
  drivingMin: 20,
  path: [
    [a.lng!, 50],
    [b.lng!, 50],
  ],
  checkedAt: '2026-09-09',
  source: 'test driving provider',
});
void test('delete the middle point creates A → C; endpoints are also removable down to zero', () => {
  let t = trip();
  t = removeStop(t, 'day', 'B');
  assert.deepEqual(
    t.days[0].stops.map((s) => s.id),
    ['A', 'C'],
  );
  assert.equal(legsForDay(t.days[0])[0].key, routeKey([120, 50], [122, 50]));
  t = removeStop(t, 'day', 'A');
  assert.equal(legsForDay(t.days[0]).length, 0);
  t = removeStop(t, 'day', 'C');
  assert.equal(t.days[0].stops.length, 0);
  assert.equal(
    parseRoadbook(JSON.stringify({ ...t, routeRecords: [] })).days[0].stops
      .length,
    0,
  );
});
void test('undo restores only the deleted occurrence and preserves subsequent edits', () => {
  let t = removeStop(trip(), 'day', 'B');
  t = putStop(t, 'day', { ...t.days[0].stops[0], note: 'after delete' }, 0);
  t = restoreStop(t, 'day', day.stops[1], 1);
  assert.deepEqual(
    t.days[0].stops.map((s) => s.id),
    ['A', 'B', 'C'],
  );
  assert.equal(t.days[0].stops[0].note, 'after delete');
  assert.equal(restoreStop(t, 'day', day.stops[1], 1).days[0].stops.length, 3);
});
void test('all points can reorder, add at the start, or move to another day independently', () => {
  let t = trip();
  t = reorderStops(t, 'day', ['C', 'B', 'A']);
  t = putStop(t, 'day', fixtureStop('D', 119), 0);
  assert.deepEqual(
    t.days[0].stops.map((s) => s.id),
    ['D', 'C', 'B', 'A'],
  );
  t.days.push({
    ...structuredClone(day),
    id: 'day2',
    date: '2026-10-02',
    stops: [],
  });
  t = putStop(t, 'day2', { ...t.days[0].stops[0], note: 'second day' }, 0);
  assert.equal(t.days[0].stops.length, 3);
  assert.equal(t.days[1].stops[0].note, 'second day');
  assert.equal(t.days[0].stops[0].note, '');
  assert.throws(() => reorderStops(t, 'day', ['C', 'C', 'A']));
});
void test('changing only notes or duration leaves route geometry signature unchanged', () => {
  const t = trip(),
    next = putStop(
      t,
      'day',
      { ...t.days[0].stops[1], note: 'photo entrance', durationMin: 75 },
      1,
    );
  assert.equal(routeSignature(next), routeSignature(t));
  assert.notEqual(
    routeSignature(putStop(t, 'day', { ...t.days[0].stops[1], lng: 123 }, 1)),
    routeSignature(t),
  );
});
void test('partial, reversed, or coordinate-stale records never become a full day total', () => {
  const records = [
    record(day.stops[0], day.stops[1]),
    record(day.stops[1], day.stops[2]),
  ];
  assert.equal(summary(day, records).distanceKm, 24);
  assert.equal(summary(day, records.slice(0, 1)).distanceKm, null);
  assert.equal(
    summary({ ...day, stops: [...day.stops].reverse() }, records).distanceKm,
    null,
  );
  const changed = putStop(
    trip(),
    'day',
    { ...day.stops[1], lng: null, lat: null },
    1,
  );
  assert.equal(
    legsForDay(changed.days[0], records).filter((l) => l.record).length,
    0,
  );
});
void test('late responses are rejected after deletion, reorder, coordinate edit or day move', async () => {
  const original = trip(),
    leg = legsForDay(original.days[0])[0];
  let current = original;
  const late = new Promise<boolean>((resolve) =>
    setTimeout(() => resolve(routeStillCurrent(current, leg.id, leg.key!)), 5),
  );
  current = removeStop(current, 'day', 'B');
  assert.equal(await late, false);
  assert.equal(
    routeStillCurrent(
      reorderStops(original, 'day', ['C', 'B', 'A']),
      leg.id,
      leg.key!,
    ),
    false,
  );
  assert.equal(
    routeStillCurrent(
      putStop(original, 'day', { ...day.stops[1], lng: 123 }, 1),
      leg.id,
      leg.key!,
    ),
    false,
  );
  assert.equal(routeStillCurrent(original, leg.id, leg.key!), true);
});
void test('v3 rejects bad links, IDs, coordinates, route fingerprints, and corrupt input', () => {
  for (const mutate of [
    (t: ReturnType<typeof fresh>) => {
      t.days[0].stops[0].links.push({
        id: 'bad',
        title: 'bad',
        url: 'javascript:alert(1)',
        note: '',
      });
    },
    (t: ReturnType<typeof fresh>) => {
      t.days[0].stops[0].lng = NaN;
    },
    (t: ReturnType<typeof fresh>) => {
      t.days[0].stops[1].id = t.days[0].stops[0].id;
    },
    (t: ReturnType<typeof fresh>) => {
      t.routeRecords[0].key = 'unrelated';
    },
    (t: ReturnType<typeof fresh>) => {
      t.days[1].date = '2026-02-31';
    },
  ]) {
    const t = fresh();
    mutate(t);
    assert.throws(() => validateRoadbook(t));
  }
  assert.throws(() => parseRoadbook('{oops'));
  assert.throws(() => parseRoadbook(' '.repeat(10_000_001)));
});
