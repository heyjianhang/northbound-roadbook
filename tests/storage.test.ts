import 'fake-indexeddb/auto';
import { IDBObjectStore } from 'fake-indexeddb';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  initializeTrip,
  readSnapshot,
  recoverSnapshot,
  seedSnapshot,
  writeSnapshot,
  listBackups,
  LEGACY_KEY,
} from '../lib/storage/trip-repository.ts';
import { openDatabase, transactionResult } from '../lib/storage/db.ts';
const memory = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
  },
});
beforeEach(async () => {
  memory.clear();
  const db = await openDatabase(),
    tx = db.transaction(['state', 'routes', 'backups'], 'readwrite');
  for (const name of ['state', 'routes', 'backups'])
    tx.objectStore(name).clear();
  await transactionResult(tx, () => undefined);
});
void test('initializes once, persists edits, and refuses to seed over a saved document', async () => {
  const original = await initializeTrip();
  assert.equal(original.revision, 1);
  const next = structuredClone(original);
  next.trip.days[0].stops = [];
  await writeSnapshot(next, 1);
  const again = await initializeTrip();
  assert.equal(again.revision, 2);
  assert.equal(again.trip.days[0].stops.length, 0);
});
void test('backs up the exact legacy JSON before v3 migration and leaves localStorage intact', async () => {
  const raw = readFileSync(
    new URL('../lib/seed.json', import.meta.url),
    'utf8',
  );
  memory.set(LEGACY_KEY, raw);
  const result = await initializeTrip();
  assert.equal(result.trip.schemaVersion, 3);
  assert.equal((await listBackups())[0].raw, raw);
  assert.equal(memory.get(LEGACY_KEY), raw);
});
void test('unreadable legacy input is not silently replaced by the default trip', async () => {
  memory.set(LEGACY_KEY, '{corrupt');
  await assert.rejects(initializeTrip());
  assert.equal(await readSnapshot(), null);
  assert.equal(memory.get(LEGACY_KEY), '{corrupt');
});
void test('import stores the replacement and a complete previous backup in one transaction', async () => {
  const current = await initializeTrip(),
    next = structuredClone(current);
  next.trip.title = 'imported roadbook';
  next.trip.days[0].stops = [];
  await writeSnapshot(next, current.revision, { label: 'before import' });
  assert.equal((await readSnapshot())!.trip.title, 'imported roadbook');
  const backup = JSON.parse((await listBackups())[0].raw);
  assert.equal(backup.title, current.trip.title);
  assert.deepEqual(
    backup.routeRecords.toSorted((a: { key: string }, b: { key: string }) =>
      a.key.localeCompare(b.key),
    ),
    current.records.toSorted((a, b) => a.key.localeCompare(b.key)),
  );
});
void test('a stale tab cannot overwrite a newer edit or create a misleading backup', async () => {
  const one = await initializeTrip(),
    two = structuredClone(one);
  two.trip.title = 'newer edit';
  await writeSnapshot(two, 1);
  await assert.rejects(
    writeSnapshot(one, 1, { label: 'stale replacement' }),
    /另一个窗口/,
  );
  assert.equal((await readSnapshot())!.trip.title, 'newer edit');
  assert.equal((await listBackups()).length, 0);
});
void test('a quota/write failure rolls back both replacement and automatic backup', async () => {
  await initializeTrip();
  const current = (await readSnapshot())!,
    next = structuredClone(current);
  next.trip.title = 'must not commit';
  const originalPut = Object.getOwnPropertyDescriptor(
    IDBObjectStore.prototype,
    'put',
  )!.value as IDBObjectStore['put'];
  IDBObjectStore.prototype.put = function (
    ...args: Parameters<IDBObjectStore['put']>
  ) {
    if (this.name === 'state')
      throw new DOMException('Storage quota exhausted', 'QuotaExceededError');
    return originalPut.apply(this, args);
  };
  try {
    await assert.rejects(
      writeSnapshot(next, current.revision, { label: 'must rollback' }),
      /quota/,
    );
  } finally {
    IDBObjectStore.prototype.put = originalPut;
  }
  assert.deepEqual(await readSnapshot(), current);
  assert.equal((await listBackups()).length, 0);
});
void test('corrupt IndexedDB records trigger recovery instead of reseeding', async () => {
  const db = await openDatabase(),
    tx = db.transaction('state', 'readwrite');
  tx.objectStore('state').put(
    { revision: 1, trip: { schemaVersion: 99 } },
    'current',
  );
  await transactionResult(tx, () => undefined);
  await assert.rejects(initializeTrip());
  const check = db.transaction('state'),
    req = check.objectStore('state').get('current');
  const raw = await transactionResult(check, () => req.result);
  assert.equal(raw.trip.schemaVersion, 99);
});
void test('explicit recovery preserves corrupt originals before installing a validated roadbook', async () => {
  memory.set(LEGACY_KEY, '{unreadable original');
  await assert.rejects(initializeTrip());
  const seed = seedSnapshot(),
    recovered = await recoverSnapshot({
      ...seed.trip,
      routeRecords: seed.records,
    });
  assert.equal(recovered.trip.schemaVersion, 3);
  assert.equal((await listBackups())[0].raw, '{unreadable original');
  assert.equal((await readSnapshot())!.trip.id, seed.trip.id);
});
