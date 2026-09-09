import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, create } from 'react-test-renderer';
import { useEffect } from 'react';
import { TripProvider, useTrip } from '../features/trip/store';
import {
  RoutePlanningProvider,
  useRouting,
} from '../features/routing/use-route-planning';
import { removeStop, putStop } from '../features/trip/commands';
import { routeKey } from '../features/trip/selectors';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const memory = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (key) => memory.get(key) ?? null },
});
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { onLine: true },
});
globalThis.window = new EventTarget();
globalThis.fetch = async () =>
  new Response(
    JSON.stringify({ configured: false, key: '', proxyPath: '/_AMapService' }),
  );

void test('state providers mount, preserve edits across remounts and discard obsolete asynchronous routes', async () => {
  let state, routing, root;
  const errors = [],
    originalError = console.error;
  console.error = (...args) => {
    if (!String(args[0]).startsWith('react-test-renderer is deprecated'))
      errors.push(args.map(String).join(' '));
  };
  function Probe() {
    const tripState = useTrip(),
      routeState = useRouting();
    useEffect(() => {
      state = tripState;
      routing = routeState;
    }, [tripState, routeState]);
    return null;
  }
  function App() {
    return (
      <TripProvider>
        <RoutePlanningProvider>
          <Probe />
        </RoutePlanningProvider>
      </TripProvider>
    );
  }
  async function until(predicate) {
    for (let i = 0; i < 500; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
      if (predicate()) return;
    }
    assert.fail('Provider update timed out');
  }
  try {
    await act(async () => {
      root = create(<App />);
    });
    await until(() => state.ready && Object.keys(routing.states).length > 0);
    assert.equal(state.snapshot.trip.schemaVersion, 3);
    assert.ok(Object.values(routing.states).every((s) => s.status === 'error'));
    const requests = [];
    window.AMap = {
      Driving: class {
        search(from, to, callback) {
          requests.push([from, to]);
          setTimeout(
            () =>
              callback('complete', {
                routes: [
                  {
                    distance: 12000,
                    time: 1200,
                    steps: [
                      {
                        path: [
                          { lng: from[0], lat: from[1] },
                          { lng: to[0], lat: to[1] },
                        ],
                      },
                    ],
                  },
                ],
              }),
            80,
          );
        }
      },
    };
    const stop = (id, lng) => ({
      id,
      name: id,
      lng,
      lat: 30,
      amapId: '',
      area: '',
      durationMin: 60,
      note: '',
      links: [],
    });
    const document = {
      ...state.snapshot.trip,
      days: [
        {
          id: 'day',
          date: '2026-10-01',
          title: '',
          subtitle: '',
          note: '',
          stops: [stop('A', 100), stop('B', 101), stop('C', 102)],
        },
      ],
      routeRecords: [],
    };
    await act(async () => {
      await state.replace(document);
    });
    await until(() =>
      requests.some(([from, to]) => from[0] === 100 && to[0] === 101),
    );
    await act(async () => {
      await state.commit((t) => removeStop(t, 'day', 'B'));
    });
    const key = routeKey([100, 30], [102, 30]);
    await until(
      () => state.snapshot.records.some((r) => r.key === key) && !state.saving,
    );
    assert.ok(
      !state.snapshot.records.some(
        (r) => r.key === routeKey([100, 30], [101, 30]),
      ),
    );
    assert.deepEqual(
      state.getSnapshot().trip.days[0].stops.map((s) => s.id),
      ['A', 'C'],
    );
    const count = requests.length;
    await act(async () => {
      await state.commit((t) =>
        putStop(t, 'day', { ...t.days[0].stops[0], note: 'saved note' }, 0),
      );
      const leaving = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(leaving);
      assert.equal(
        leaving.defaultPrevented,
        false,
        'completed saves must allow immediate page navigation',
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    assert.equal(requests.length, count);
    await act(async () => {
      root.unmount();
    });
    await act(async () => {
      root = create(<App />);
    });
    await until(() => state.ready);
    assert.equal(state.snapshot.trip.days[0].stops[0].note, 'saved note');
    assert.deepEqual(
      state.snapshot.trip.days[0].stops.map((s) => s.id),
      ['A', 'C'],
    );
    assert.deepEqual(errors, []);
  } finally {
    if (root)
      await act(async () => {
        root.unmount();
      });
    console.error = originalError;
  }
});
