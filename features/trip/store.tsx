'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { RoadbookFile, RouteRecord, Snapshot, Trip } from './types';
import {
  initializeTrip,
  mergeRecord,
  recoverSnapshot,
  splitFile,
  writeSnapshot,
} from '@/lib/storage/trip-repository';
import { routeStillCurrent } from '@/features/routing/plan-routes';

type TripContextValue = {
  snapshot: Snapshot | null;
  getSnapshot: () => Snapshot | null;
  ready: boolean;
  saving: boolean;
  error: string;
  online: boolean;
  commit: (change: (trip: Trip) => Trip) => Promise<void>;
  acceptRoute: (record: RouteRecord, legId: string) => Promise<void>;
  replace: (file: RoadbookFile) => Promise<void>;
  retrySave: () => Promise<void>;
  reload: () => void;
};
const TripContext = createContext<TripContextValue | null>(null);
export function TripProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [ready, setReady] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [online, setOnline] = useState(true);
  const current = useRef<Snapshot | null>(null),
    persistedRevision = useRef(0),
    queue = useRef(Promise.resolve()),
    pending = useRef(0),
    blocked = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const replacing = useRef(false);
  const getSnapshot = useCallback(() => current.current, []);
  useEffect(() => {
    let disposed = false;
    void initializeTrip()
      .then((s) => {
        if (disposed) return;
        current.current = s;
        persistedRevision.current = s.revision;
        setSnapshot(s);
        setReady(true);
      })
      .catch((e) => {
        if (!disposed) {
          blocked.current = true;
          setError(e instanceof Error ? e.message : '无法读取本机路书');
        }
      });
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    if ('BroadcastChannel' in window) {
      channel.current = new BroadcastChannel('northbound-changes');
      channel.current.onmessage = () => {
        blocked.current = true;
        setError('路书已在另一个窗口更新。请先导出当前编辑，再重新载入。');
      };
    }
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current > 0 || (blocked.current && current.current)) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      disposed = true;
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      window.removeEventListener('beforeunload', beforeUnload);
      channel.current?.close();
    };
  }, []);
  const persist = useCallback((next: Snapshot, backup?: { label: string }) => {
    pending.current++;
    setSaving(true);
    const job = queue.current.then(async () => {
      if (blocked.current) throw new Error('保存已暂停，请先处理上方提示');
      const revision = await writeSnapshot(
        next,
        persistedRevision.current,
        backup,
      );
      persistedRevision.current = revision;
      if (current.current === next) {
        current.current = { ...next, revision };
        setSnapshot(current.current);
      }
      channel.current?.postMessage({ revision });
    });
    const settled = job
      .catch((e) => {
        blocked.current = true;
        setError(e instanceof Error ? e.message : '保存失败，请导出备份');
        throw e;
      })
      .finally(() => {
        pending.current--;
        setSaving(pending.current > 0);
      });
    // A completed save must also release the unload guard before the caller
    // navigates away. Keep the serial queue usable while callers see failures.
    queue.current = settled.catch(() => {});
    return settled;
  }, []);
  const commit = useCallback(
    (change: (trip: Trip) => Trip) => {
      if (!current.current || blocked.current || replacing.current)
        return Promise.reject(
          new Error('暂时无法保存，请稍后重试或处理上方提示'),
        );
      const next = { ...current.current, trip: change(current.current.trip) };
      current.current = next;
      setSnapshot(next);
      return persist(next);
    },
    [persist],
  );
  const acceptRoute = useCallback(
    (record: RouteRecord, legId: string) => {
      const s = current.current;
      if (
        !s ||
        blocked.current ||
        replacing.current ||
        !routeStillCurrent(s.trip, legId, record.key)
      )
        return Promise.resolve();
      const next = { ...s, records: mergeRecord(s.records, record) };
      current.current = next;
      setSnapshot(next);
      return persist(next);
    },
    [persist],
  );
  async function replace(file: RoadbookFile) {
    if (replacing.current) throw new Error('正在导入，请稍候');
    replacing.current = true;
    try {
      await queue.current;
      if (!current.current) {
        setSaving(true);
        try {
          const recovered = await recoverSnapshot(file);
          current.current = recovered;
          persistedRevision.current = recovered.revision;
          blocked.current = false;
          setSnapshot(recovered);
          setError('');
          setReady(true);
          channel.current?.postMessage({ revision: recovered.revision });
          return;
        } finally {
          setSaving(false);
        }
      }
      if (!current.current || blocked.current)
        throw new Error('保存已暂停，请先处理上方提示');
      // Keep the old visible document until the backup + replacement transaction succeeds.
      const next = { ...splitFile(file), revision: persistedRevision.current };
      await persist(next, { label: '导入路书前' });
      current.current = { ...next, revision: persistedRevision.current };
      setSnapshot(current.current);
    } finally {
      replacing.current = false;
    }
  }
  const retrySave = useCallback(async () => {
    if (!current.current) return;
    await queue.current;
    blocked.current = false;
    setError('');
    await persist(current.current);
  }, [persist]);
  return (
    <TripContext.Provider
      value={{
        snapshot,
        getSnapshot,
        ready,
        saving,
        error,
        online,
        commit,
        acceptRoute,
        replace,
        retrySave,
        reload: () => window.location.reload(),
      }}
    >
      {children}
    </TripContext.Provider>
  );
}
export function useTrip() {
  const value = useContext(TripContext);
  if (!value) throw new Error('TripProvider is required');
  return value;
}
