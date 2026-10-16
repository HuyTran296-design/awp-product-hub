// Stop-loss ("Phương án cắt lỗ") evaluation — pure, shared by server, browser and tests.
// Only closed months are evaluated (see shared/closing.js). The system never stops a project by itself:
// reaching the threshold only creates a proposal that an Admin decides on.

import { addMonths, monthEnd } from './closing.js';
import { formatDate, formatNumber, formatPct, formatVnd } from './format.js';
import { addDays, daysBetween } from './periods.js';
import { getMetricDef } from './metric-catalog.js';

export const DEFAULT_POLICY = {
  enabled: true,
  startDate: null, // null = date the project starts carrying cost
  warnPct: 70,
  cumulativeLoss: { on: true, amount: 60_000_000 },
  consecutiveLoss: { on: true, months: 6 },
  lowHealth: { on: true, below: 50, months: 2 },
  milestones: [],
  budgetOverrun: { on: false, pct: 100 }, // Chi phí lũy kế vượt X% ngân sách giai đoạn Xây dựng
  lateLaunch: { on: false, days: 30 },    // Chưa ra mắt khi qua ngày ra mắt dự kiến + N ngày
  triggerCount: 1,
  action: { type: 'review', effortPct: 50 },
};

export const ACTION_LABELS = {
  pause: 'Tạm dừng', archive: 'Lưu trữ', reduce_effort: 'Giảm effort', review: 'Đánh giá lại',
};
export const MILESTONE_KINDS = {
  revenue_ratio: 'Doanh thu tháng ≥ Z% chi phí tháng',
  breakeven: 'Hòa vốn (lãi/lỗ tháng ≥ 0)',
  health: 'Điểm sức khỏe ≥ Y%',
  baseline: 'Một baseline ≥ giá trị',
};
export const STATUS_LABELS = {
  off: 'Không theo dõi', safe: 'An toàn', warning: 'Cảnh báo cắt lỗ', triggered: 'Chạm ngưỡng cắt lỗ', handled: 'Đã xử lý',
};
export const STATUS_RANK = { triggered: 0, warning: 1, handled: 2, safe: 3, off: 4 };
export const WARN_DAYS_BEFORE_MILESTONE = 30;

export function actionLabel(action) {
  return action.type === 'reduce_effort' ? `Giảm effort xuống ${formatNumber(action.effortPct)}%` : ACTION_LABELS[action.type];
}

/** "Doanh thu tháng ≥ 80% chi phí tháng" for a milestone. */
export function milestoneTarget(ms) {
  switch (ms.kind) {
    case 'revenue_ratio': return `Doanh thu tháng ≥ ${formatNumber(ms.value)}% chi phí tháng`;
    case 'breakeven': return 'Hòa vốn (lãi/lỗ tháng ≥ 0)';
    case 'health': return `Điểm sức khỏe ≥ ${formatNumber(ms.value)}%`;
    case 'baseline': {
      const def = getMetricDef(ms.metricKey);
      return `${def?.short ?? ms.metricKey} ≥ ${formatNumber(ms.value, Number.isInteger(ms.value) ? 0 : 2)}`;
    }
    default: return '—';
  }
}

/** Whether month `m` meets a milestone target, plus the actual value text. */
function milestoneCheck(ms, m) {
  switch (ms.kind) {
    case 'revenue_ratio': {
      const ratio = m.cost > 0 ? (m.revenue / m.cost) * 100 : null;
      return { ok: ratio != null && ratio >= ms.value, text: `doanh thu ${formatVnd(m.revenue)} / chi phí ${formatVnd(m.cost)} = ${formatPct(ratio)}` };
    }
    case 'breakeven': return { ok: m.profit >= 0, text: `lãi/lỗ tháng ${formatVnd(m.profit)}` };
    case 'health': return { ok: m.score != null && m.score >= ms.value, text: `điểm sức khỏe ${formatPct(m.score)}` };
    case 'baseline': {
      const v = m.actuals?.[ms.metricKey];
      return { ok: v != null && v >= ms.value, text: `${getMetricDef(ms.metricKey)?.short ?? ms.metricKey} ${formatNumber(v, Number.isInteger(ms.value) ? 0 : 2)}` };
    }
    default: return { ok: false, text: '—' };
  }
}

/** Trailing run length of months satisfying `pred`, from the latest month backwards. */
function trailing(months, pred) {
  let n = 0;
  for (let i = months.length - 1; i >= 0 && pred(months[i]); i--) n++;
  return n;
}

