// Stop-loss evaluation with the brief's sample: Dự án Test 2, closed months 05–10/2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateStopLoss } from '../shared/stop-loss.js';
import { firstOpenDate, lastClosedMonth } from '../shared/closing.js';
import { round } from '../shared/format.js';

const COST = 40_688_889;
const PL = { '2026-05': -9_000_000, '2026-06': -8_000_000, '2026-07': -7_500_000, '2026-08': -6_900_000, '2026-09': -7_200_000, '2026-10': -6_888_889 };
const months = Object.entries(PL).map(([month, profit]) => ({ month, profit, cost: COST, revenue: COST + profit, score: 71.6 }));
const policy = {
  enabled: true, startDate: '2026-05-01', warnPct: 70,
  cumulativeLoss: { on: true, amount: 60_000_000 },
  consecutiveLoss: { on: true, months: 6 },
  lowHealth: { on: true, below: 50, months: 2 },
  milestones: [{ id: 'm1', date: '2026-12-31', kind: 'revenue_ratio', value: 80 }],
  triggerCount: 1, action: { type: 'pause' },
};

test('closing rule: month N closes on day 3 of N+1', () => {
  assert.equal(lastClosedMonth('2026-10-16'), '2026-09');
  assert.equal(lastClosedMonth('2026-11-02'), '2026-09');
  assert.equal(lastClosedMonth('2026-11-03'), '2026-10');
  assert.equal(firstOpenDate('2026-10-16'), '2026-10-01');
  assert.equal(firstOpenDate('2026-11-02'), '2026-10-01');
});

test('Dự án Test 2 sample reaches the threshold via consecutive losses', () => {
  const r = evaluateStopLoss(policy, months, { today: '2026-11-04', lastClosed: '2026-10' });
  assert.equal(round(r.cumLoss), 45_488_889);
  assert.equal(round(r.usedPct, 1), 75.8);
  assert.equal(round(r.avg3Loss), 6_996_296);
  assert.equal(round(r.remaining.months, 1), 2.1);
  assert.match(r.remaining.text, /≈ 2,1 tháng · dự kiến chạm ngưỡng khoảng đầu 01\/2027/);
  const c = Object.fromEntries(r.conditions.map((x) => [x.key, x]));
  assert.equal(c.cumulative_loss.met, false);
  assert.equal(c.cumulative_loss.warning, true);
  assert.equal(c.consecutive_loss.met, true);
  assert.equal(c.consecutive_loss.detail, 'Lỗ liên tiếp: 6/6 tháng');
  assert.equal(c.low_health.met, false);
  assert.equal(c['milestone:m1'].met, false);
  assert.equal(c['milestone:m1'].achieving, true);
  assert.match(c['milestone:m1'].detail, /83,1% → đang đạt/);
  assert.deepEqual(r.metKeys, ['consecutive_loss']);
  assert.equal(r.status, 'triggered');
});

test('one month earlier: warning only (5/6 months, 64,3%)', () => {
  const r = evaluateStopLoss(policy, months.slice(0, 5), { today: '2026-10-16', lastClosed: '2026-09' });
  assert.equal(r.status, 'warning');
  assert.equal(round(r.usedPct, 1), 64.3);
});

test('profitable project is safe and has no trend', () => {
  const r = evaluateStopLoss(policy, months.map((m) => ({ ...m, profit: 5_000_000, revenue: COST + 5_000_000 })),
    { today: '2026-11-04', lastClosed: '2026-10' });
  assert.equal(r.status, 'safe');
  assert.equal(r.cumLoss, 0);
  assert.equal(r.remaining.text, 'Không có xu hướng chạm ngưỡng');
});

test('a closed milestone month that misses the target satisfies the condition', () => {
  const p = { ...policy, consecutiveLoss: { on: false, months: 6 }, milestones: [{ id: 'x', date: '2026-10-31', kind: 'breakeven' }] };
  const r = evaluateStopLoss(p, months, { today: '2026-11-04', lastClosed: '2026-10' });
  assert.deepEqual(r.metKeys, ['milestone:x']);
  assert.equal(r.status, 'triggered');
});
