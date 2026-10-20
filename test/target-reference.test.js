// "Tham chiếu" & target suggestions from closed months; targets stored "Hiệu lực từ tháng".
// Today 04/11/2026 → closed months up to 10/2026.
process.env.AWP_TODAY = '2026-11-04';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { round } from '../shared/format.js';
import { backtest, difficulty, referenceStats, roundTarget, suggestions } from '../shared/target-reference.js';
import { startTestServer } from './helpers/test-server.js';

let t;
let ref;
before(async () => {
  t = await startTestServer();
  ref = (await t.api('admin', 'POST', '/api/baseline-references', { projectId: 1, metrics: [{ metricKey: 'revenue', source: 'auto' }, { metricKey: 'crash_rate_android', source: 'auto' }] })).data.references;
});
after(() => t.stop());

test('Zen Bell revenue: last 6 closed months and their statistics', () => {
  const r = ref.revenue;
  const s = r.stats;
  assert.deepEqual(s.months.map((m) => [m.month, round(m.value)]), [['2026-05', 52_000_000], ['2026-06', 54_500_000], ['2026-07', 56_000_000],
    ['2026-08', 58_400_000], ['2026-09', 60_100_000], ['2026-10', 62_400_000]]);
  assert.equal(round(s.last), 62_400_000);
  assert.equal(round(s.avg3), 60_300_000);
  assert.equal(round(s.avg6), 57_233_333);
  assert.equal(round(s.min6), 52_000_000);
  assert.equal(round(s.max6), 62_400_000);
  assert.equal(round(s.growth * 100, 1), 3.7);
  assert.equal(s.fewData, false);
  assert.equal(r.sourceText, 'Tính từ App Store Connect + Google Play, các tháng đã chốt');
  assert.equal(round(r.breakEven), 51_311_111);
});

test('suggestions: 60.300.000 · Tăng 10% 66.330.000 · xu hướng 64.717.000 · hòa vốn 51.311.000', () => {
  const r = ref.revenue;
  const sg = Object.fromEntries(suggestions(r.stats, { unit: r.unit, direction: r.direction, pct: 10, breakEven: r.breakEven }).map((x) => [x.key, x.value]));
  assert.deepEqual(sg, { keep: 60_300_000, change: 66_330_000, trend: 64_717_000, breakeven: 51_311_000 });
  // "Thấp là tốt": the percentage button lowers the target.
  const c = ref.crash_rate_android;
  const lower = suggestions(c.stats, { unit: c.unit, direction: c.direction, pct: 10 }).find((x) => x.key === 'change');
  assert.equal(lower.label, 'Giảm 10%');
  assert.equal(lower.value, roundTarget(c.stats.avg3 * 0.9, 'pct'));
});

test('back-test & difficulty: 60.000.000 → 2/6 at 100%, 6/6 Tốt, "Vừa sức" 99,5%; 80.000.000 → "Rất khó" 132,7%', () => {
  const s = ref.revenue.stats;
  assert.deepEqual(backtest(60_000_000, s, 'higher', { green: 80, red: 50 }), { total: 6, reached: 2, good: 6 });
  assert.deepEqual(difficulty(60_000_000, s), { key: 'fair', label: 'Vừa sức', ratio: 99.5 });
  assert.deepEqual(difficulty(80_000_000, s), { key: 'very_hard', label: 'Rất khó', ratio: 132.7 });
  assert.equal(difficulty(50_000_000, s).label, 'Dễ');
  assert.equal(difficulty(70_000_000, s).label, 'Thách thức');
  assert.equal(roundTarget(4.567, 'pct'), 4.6);
  assert.equal(roundTarget(1234.6, 'count'), 1235);
});

test('fewer than 3 months → "Ít dữ liệu" flag; growth uses the months available', () => {
  const s = referenceStats([{ month: '2026-09', value: 100 }, { month: '2026-10', value: 121 }]);
  assert.equal(s.fewData, true);
  assert.equal(round(s.growth * 100, 1), 21.0);
  assert.equal(referenceStats([]).count, 0);
});

test('new target from 11/2026 keeps October at the old target (60.000.000 → 104%, Tốt)', async () => {
  const before = ref.revenue.stats.months.find((m) => m.month === '2026-10').applied;
  assert.deepEqual(before, { target: 60_000_000, pct: 104, status: 'green' });
  const edit = (await t.api('admin', 'GET', '/api/projects/1/edit')).data;
  const baselines = edit.baselines.map((b) => (b.metricKey === 'revenue' ? { ...b, targetMonthly: 66_330_000 } : b));
  const r = await t.api('admin', 'PUT', '/api/projects/1/baselines', { baselines, thresholds: edit.thresholds, effectiveMonth: '2026-11-01' });
  assert.equal(r.status, 200, r.data.error);
  const after = (await t.api('admin', 'POST', '/api/baseline-references', { projectId: 1, metrics: [{ metricKey: 'revenue', source: 'auto' }] })).data.references;
  assert.deepEqual(after.revenue.stats.months.find((m) => m.month === '2026-10').applied, before);
  const again = (await t.api('admin', 'GET', '/api/projects/1/edit')).data;
  assert.equal(again.baselineEffective, '2026-11-01');
  assert.equal(again.baselines.find((b) => b.metricKey === 'revenue').targetMonthly, 66_330_000);
  assert.equal((await t.api('admin', 'PUT', '/api/projects/1/baselines', { baselines, thresholds: edit.thresholds, effectiveMonth: '2026-10-01' })).status, 422);
  // The stop-loss months keep their scores (October scored with 60.000.000).
  const hist = (await t.api('admin', 'GET', '/api/projects/1/history')).data.history;
  assert.ok(hist.some((h) => h.field === 'Mục tiêu/tháng Doanh thu' && h.effectiveDate === '2026-11-01'));
});

test('new project (wizard): no own data, siblings of the parent at their first launch month, break-even from staffing', async () => {
  const r = (await t.api('admin', 'POST', '/api/baseline-references', { parentId: 5, metrics: [{ metricKey: 'revenue', source: 'auto' }],
    staffing: { rows: [{ memberId: 4, effortPct: 10 }], manualAllocPct: 0 } })).data.references.revenue;
  assert.equal(r.stats.count, 0);
  assert.equal(r.siblings.parentName, 'Zell App');
  assert.equal(r.siblings.count, 2);
  assert.ok(r.siblings.min <= r.siblings.avg && r.siblings.avg <= r.siblings.max);
  assert.ok(r.breakEven > 1_300_000);
});

test('"Rà soát mục tiêu" is gone: no reminder, no page', async () => {
  assert.equal((await t.api('admin', 'GET', '/api/notifications')).status, 404);
  assert.equal((await t.api('admin', 'GET', '/api/target-review')).status, 404);
});