/** "đầu 01/2027" — rough position within a month. */
function aboutMonth(iso) {
  const d = Number(iso.slice(8, 10));
  return `${d <= 10 ? 'đầu' : d <= 20 ? 'giữa' : 'cuối'} ${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/**
 * @param {object} policy
 * @param {{month:string, revenue:number, cost:number, profit:number, score:number|null, actuals?:object}[]} months
 *   closed, complete months from the tracking start, ascending
 * @param {{today:string, lastClosed:string, budget?:object}} clock  budget: build-phase info (inBuild, budget, spend, launchDate)
 */
export function evaluateStopLoss(policy, months, { today, lastClosed, budget = null }) {
  const p = { ...DEFAULT_POLICY, ...policy };
  p.budgetOverrun = { ...DEFAULT_POLICY.budgetOverrun, ...policy.budgetOverrun };
  p.lateLaunch = { ...DEFAULT_POLICY.lateLaunch, ...policy.lateLaunch };
  if (!p.enabled) return { enabled: false, status: 'off', conditions: [], metKeys: [], months };

  const cumulative = months.reduce((s, m) => s + m.profit, 0);
  const cumLoss = cumulative < 0 ? -cumulative : 0;
  const threshold = p.cumulativeLoss.amount;
  const usedPct = threshold > 0 ? (cumLoss / threshold) * 100 : null;
  const last3 = months.slice(-3);
  const avg3Loss = last3.length ? last3.reduce((s, m) => s + Math.max(0, -m.profit), 0) / last3.length : 0;
  const lastMonthEnd = months.length ? monthEnd(months[months.length - 1].month) : monthEnd(lastClosed);

  let remaining;
  if (threshold > 0 && cumLoss >= threshold) remaining = { months: 0, text: 'Đã chạm ngưỡng lỗ lũy kế' };
  else if (!(avg3Loss > 0) || !(threshold > 0)) remaining = { months: null, text: 'Không có xu hướng chạm ngưỡng' };
  else {
    const n = (threshold - cumLoss) / avg3Loss;
    const date = addDays(lastMonthEnd, Math.round(n * 30.44));
    remaining = { months: n, date, text: `≈ ${formatNumber(n, 1)} tháng · dự kiến chạm ngưỡng khoảng ${aboutMonth(date)}` };
  }

  const conditions = [];
  // 1. Cumulative loss
  conditions.push({
    key: 'cumulative_loss', enabled: p.cumulativeLoss.on,
    label: `Lỗ lũy kế vượt ${formatVnd(threshold)}`,
    met: p.cumulativeLoss.on && cumLoss > threshold,
    warning: p.cumulativeLoss.on && usedPct != null && usedPct >= p.warnPct,
    actual: cumLoss, threshold,
    detail: `Lỗ lũy kế ${formatVnd(cumLoss)} / ${formatVnd(threshold)} (${formatPct(usedPct)})`,
  });
  // 2. Consecutive losing months
  const lossRun = trailing(months, (m) => m.profit < 0);
  const nLoss = p.consecutiveLoss.months;
  conditions.push({
    key: 'consecutive_loss', enabled: p.consecutiveLoss.on,
    label: `Lỗ liên tiếp ${nLoss} tháng`,
    met: p.consecutiveLoss.on && lossRun >= nLoss,
    warning: p.consecutiveLoss.on && lossRun === nLoss - 1,
    actual: lossRun, threshold: nLoss,
    detail: `Lỗ liên tiếp: ${Math.min(lossRun, nLoss)}/${nLoss} tháng`,
  });
  // 3. Low health score for N months
  const below = p.lowHealth.below;
  const nLow = p.lowHealth.months;
  const lowRun = trailing(months, (m) => m.score != null && m.score < below);
  const latestScore = months.length ? months[months.length - 1].score : null;
  conditions.push({
    key: 'low_health', enabled: p.lowHealth.on,
    label: `Điểm sức khỏe < ${formatNumber(below)}% trong ${nLow} tháng liên tiếp`,
    met: p.lowHealth.on && lowRun >= nLow,
    warning: p.lowHealth.on && lowRun === nLow - 1,
    actual: lowRun, threshold: nLow, latestScore,
    detail: `Điểm sức khỏe < ${formatNumber(below)}%: ${Math.min(lowRun, nLow)}/${nLow} tháng (tháng gần nhất ${formatPct(latestScore)})`,
  });
  // 4. Milestones: evaluated on the milestone's month once it is closed; before that, on the latest closed month.
  const latest = months[months.length - 1];
  for (const ms of p.milestones) {
    const msMonth = ms.date.slice(0, 7);
    const closed = msMonth <= lastClosed;
    const evalMonth = closed ? months.find((m) => m.month === msMonth) : latest;
    const check = evalMonth ? milestoneCheck(ms, evalMonth) : { ok: null, text: 'chưa có tháng đã chốt' };
    const daysLeft = daysBetween(today, ms.date);
    const on = ms.on !== false;
    conditions.push({
      key: `milestone:${ms.id}`, enabled: on, milestone: true, date: ms.date, daysLeft, closed,
      label: `Mốc ${formatDate(ms.date)}: ${milestoneTarget(ms)}`,
      met: on && closed && check.ok === false,
      warning: on && !closed && check.ok === false && daysLeft <= WARN_DAYS_BEFORE_MILESTONE,
      achieving: check.ok,
      detail: closed
        ? `Tháng ${msMonth.slice(5)}/${msMonth.slice(0, 4)}: ${check.text} → ${check.ok ? 'đạt' : 'KHÔNG đạt'}`
        : `${daysLeft >= 0 ? `Còn ${daysLeft} ngày` : `Chờ chốt sổ tháng ${msMonth.slice(5)}/${msMonth.slice(0, 4)}`} · hiện ${check.text} → ${check.ok == null ? '—' : check.ok ? 'đang đạt' : 'đang không đạt'}`,
    });
  }

  // 5. Build-phase spend vs budget (early warning at the same warnPct as the other conditions).
  const limit = budget?.budget ? budget.budget * (p.budgetOverrun.pct / 100) : null;
  const spendPct = limit ? (budget.spend / limit) * 100 : null;
  conditions.push({
    key: 'budget_overrun', enabled: p.budgetOverrun.on,
    label: `Chi phí lũy kế vượt ${formatNumber(p.budgetOverrun.pct)}% ngân sách giai đoạn`,
    met: p.budgetOverrun.on && limit != null && budget.spend > limit,
    warning: p.budgetOverrun.on && spendPct != null && spendPct >= p.warnPct,
    actual: budget?.spend ?? null, threshold: limit,
    detail: limit == null ? 'Chưa có ngân sách giai đoạn Xây dựng'
      : `Chi phí lũy kế ${formatVnd(budget.spend)} / ${formatVnd(limit)} (${formatPct(spendPct)} ngưỡng)`,
  });
  // 6. Still building after the planned launch date + N days.
  const deadline = budget?.launchDate ? addDays(budget.launchDate, p.lateLaunch.days) : null;
  const building = Boolean(budget?.inBuild);
  const daysToDeadline = deadline ? daysBetween(today, deadline) : null;
  conditions.push({
    key: 'late_launch', enabled: p.lateLaunch.on,
    label: `Chưa ra mắt khi qua ngày ra mắt dự kiến + ${p.lateLaunch.days} ngày`,
    met: p.lateLaunch.on && building && deadline != null && today > deadline,
    warning: p.lateLaunch.on && building && deadline != null && daysToDeadline <= WARN_DAYS_BEFORE_MILESTONE,
    detail: !deadline ? 'Chưa có ngày ra mắt dự kiến'
      : !building ? `Đã qua giai đoạn Xây dựng (ra mắt dự kiến ${formatDate(budget.launchDate)})`
      : `Ra mắt dự kiến ${formatDate(budget.launchDate)} · hạn ${formatDate(deadline)} (${daysToDeadline >= 0 ? `còn ${daysToDeadline} ngày` : `quá ${-daysToDeadline} ngày`})`,
  });

  const enabledCount = conditions.filter((c) => c.enabled).length;
  const need = Math.max(1, Math.min(p.triggerCount, enabledCount || 1));
  const metKeys = conditions.filter((c) => c.met).map((c) => c.key);
  const status = metKeys.length >= need && enabledCount ? 'triggered' : conditions.some((c) => c.warning || c.met) ? 'warning' : 'safe';
  const upcoming = conditions.filter((c) => c.milestone && c.enabled && !c.closed).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;

  return {
    enabled: true, status, need, metKeys, conditions, months,
    cumulative, cumLoss, threshold, usedPct, warnPct: p.warnPct, avg3Loss, remaining, nextMilestone: upcoming,
    evaluatedThrough: months.length ? months[months.length - 1].month : null,
  };
}

/** Months to track: from the start month (inclusive) through the last closed month. */
export function trackedMonths(startDate, lastClosed) {
  const out = [];
  if (!startDate) return out;
  for (let m = startDate.slice(0, 7); m <= lastClosed; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** "≈ X tháng chi phí của dự án" helper for the cumulative-loss input. */
export function monthsOfCost(amount, monthlyCost) {
  return monthlyCost > 0 ? amount / monthlyCost : null;
}
