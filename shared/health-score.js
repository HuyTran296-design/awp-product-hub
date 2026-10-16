// Baseline achievement and project health score.

import { round } from './format.js';
import { getMetricDef, scalesWithPeriod } from './metric-catalog.js';
import { targetFactor } from './periods.js';

export const ACHIEVEMENT_CAP = 120;
export const DEFAULT_THRESHOLDS = { green: 80, red: 50 };

// Status codes keep their color names; labels describe the meaning.
export const STATUS_LABELS = { green: 'Tốt', yellow: 'Cần chú ý', red: 'Báo động' };

/** Period target: cumulative metrics scale with the period, others keep the monthly target. */
export function periodTarget(metricKey, monthlyTarget, periodKey) {
  return scalesWithPeriod(metricKey) ? monthlyTarget * targetFactor(periodKey) : monthlyTarget;
}

/**
 * % achieved, capped at 120, unrounded (used for the weighted score).
 * higher-is-better: actual / target; lower-is-better: target / actual.
 */
export function rawAchievement(actual, target, direction = 'higher') {
  if (actual == null || target == null) return null;
  let pct;
  if (direction === 'lower') {
    pct = actual <= 0 ? ACHIEVEMENT_CAP : (target / actual) * 100;
  } else {
    if (target <= 0) return ACHIEVEMENT_CAP;
    pct = (actual / target) * 100;
  }
  return Math.min(Math.max(pct, 0), ACHIEVEMENT_CAP);
}

/** % achieved rounded to 1 decimal — rounding happens before threshold checks. */
export function achievement(actual, target, direction = 'higher') {
  const pct = rawAchievement(actual, target, direction);
  return pct == null ? null : round(pct, 1);
}

/** Tốt (green) > green · Cần chú ý (yellow) from red to green inclusive · Báo động (red) < red. */
export function statusFor(pct, thresholds = DEFAULT_THRESHOLDS) {
  if (pct == null) return null;
  if (pct > thresholds.green) return 'green';
  if (pct < thresholds.red) return 'red';
  return 'yellow';
}

/**
 * Weighted health score: Σ(weight × %) ÷ Σ weight from unrounded %, then rounded to 1 decimal.
 * Only baselines that have data count; returns null when none has data ("Đang thu thập dữ liệu").
 * items: [{ weight, rawPct }] (falls back to pct when rawPct is absent).
 */
export function healthScore(items) {
  const valid = items.filter((i) => (i.rawPct ?? i.pct) != null && i.weight > 0);
  const totalWeight = valid.reduce((s, i) => s + i.weight, 0);
  if (!totalWeight) return null;
  return round(valid.reduce((s, i) => s + i.weight * (i.rawPct ?? i.pct), 0) / totalWeight, 1);
}

/**
 * Score a project for one period.
 * baselines: [{ metricKey, weight, targetMonthly }], actuals: { metricKey: value }
 */
export function scoreProject(baselines, actuals, periodKey, thresholds = DEFAULT_THRESHOLDS, { periodKeys = {}, targets = {} } = {}) {
  // periodKeys: per-baseline period (manual baselines use their own day/week/month period);
  // targets: per-baseline target overrides (e.g. budget planned to date for "Chi phí lũy kế").
  const items = baselines.map((b) => {
    const def = getMetricDef(b.metricKey);
    const target = targets[b.metricKey] ?? periodTarget(b.metricKey, b.targetMonthly, periodKeys[b.metricKey] ?? periodKey);
    const actual = actuals[b.metricKey];
    const rawPct = rawAchievement(actual, target, def?.direction);
    const pct = rawPct == null ? null : round(rawPct, 1);
    return { ...b, target, actual, rawPct, pct, status: statusFor(pct, thresholds) };
  });
  const score = healthScore(items);
  // Coverage: "Tính trên 2/3 baseline" when only part of the baselines has data.
  const used = items.filter((i) => i.pct != null && i.weight > 0).length;
  return { items, score, status: statusFor(score, thresholds), used, total: items.length };
}

/**
 * Points each baseline adds to the health score: weight × % achieved ÷ Σ weight (baselines with data).
 * Contributions sum to the score. Returns null for baselines without data.
 */
export function contributions(items) {
  const scored = items.filter((i) => i.pct != null && i.weight > 0);
  const total = scored.reduce((s, i) => s + i.weight, 0);
  return items.map((i) => (i.pct != null && i.weight > 0 && total ? (i.weight * i.pct) / total : null));
}
