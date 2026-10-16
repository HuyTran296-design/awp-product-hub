import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreProject, achievement, statusFor } from '../shared/health-score.js';

const thresholds = { green: 80, red: 50 };

test('Zen Bell month score = 99,1% Xanh, all baselines Xanh', () => {
  const baselines = [
    { metricKey: 'revenue', weight: 100, targetMonthly: 60_000_000 },
    { metricKey: 'dau', weight: 80, targetMonthly: 11_000 },
    { metricKey: 'downloads', weight: 50, targetMonthly: 4_500 },
    { metricKey: 'retention_d7', weight: 60, targetMonthly: 20 },
    { metricKey: 'store_rating', weight: 40, targetMonthly: 4.7 },
  ];
  const actuals = { revenue: 62_400_000, dau: 10_450, downloads: 4_620, retention_d7: 18.6, store_rating: 4.7 };
  const r = scoreProject(baselines, actuals, 'month', thresholds);
  assert.deepEqual(r.items.map((i) => i.pct), [104.0, 95.0, 102.7, 93.0, 100.0]);
  assert.deepEqual(r.items.map((i) => i.status), ['green', 'green', 'green', 'green', 'green']);
  assert.equal(r.score, 99.1);
  assert.equal(r.status, 'green');
});

test('Mindfulness Bell month score = 71,6% Vàng', () => {
  const baselines = [
    { metricKey: 'revenue', weight: 100, targetMonthly: 40_000_000 },
    { metricKey: 'dau', weight: 80, targetMonthly: 7_500 },
    { metricKey: 'downloads', weight: 50, targetMonthly: 3_000 },
    { metricKey: 'retention_d7', weight: 60, targetMonthly: 17 },
    { metricKey: 'crash_rate_android', weight: 40, targetMonthly: 1.0 },
  ];
  const actuals = { revenue: 33_800_000, dau: 6_000, downloads: 1_400, retention_d7: 12, crash_rate_android: 1.8 };
  const r = scoreProject(baselines, actuals, 'month', thresholds);
  assert.deepEqual(r.items.map((i) => i.pct), [84.5, 80.0, 46.7, 70.6, 55.6]);
  assert.deepEqual(r.items.map((i) => i.status), ['green', 'yellow', 'red', 'yellow', 'yellow']);
  assert.equal(r.score, 71.6);
  assert.equal(r.status, 'yellow');
});

test('cumulative targets scale by period, rates do not', () => {
  const r = scoreProject([
    { metricKey: 'downloads', weight: 1, targetMonthly: 3000 },
    { metricKey: 'retention_d7', weight: 1, targetMonthly: 20 },
  ], { downloads: 700, retention_d7: 20 }, 'week');
  assert.equal(r.items[0].target, 700);
  assert.equal(r.items[0].pct, 100);
  assert.equal(r.items[1].target, 20);
});

test('achievement is capped at 120% and lower-is-better inverts', () => {
  assert.equal(achievement(500, 100), 120);
  assert.equal(achievement(0.5, 1.0, 'lower'), 120);
  assert.equal(achievement(2, 1, 'lower'), 50);
});

test('threshold boundaries', () => {
  assert.equal(statusFor(80.0, thresholds), 'yellow');
  assert.equal(statusFor(80.1, thresholds), 'green');
  assert.equal(statusFor(50.0, thresholds), 'yellow');
  assert.equal(statusFor(49.9, thresholds), 'red');
});

test('single baseline: revenue 84,5% → score 84,5% Tốt', () => {
  const r = scoreProject([{ metricKey: 'revenue', weight: 100, targetMonthly: 40_000_000 }], { revenue: 33_800_000 }, 'month', thresholds);
  assert.equal(r.score, 84.5);
  assert.equal(r.status, 'green');
  assert.equal(r.used, 1);
});

test('score uses only baselines with data and reports coverage 2/3', () => {
  const r = scoreProject([
    { metricKey: 'revenue', weight: 100, targetMonthly: 60_000_000 },
    { metricKey: 'dau', weight: 80, targetMonthly: 11_000 },
    { metricKey: 'retention_d7', weight: 60, targetMonthly: 20 },
  ], { revenue: 62_400_000, dau: 10_450 }, 'month', thresholds);
  assert.equal(r.score, 100.0);
  assert.equal(r.status, 'green');
  assert.deepEqual([r.used, r.total], [2, 3]);
});

test('no baseline has data → no score, no status', () => {
  const r = scoreProject([{ metricKey: 'dau', weight: 50, targetMonthly: 100 }], {}, 'month', thresholds);
  assert.equal(r.score, null);
  assert.equal(r.status, null);
});

test('contribution of Zen Bell revenue = 31,5 of 99,1 points', async () => {
  const { contributions } = await import('../shared/health-score.js');
  const baselines = [
    { metricKey: 'revenue', weight: 100, targetMonthly: 60_000_000 }, { metricKey: 'dau', weight: 80, targetMonthly: 11_000 },
    { metricKey: 'downloads', weight: 50, targetMonthly: 4_500 }, { metricKey: 'retention_d7', weight: 60, targetMonthly: 20 },
    { metricKey: 'store_rating', weight: 40, targetMonthly: 4.7 },
  ];
  const r = scoreProject(baselines, { revenue: 62_400_000, dau: 10_450, downloads: 4_620, retention_d7: 18.6, store_rating: 4.7 }, 'month', thresholds);
  const c = contributions(r.items);
  assert.equal(Math.round(c[0] * 10) / 10, 31.5);
  assert.equal(r.score, 99.1);
});
