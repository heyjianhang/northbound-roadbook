import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validateTrip,
  parseTrip,
  deriveLegs,
  setVisit,
  moveVisit,
  exportTrip,
  issues,
} from '../lib/planner.ts';
const seed = JSON.parse(
  readFileSync(new URL('../lib/seed.json', import.meta.url), 'utf8'),
);
const fresh = () => validateTrip(seed);

void test('旧版导入保留路线、必去点和攻略，移除电量与选站数据', () => {
  const old = {
    ...fresh(),
    schemaVersion: 1,
    vehicle: { model: 'test' },
    stations: [{ id: 'unused' }],
    legPlans: [{ distanceKm: 9999 }],
    rangeSettings: { fullRangeKm: 200 },
    rangeProposals: [],
  };
  const t = validateTrip(old);
  assert.equal(t.schemaVersion, 2);
  assert.deepEqual(t.places, old.places);
  assert.deepEqual(t.days, old.days);
  assert.deepEqual(t.links, old.links);
  for (const k of [
    'vehicle',
    'stations',
    'legPlans',
    'rangeSettings',
    'rangeProposals',
  ])
    assert.equal(k in t, false);
  assert.equal(deriveLegs(t)[0].distanceKm, old.routeRecords[0].distanceKm);
});
void test('只迁移旧默认文案，不改用户自己填写的备注', () => {
  const t = { ...fresh(), schemaVersion: 1 };
  t.days[0].subtitle = '长途赶路 · 途中补电待细分';
  t.days[0].note = '用户写的日落观景计划';
  const result = validateTrip(t);
  assert.equal(result.days[0].subtitle, '长途赶路 · 抵达海拉尔');
  assert.equal(result.days[0].note, '用户写的日落观景计划');
});
void test('路线坐标变化后不复用旧轨迹', () => {
  const t = fresh();
  t.places.find((p) => p.id === 'shenyang')!.lng = 124;
  assert.equal(deriveLegs(t)[0].distanceKm, null);
  assert.equal(deriveLegs(t)[0].path, undefined);
});
void test('过夜许可、卫生与酒店备选随 JSON 往返保存', () => {
  const t = fresh(),
    p = t.places.find((p) => p.kind === 'camp')!;
  p.camping = {
    permission: 'allowed',
    toilet: 'clean',
    note: '场地方确认可自带帐篷过夜，停车在指定场地。',
    backup: '附近镇内酒店待选择',
  };
  p.verification = 'confirmed';
  assert.deepEqual(parseTrip(JSON.stringify(exportTrip(t))), t);
  assert.ok(
    !issues(t).some(
      (i) => i.id === `${p.id}-camp` || i.id === `${p.id}-toilet`,
    ),
  );
  p.camping.permission = 'forbidden';
  p.camping.toilet = 'poor';
  assert.ok(issues(t).some((i) => i.id === `${p.id}-camp`));
  assert.ok(issues(t).some((i) => i.id === `${p.id}-toilet`));
});
void test('拒绝无效版本、坐标、链接、停靠引用及过夜状态', () => {
  for (const mutate of [
    (t: Record<string, unknown>) => {
      t.schemaVersion = 3;
    },
    (t: Record<string, unknown>) => {
      (t.places as { lng: number }[])[0].lng = 200;
    },
    (t: Record<string, unknown>) => {
      (t.links as { url: string }[])[0].url = 'javascript:alert(1)';
    },
    (t: Record<string, unknown>) => {
      (t.places as { camping: unknown }[])[0].camping = {
        permission: 'yes',
        toilet: 'clean',
        note: '',
        backup: '',
      };
    },
  ]) {
    const t = structuredClone(seed);
    mutate(t);
    assert.throws(() => validateTrip(t));
  }
  const t = fresh();
  t.days[0].visits[0].placeId = 'missing';
  assert.throws(() => validateTrip(t));
});
void test('种子可导入，六天路线与必去敖鲁古雅保留', () => {
  const t = fresh();
  assert.equal(t.days.length, 6);
  assert.equal(t.schemaVersion, 2);
  assert.ok(
    t.days[2].visits.some(
      (v) => v.placeId === 'aoluguya' && v.priority === 'required',
    ),
  );
  assert.equal(deriveLegs(t).length, 12);
});
void test('必去不可停用，改成可选后允许停用', () => {
  let t = fresh();
  const v = t.days[2].visits[1];
  t = setVisit(t, 'd3', v.id, { enabled: false });
  assert.equal(t.days[2].visits[1].enabled, true);
  t = setVisit(t, 'd3', v.id, { priority: 'optional', enabled: false });
  assert.equal(t.days[2].visits[1].enabled, false);
});
void test('去掉湿地生成新的相邻路段，不借用旧公里数', () => {
  let t = fresh();
  const v = t.days[1].visits.find((v) => v.placeId === 'erguna')!;
  t = setVisit(t, 'd2', v.id, { enabled: false });
  const l = deriveLegs(t).find(
    (l) => l.from.id === 'moergele' && l.to.id === 'genhe-camp',
  );
  assert.ok(l);
  assert.equal(l.distanceKm, null);
});
void test('不会镜像去程数据作为返程', () => {
  const legs = deriveLegs(fresh());
  assert.equal(legs.find((l) => l.dayId === 'd1')!.distanceKm, 1157.7);
  assert.equal(legs.find((l) => l.dayId === 'd6')!.distanceKm, null);
});
void test('起终点不能排序，中间景点可调整', () => {
  const t = fresh();
  assert.deepEqual(moveVisit(t, 'd3', t.days[2].visits[0].id, 1), t);
  const m = moveVisit(t, 'd3', t.days[2].visits[1].id, 1);
  assert.equal(m.days[2].visits[2].placeId, 'aoluguya');
});
