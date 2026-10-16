// Period filter definitions and date-range helpers (dates are local "YYYY-MM-DD").

/**
 * targetFactor: monthly target multiplier (calendar days / 30).
 * costDays: working days the period consumes; cost factor = costDays / workingDaysPerMonth,
 * except month-multiples which use `costMonths` directly.
 */
export const PERIODS = [
  { key: 'day', label: '1 ngày', days: 1, targetFactor: 1 / 30, costDays: 1 },
  { key: '3days', label: '3 ngày', days: 3, targetFactor: 3 / 30, costDays: 3 },
  { key: 'week', label: 'Tuần', days: 7, targetFactor: 7 / 30, costDays: 5 },
  { key: 'month', label: 'Tháng', days: 30, targetFactor: 1, costMonths: 1 },
  { key: 'quarter', label: 'Quý', days: 90, targetFactor: 3, costMonths: 3 },
  { key: 'year', label: 'Năm', days: 365, targetFactor: 12, costMonths: 12 },
];

export const DEFAULT_PERIOD = 'month';

export function getPeriod(key) {
  return PERIODS.find((p) => p.key === key) || PERIODS.find((p) => p.key === DEFAULT_PERIOD);
}

/** Period cost = monthly cost × this factor. Week = 5/21 with 21 working days. */
export function costFactor(periodKey, workingDaysPerMonth = 21) {
  const p = getPeriod(periodKey);
  if (p.costMonths) return p.costMonths;
  return p.costDays / workingDaysPerMonth;
}

export function targetFactor(periodKey) {
  return getPeriod(periodKey).targetFactor;
}

export function toIsoDate(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function parseIsoDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso, n) {
  const d = parseIsoDate(iso);
  d.setDate(d.getDate() + n);
  return toIsoDate(d);
}

export function daysBetween(fromIso, toIso) {
  return Math.round((parseIsoDate(toIso) - parseIsoDate(fromIso)) / 86400000);
}

export function yesterdayIso(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - 1);
  return toIsoDate(d);
}

/** Current period ends at `endDate`; previous period is the same length right before it. */
export function periodRange(periodKey, endDate) {
  const { days } = getPeriod(periodKey);
  const from = addDays(endDate, -(days - 1));
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  return { from, to: endDate, prevFrom, prevTo, days };
}

/** List of ISO dates from..to inclusive. */
export function dateList(fromIso, toIso) {
  const out = [];
  for (let d = fromIso; d <= toIso; d = addDays(d, 1)) out.push(d);
  return out;
}

export function isWorkingDay(iso) {
  const dow = parseIsoDate(iso).getDay();
  return dow !== 0 && dow !== 6;
}
