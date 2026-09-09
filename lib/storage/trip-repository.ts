import seed from '../../data/seed-trip.json' with { type: 'json' };
import type {
  RoadbookFile,
  RouteRecord,
  Snapshot,
  Trip,
} from '../../features/trip/types.ts';
import { parseRoadbook, validateRoadbook } from './import-export.ts';
import { openDatabase, transactionResult } from './db.ts';

export type Backup = {
  id: string;
  createdAt: string;
  label: string;
  raw: string;
};
type StoredTrip = { trip: Trip; revision: number };
export const LEGACY_KEY = 'northbound-trip-v1';
export function splitFile(file: RoadbookFile) {
  const { routeRecords, ...trip } = file;
  return { trip, records: routeRecords };
}
export function seedSnapshot(): Snapshot {
  return { ...splitFile(validateRoadbook(seed)), revision: 0 };
}
export async function readSnapshot(): Promise<Snapshot | null> {
  const db = await openDatabase(),
    tx = db.transaction(['state', 'routes'], 'readonly');
  const state = tx.objectStore('state').get('current'),
    routes = tx.objectStore('routes').getAll();
  return transactionResult(tx, () => {
    if (!state.result) return null;
    const stored = state.result as StoredTrip;
    if (!Number.isSafeInteger(stored.revision) || stored.revision < 1)
      throw new Error('本机路书版本损坏，请从备份恢复');
    return {
      ...splitFile(
        validateRoadbook({ ...stored.trip, routeRecords: routes.result }),
      ),
      revision: stored.revision,
    };
  });
}
export async function writeSnapshot(
  snapshot: Pick<Snapshot, 'trip' | 'records'>,
  expectedRevision: number,
  backup?: { label: string; raw?: string },
): Promise<number> {
  const db = await openDatabase(),
    tx = db.transaction(['state', 'routes', 'backups'], 'readwrite');
  const store = tx.objectStore('state'),
    current = store.get('current'),
    oldRoutes = tx.objectStore('routes').getAll();
  let failure: Error | undefined;
  const result = transactionResult(
    tx,
    () => expectedRevision + 1,
    () => failure,
  );
  oldRoutes.onsuccess = () => {
    try {
      const existing = current.result as StoredTrip | undefined;
      if ((existing?.revision || 0) !== expectedRevision) {
        failure = new Error(
          '路书已在另一个窗口更新。请先导出当前编辑，再重新载入。',
        );
        tx.abort();
        return;
      }
      if (backup && (backup.raw || existing)) {
        tx.objectStore('backups').put({
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          label: backup.label,
          raw:
            backup.raw ||
            JSON.stringify({
              ...existing!.trip,
              routeRecords: oldRoutes.result,
            }),
        });
      }
      store.put(
        { trip: snapshot.trip, revision: expectedRevision + 1 },
        'current',
      );
      const routes = tx.objectStore('routes');
      routes.clear();
      snapshot.records.forEach((r) => routes.put(r));
    } catch (error) {
      failure = error instanceof Error ? error : new Error('保存事务失败');
      tx.abort();
    }
  };
  return result;
}
export async function initializeTrip(): Promise<Snapshot> {
  const saved = await readSnapshot();
  if (saved) return saved;
  // Do not seed if legacy storage cannot be read or parsed. A raw backup and
  // the first v3 snapshot are committed in the same transaction.
  const legacy = localStorage.getItem(LEGACY_KEY);
  const next = legacy ? splitFile(parseRoadbook(legacy)) : seedSnapshot();
  try {
    const revision = await writeSnapshot(
      next,
      0,
      legacy ? { label: '旧版路书迁移前', raw: legacy } : undefined,
    );
    return { trip: next.trip, records: next.records, revision };
  } catch (error) {
    const concurrent = await readSnapshot();
    if (concurrent) return concurrent;
    throw error;
  }
}
export async function listBackups(): Promise<Backup[]> {
  const db = await openDatabase(),
    tx = db.transaction('backups', 'readonly'),
    req = tx.objectStore('backups').getAll();
  return transactionResult(tx, () =>
    (req.result as Backup[]).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
  );
}
/** Used only after a boot read failure and an explicit import/restore preview. */
export async function recoverSnapshot(file: RoadbookFile): Promise<Snapshot> {
  const next = splitFile(validateRoadbook(file)),
    legacy = localStorage.getItem(LEGACY_KEY);
  const db = await openDatabase(),
    tx = db.transaction(['state', 'routes', 'backups'], 'readwrite');
  const state = tx.objectStore('state'),
    current = state.get('current'),
    routes = tx.objectStore('routes').getAll();
  let failure: Error | undefined,
    revision = 1;
  const result = transactionResult(
    tx,
    () => ({ ...next, revision }),
    () => failure,
  );
  routes.onsuccess = () => {
    try {
      const previous = current.result as StoredTrip | undefined;
      revision =
        Number.isSafeInteger(previous?.revision) && previous!.revision > 0
          ? previous!.revision + 1
          : 1;
      const backupStore = tx.objectStore('backups');
      if (previous)
        backupStore.put({
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          label: '恢复前原始本机记录',
          raw: JSON.stringify({
            ...previous.trip,
            routeRecords: routes.result,
          }),
        });
      if (legacy)
        backupStore.put({
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          label: '恢复前旧版本原文',
          raw: legacy,
        });
      state.put({ trip: next.trip, revision }, 'current');
      const routeStore = tx.objectStore('routes');
      routeStore.clear();
      next.records.forEach((r) => routeStore.put(r));
    } catch (e) {
      failure = e instanceof Error ? e : new Error('恢复失败');
      tx.abort();
    }
  };
  return result;
}
export function mergeRecord(
  records: RouteRecord[],
  record: RouteRecord,
): RouteRecord[] {
  return [...records.filter((r) => r.key !== record.key), record].slice(-2000);
}
