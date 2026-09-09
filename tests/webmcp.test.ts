import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  roadbookTools,
  registerRoadbookTools,
  type RoadbookTool,
} from '../features/trip/webmcp.ts';
import { validateRoadbook } from '../lib/storage/import-export.ts';
import type { Snapshot } from '../features/trip/types.ts';
void test('WebMCP contracts register, reorder through shared commands, read back, and reject invalid IDs', async () => {
  const { routeRecords, ...trip } = validateRoadbook(
    JSON.parse(
      readFileSync(new URL('../data/seed-trip.json', import.meta.url), 'utf8'),
    ),
  );
  let current: Snapshot = { trip, records: routeRecords, revision: 1 };
  const entries = new Map<string, RoadbookTool>(),
    lifetime = new AbortController();
  const tools = roadbookTools(
    () => current,
    async (change) => {
      current = {
        ...current,
        trip: change(current.trip),
        revision: current.revision + 1,
      };
    },
  );
  await registerRoadbookTools(
    {
      registerTool(tool, { signal }) {
        entries.set(tool.name, tool);
        signal.addEventListener('abort', () => entries.delete(tool.name));
      },
    },
    tools,
    lifetime.signal,
  );
  assert.equal(entries.size, 2);
  assert.equal(entries.get('read_roadbook')!.annotations.readOnlyHint, true);
  const day = trip.days[0],
    ids = day.stops.map((s) => s.id).reverse();
  assert.deepEqual(
    await entries
      .get('reorder_day_stops')!
      .execute({ dayId: day.id, stopIds: ids }),
    { saved: true, dayId: day.id, stopIds: ids },
  );
  const result = entries.get('read_roadbook')!.execute({}) as {
    days: { stops: { id: string }[] }[];
  };
  assert.deepEqual(
    result.days[0].stops.map((s) => s.id),
    ids,
  );
  const before = structuredClone(current);
  await assert.rejects(async () =>
    entries
      .get('reorder_day_stops')!
      .execute({ dayId: day.id, stopIds: ['missing'] }),
  );
  await assert.rejects(async () =>
    entries.get('reorder_day_stops')!.execute({ dayId: 3, stopIds: [] }),
  );
  assert.deepEqual(current, before);
  lifetime.abort();
  assert.equal(entries.size, 0);
});
