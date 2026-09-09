import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gcjToWgs, wgsToGcj } from '../scripts/map-coordinates.mjs';
const json = (p) =>
  JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const data = json('../data/map-routes.json'),
  roadbook = json('../data/roadbook.json');
const distance = (a, b) =>
  Math.hypot((a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180), a[1] - b[1]) *
  111320;
test('GCJ coordinates align with WGS84 base map, with sub-metre roundtrip error', () => {
  for (const day of roadbook.days)
    for (const stop of day.stops) {
      if (stop.lng === null) continue;
      const original = [stop.lng, stop.lat],
        point = data.places[stop.name].position;
      assert.deepEqual(point, gcjToWgs(original));
      assert.ok(distance(wgsToGcj(point), original) < 1);
      assert.ok(
        distance(original, point) > 50,
        'must not plot GCJ directly on OSM',
      );
    }
  assert.deepEqual(gcjToWgs([-0.12, 51.5]), [-0.12, 51.5]);
});
test('all six road paths cover every stop in the fixed itinerary, including broad areas', () => {
  assert.equal(data.days.length, 6);
  assert.equal(Object.keys(data.places).length, 11);
  for (const day of roadbook.days) {
    const route = data.days.find((d) => d.id === day.id);
    assert.ok(
      route.path.length > 100,
      'road geometry, not a line between stops',
    );
    assert.equal(route.snapped.length, day.stops.length);
    for (const [i, stop] of day.stops.entries()) {
      const place = data.places[stop.name];
      assert.equal(place.approximate, stop.lng === null);
      assert.ok(
        distance(place.position, route.snapped[i].position) < 1000,
        'nearby road endpoint',
      );
      assert.ok(
        route.path.some((p) => distance(p, route.snapped[i].position) < 10),
      );
    }
    for (const [i, point] of route.path.entries()) {
      assert.ok(
        point[0] > 115 && point[0] < 130 && point[1] > 40 && point[1] < 53,
      );
      if (i)
        assert.ok(
          distance(point, route.path[i - 1]) < 10000,
          'no straight-line shortcut',
        );
    }
  }
});
