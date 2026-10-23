// Chi phí Tools/AI per calendar month. A tool is
//   { id, name, versions:[{ fromMonth, kind, currency, amount, appliesTo }], removedFrom }
// A change of Kiểu chi phí / Số tiền / Tiền tệ / Áp dụng cho is a version from the month it was made in (earlier months
// keep the previous one); a new tool starts in the month it is added; "Xóa" stops it from that month (removedFrom).
//   kind monthly  "Hằng tháng":    amount every month
//   kind usage    "Theo mức dùng": estimated amount every month; the actual is entered in "Theo tháng"
//   kind annual   "Hằng năm":      amount ÷ 12 every month
//   kind one_time "Một lần":       amount in the month of its version only (moved to another month via actuals)
// Months are "YYYY-MM"; fromMonth null = since the beginning.
// actuals: { "toolId|YYYY-MM": { amount, currency } } — the invoice amount entered by an Admin ("Thực tế").

import { USD_VND_RATE } from './system-config.js';
import { addMonths, CLOSE_DAY } from './closing.js';
import { formatNumber, formatVnd } from './format.js';

export const TOOL_KINDS = { monthly: 'Hằng tháng', usage: 'Theo mức dùng', annual: 'Hằng năm', one_time: 'Một lần' };
/** Suffix of the Số tiền field per kind. */
export const AMOUNT_SUFFIX = { monthly: '/tháng', usage: '/tháng', annual: '/năm', one_time: 'một lần' };
export const CURRENCIES = ['VND', 'USD'];

export const toVnd = (amount, currency) => (currency === 'USD' ? amount * USD_VND_RATE : amount);
export const actualKey = (toolId, month) => `${toolId}|${month}`;

/** "6.000.000 ₫" · "45 USD" · "12,5 USD". */
export function formatMoney(amount, currency) {
  if (currency !== 'USD') return formatVnd(amount);
  return `${formatNumber(amount, Number.isInteger(Math.round(amount * 100) / 100) ? 0 : 2)} USD`;
}

/** "10/2026" */
export const monthLabel = (ym) => `${Number(ym.slice(5, 7))}/${ym.slice(0, 4)}`;

/** Configuration in force in `month` (null before the tool starts). */
export function versionAt(tool, month) {
  let best = null;
  for (const v of tool.versions ?? []) if ((v.fromMonth ?? '') <= month) best = v;
  return best;
}

/** The latest configuration (what the Cấu hình list shows and edits). */
export const latestVersion = (tool) => tool.versions[tool.versions.length - 1];

/** The tool exists in `month`: started and not stopped ("Xóa") yet. */
export function isActiveIn(tool, month) {
  return Boolean(versionAt(tool, month)) && !(tool.removedFrom && month >= tool.removedFrom);
}

/** Planned amount in the version currency for `month` (0 when the tool does not exist then). */
export function plannedAmount(tool, month) {
  if (!isActiveIn(tool, month)) return 0;
  const v = versionAt(tool, month);
  if (v.kind === 'annual') return v.amount / 12;
  if (v.kind === 'one_time') return v.fromMonth === month ? v.amount : 0;
  return v.amount;
}

/**
 * One cell of the monthly table / one tool of a month's cost:
 * { active, planned (VND), actual (VND | null), actualAmount (entered currency | null), value (VND: actual else planned) }.
 */
export function toolMonth(tool, month, actuals = {}) {
  const active = isActiveIn(tool, month);
  const a = active ? actuals[actualKey(tool.id, month)] : null;
  const planned = active ? toVnd(plannedAmount(tool, month), versionAt(tool, month).currency) : 0;
  const actual = a ? toVnd(a.amount, a.currency) : null;
  return { active, planned, actual, actualAmount: a ? a.amount : null, value: actual ?? planned };
}

/** Tools in use in `month` with their VND cost and "Áp dụng cho" of that month, as computeCosts() expects them. */
export function toolsForMonth(tools, actuals, month) {
  return (tools ?? []).filter((t) => isActiveIn(t, month)).map((t) => {
    const c = toolMonth(t, month, actuals);
    return { id: t.id, name: t.name, monthlyCost: c.value, appliesTo: versionAt(t, month).appliesTo ?? [], actual: c.actual != null };
  });
}

/** The actual of `month` is due from day CLOSE_DAY + 1 of the following month. */
export function actualDue(month, today) {
  return today >= `${addMonths(month, 1)}-${String(CLOSE_DAY + 1).padStart(2, '0')}`;
}

/**
 * "Theo mức dùng" months still on the estimate although the invoice is due ("Ước tính" + orange dot).
 * Checked from the tool's first entered actual (else its first month, else `windowStart`) up to the last due month.
 */
export function missingActuals(tools, actuals, today, windowStart) {
  const out = [];
  for (const t of tools ?? []) {
    const entered = Object.keys(actuals ?? {}).filter((k) => k.startsWith(`${t.id}|`)).map((k) => k.slice(t.id.length + 1)).sort();
    const first = t.versions[0]?.fromMonth;
    let m = entered[0] ?? (first && first > windowStart ? first : windowStart);
    for (; actualDue(m, today); m = addMonths(m, 1)) {
      if (isActiveIn(t, m) && versionAt(t, m).kind === 'usage' && !actuals[actualKey(t.id, m)]) out.push({ toolId: t.id, name: t.name, month: m });
    }
  }
  return out;
}
