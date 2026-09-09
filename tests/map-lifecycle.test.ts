import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapPosition, whenMapComplete } from '../lib/map-lifecycle.ts';

function fakeMap() {
  let loaded = false;
  const listeners = new Set<() => void>();
  const calls: string[] = [];
  return {
    calls,
    listeners,
    on(_event: 'complete', cb: () => void) {
      listeners.add(cb);
    },
    off(_event: 'complete', cb: () => void) {
      listeners.delete(cb);
    },
    complete() {
      loaded = true;
      for (const cb of listeners) cb();
    },
    addMarkers() {
      if (!loaded) throw new Error('Invalid Object: Pixel(NaN, NaN)');
      calls.push('markers');
    },
  };
}
void test('绘制流程在 complete 之前不添加标记，之后才操作投影', () => {
  const map = fakeMap();
  assert.throws(() => map.addMarkers(), /Pixel\(NaN, NaN\)/);
  const dispose = whenMapComplete(
    map,
    () => map.addMarkers(),
    () => assert.fail('不应超时'),
  );
  assert.deepEqual(map.calls, []);
  map.complete();
  assert.deepEqual(map.calls, ['markers']);
  assert.equal(map.listeners.size, 0);
  dispose();
});
void test('地图重复 complete 不重复初始化控件或覆盖物', () => {
  const map = fakeMap();
  const dispose = whenMapComplete(
    map,
    () => map.addMarkers(),
    () => {},
  );
  map.complete();
  map.complete();
  assert.deepEqual(map.calls, ['markers']);
  dispose();
});
void test('切换日期或重试后，旧实例迟到的完成回调不会激活地图', () => {
  const oldMap = fakeMap(),
    nextMap = fakeMap();
  const disposeOld = whenMapComplete(
    oldMap,
    () => oldMap.addMarkers(),
    () => {},
  );
  const delayed = [...oldMap.listeners][0];
  disposeOld();
  delayed();
  assert.deepEqual(oldMap.calls, []);
  const disposeNext = whenMapComplete(
    nextMap,
    () => nextMap.addMarkers(),
    () => {},
  );
  nextMap.complete();
  assert.deepEqual(nextMap.calls, ['markers']);
  disposeNext();
});
void test('超时反馈可恢复；取消监听后定时器不会更新已销毁的地图', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const map = fakeMap();
  let timeouts = 0;
  const dispose = whenMapComplete(
    map,
    () => map.addMarkers(),
    () => timeouts++,
    100,
  );
  t.mock.timers.tick(100);
  assert.equal(timeouts, 1);
  map.complete();
  assert.deepEqual(map.calls, ['markers']);
  dispose();
  const pending = fakeMap();
  const cancel = whenMapComplete(
    pending,
    () => {},
    () => timeouts++,
    100,
  );
  cancel();
  t.mock.timers.tick(100);
  assert.equal(timeouts, 1);
});
void test('数值坐标、SDK getter 和零坐标统一为普通数组', () => {
  assert.deepEqual(
    mapPosition([121.479287, 50.775955]),
    [121.479287, 50.775955],
  );
  assert.deepEqual(mapPosition({ lng: 0, lat: 0 }), [0, 0]);
  assert.deepEqual(
    mapPosition({ getLng: () => 121.5, getLat: () => 50.7 }),
    [121.5, 50.7],
  );
});
void test('空坐标、NaN、Infinity、越界值和数字字符串不传入高德绘图', () => {
  for (const value of [
    null,
    undefined,
    [],
    [NaN, 1],
    [1, Infinity],
    [null, null],
    { lng: undefined, lat: 1 },
    { lng: 180.1, lat: 30 },
    { lng: 120, lat: 90.1 },
    { lng: '121.5', lat: '50.7' },
  ])
    assert.equal(mapPosition(value), null);
});
