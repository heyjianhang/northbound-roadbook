import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validateRoadbook,
  parseRoadbook,
} from '../lib/storage/import-export.ts';
const legacy = () =>
  JSON.parse(
    readFileSync(new URL('../lib/seed.json', import.meta.url), 'utf8'),
  );
void test('v1/v2 migrate active occurrences in order, removing priority without losing notes', () => {
  for (const schemaVersion of [1, 2]) {
    const old = legacy();
    old.schemaVersion = schemaVersion;
    old.places[0].note = 'personal entrance note';
    const result = validateRoadbook(old);
    assert.equal(result.schemaVersion, 3);
    assert.equal(result.days[0].stops[0].note, 'personal entrance note');
    assert.equal(result.days[2].stops[1].name, '敖鲁古雅使鹿部落');
    for (const d of result.days)
      for (const s of d.stops)
        for (const field of ['priority', 'enabled', 'required', 'anchor'])
          assert.equal(field in s, false);
    assert.deepEqual(result.links, old.links);
    assert.equal(result.routeRecords.length, old.routeRecords.length);
    assert.equal(result.days[4].stops.length, 2);
    assert.equal(result.unscheduled[0].name, '老三骨头馆（白桦东路）');
  }
});
void test('repeated legacy POIs become independent stop objects and roundtrip', () => {
  const result = validateRoadbook(legacy()),
    first = result.days[0].stops[1],
    second = result.days[1].stops[0];
  assert.notEqual(first.id, second.id);
  first.note = 'edited only here';
  assert.notEqual(first.note, second.note);
  assert.deepEqual(parseRoadbook(JSON.stringify(result)), result);
});
void test('new default roadbook is scenery-first with no campground arrangements', () => {
  const seed = validateRoadbook(
    JSON.parse(
      readFileSync(new URL('../data/seed-trip.json', import.meta.url), 'utf8'),
    ),
  );
  assert.equal(seed.days.length, 6);
  assert.equal(seed.travelers, 2);
  assert.ok(
    seed.days.every((d) =>
      d.stops.every((s) => !/营地|住宿待定|必去/.test(s.name + s.note)),
    ),
  );
});
