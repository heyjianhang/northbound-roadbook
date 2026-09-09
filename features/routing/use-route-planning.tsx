'use client';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { driving, loadAmap } from '@/lib/amap';
import { useTrip } from '@/features/trip/store';
import { allLegs, position, routeSignature } from '@/features/trip/selectors';
import type { RouteState } from '@/features/trip/types';
const RoutingContext = createContext<{
  states: Record<string, RouteState>;
  retry: () => void;
}>({ states: {}, retry: () => {} });
export function RoutePlanningProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { snapshot, online, acceptRoute, error: storageError } = useTrip();
  const [run, setRun] = useState<{
      token: string;
      states: Record<string, RouteState>;
    }>({ token: '', states: {} }),
    [retry, setRetry] = useState(0);
  const force = useRef(false);
  const latest = useRef(snapshot);
  useEffect(() => {
    latest.current = snapshot;
  }, [snapshot]);
  const signature = snapshot ? routeSignature(snapshot.trip) : '';
  const missing = snapshot
    ? allLegs(snapshot.trip, snapshot.records)
        .filter((l) => l.key && !l.record?.path.length)
        .map((l) => l.key)
        .join('|')
    : '';
  const token = `${signature}|${missing}|${online}|${storageError}|${retry}`;
  const states = run.token === token ? run.states : {};
  useEffect(() => {
    let canceled = false;
    if (!signature || !online || storageError || !latest.current) return;
    const forced = force.current;
    force.current = false;
    const legs = allLegs(latest.current.trip, latest.current.records).filter(
      (l) => l.key && (!l.record || !l.record.path.length || forced),
    );
    if (!legs.length) return;
    const setLeg = (key: string, value: RouteState | null) => {
      if (!canceled)
        setRun((prev) => {
          const next = prev.token === token ? { ...prev.states } : {};
          if (value) next[key] = value;
          else delete next[key];
          return { token, states: next };
        });
    };
    void (async () => {
      try {
        await loadAmap();
      } catch (error) {
        if (!canceled)
          setRun({
            token,
            states: Object.fromEntries(
              legs.map((l) => [
                l.key!,
                {
                  status: 'error',
                  message:
                    error instanceof Error ? error.message : '高德连接失败',
                },
              ]),
            ),
          });
        return;
      }
      for (const leg of legs) {
        if (canceled) return;
        setLeg(leg.key!, { status: 'loading' });
        try {
          const result = await driving(leg.from, leg.to, forced);
          if (canceled) return;
          await acceptRoute(
            {
              ...result,
              key: leg.key!,
              from: position(leg.from)!,
              to: position(leg.to)!,
              policy: 0,
              checkedAt: new Date().toISOString(),
              source: '高德驾车路线',
            },
            leg.id,
          );
          setLeg(leg.key!, null);
        } catch (error) {
          setLeg(leg.key!, {
            status: 'error',
            message: error instanceof Error ? error.message : '路线查询失败',
          });
        }
      }
    })();
    return () => {
      canceled = true;
    };
  }, [signature, token, online, storageError, acceptRoute]);
  return (
    <RoutingContext.Provider
      value={{
        states,
        retry: () => {
          force.current = true;
          setRetry((n) => n + 1);
        },
      }}
    >
      {children}
    </RoutingContext.Provider>
  );
}
export function useRouting() {
  return useContext(RoutingContext);
}
