// "Tham chiếu" for a monthly target: statistics of the closed months, target suggestions, difficulty label and a
// back-test of a target over the last 6 months. Pure functions shared by the server and the baseline editor.
// Month values: sum metrics = monthly total; avg / ratio metrics = monthly average; latest = last value of the month.

import { rawAchievement, statusFor } from './health-score.js';

/** Round a target like it is entered: money to 1.000 ₫, counts to units, rates and the rest to 1 decimal. */
export function roundTarget(value, unit) {
  if (!Number.isFinite(value)) return null;
  if (unit === 'vnd') return Math.round(value / 1000) * 1000;
  if (unit === 'count') return Math.round(value);
  return Math.round(value * 10) / 10;
}

/**
 * @param {{month:string, value:number|null}[]} months  closed months, oldest first (up to 13)
 * @returns stats of the latest 6 months with data (+ same month last year when 13 months are available)
 */
export function referenceStats(months) {
  const withData = months.filter((m) => m.value != null);
  const six = withData.slice(-6);
  if (!six.length) return { count: 0, months: [] };
  const vals = six.map((m) => m.value);
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const last = vals[vals.length - 1];
  const first = vals[0];
  // Compound monthly growth over the available months: (last ÷ first)^(1/(n−1)) − 1.
  const growth = vals.length >= 2 && first > 0 && last > 0 ? (last / first) ** (1 / (vals.length - 1)) - 1 : null;
  const lastMonth = six[six.length - 1].month;
  const [y, m] = lastMonth.split('-');
  const yoyMonth = `${Number(y) - 1}-${m}`;
  const yoy = withData.length >= 13 ? withData.find((x) => x.month === yoyMonth)?.value ?? null : null;
  return {
    count: six.length, months: six, last, lastMonth,
    avg3: avg(vals.slice(-3)), avg6: avg(vals), min6: Math.min(...vals), max6: Math.max(...vals), growth,
    yoy, yoyMonth: yoy != null ? yoyMonth : null, fewData: six.length < 3,
  };
}

/** Suggested targets: "Giữ mức hiện tại", "Tăng / Giảm X%", "Theo xu hướng", "Hòa vốn" (revenue only). */
export function suggestions(stats, { unit, direction = 'higher', pct = 10, breakEven = null } = {}) {
  const out = [];
  if (stats.count) {
    const lower = direction === 'lower';
    out.push({ key: 'keep', label: 'Giữ mức hiện tại', value: roundTarget(stats.avg3, unit) });
    out.push({ key: 'change', label: `${lower ? 'Giảm' : 'Tăng'} ${pct}%`, value: roundTarget(stats.avg3 * (1 + (lower ? -pct : pct) / 100), unit), editable: true });
    if (stats.growth != null) out.push({ key: 'trend', label: 'Theo xu hướng', value: roundTarget(stats.last * (1 + stats.growth), unit) });
  }
  if (breakEven != null) out.push({ key: 'breakeven', label: 'Hòa vốn', value: roundTarget(breakEven, unit) });
  return out.filter((s) => s.value != null && s.value > 0);
}

/** Difficulty of `target` vs the 3-month average (reversed for "thấp là tốt"). */
export function difficulty(target, stats, direction = 'higher') {
  if (!(target > 0) || !stats.count || !(stats.avg3 > 0)) return null;
  const ratio = direction === 'lower' ? (stats.avg3 / target) * 100 : (target / stats.avg3) * 100;
  const level = ratio < 90 ? { key: 'easy', label: 'Dễ' } : ratio <= 110 ? { key: 'fair', label: 'Vừa sức' }
    : ratio <= 130 ? { key: 'hard', label: 'Thách thức' } : { key: 'very_hard', label: 'Rất khó' };
  return { ...level, ratio: Math.round(ratio * 10) / 10 };
}

/** "Nếu áp mục tiêu này cho 6 tháng qua": months reaching 100% and months at "Tốt". */
export function backtest(target, stats, direction = 'higher', thresholds = { green: 80, red: 50 }) {
  if (!(target > 0) || !stats.count) return null;
  const pcts = stats.months.map((m) => rawAchievement(m.value, target, direction));
  return {
    total: pcts.length,
    reached: pcts.filter((p) => p != null && p >= 100 - 1e-9).length,
    good: pcts.filter((p) => statusFor(p == null ? null : Math.round(p * 10) / 10, thresholds) === 'green').length,
  };
}
