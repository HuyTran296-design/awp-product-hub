// Chi phí Tools/AI per calendar month. A tool is
//   { id, name, kind, currency, amount, prices:[{ fromMonth, amount }], startMonth, endMonth, spreadMonths, appliesTo }
//   kind monthly  "Hằng tháng":    amount/month; "Đổi giá từ tháng…" adds prices entries (earlier months keep the old price)
//   kind usage    "Theo mức dùng": estimated amount/month (prices like monthly); the actual is entered every month
//   kind annual   "Hằng năm":      amount/year from startMonth → amount ÷ 12 each month, renewed until endMonth
//   kind one_time "Một lần":       amount in startMonth, spread evenly over spreadMonths months
// Months are "YYYY-MM"; startMonth null = since the beginning, endMonth null = still in use.
// actuals: { "toolId|YYYY-MM": { amount, currency } } — the invoice amount entered by an Admin ("Thực tế").

import { USD_VND_RATE } from './system-config.js';
import { addMonths, CLOSE_DAY } from './closing.js';
import { formatNumber, formatVnd } from './format.js';

export const TOOL_KINDS = { monthly: 'Hằng tháng', usage: 'Theo mức dùng', annual: 'Hằng năm', one_time: 'Một lần' };
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

/** Monthly / usage tools change price with "Đổi giá từ tháng…". */
export const hasPriceVersions = (kind) => kind === 'monthly' || kind === 'usage';

/** Last month the tool costs anything (null = open-ended). */
export function lastMonth(tool) {
  if (tool.kind === 'one_time') return addMonths(tool.startMonth, Math.max(1, tool.spreadMonths || 1) - 1);
  return tool.endMonth ?? null;
}

export function isActiveIn(tool, month) {
  if (tool.startMonth && month < tool.startMonth) return false;
  const last = lastMonth(tool);
  return !last || month <= last;
}

/** Price (tool currency) of a monthly / usage tool in `month`: the latest price version from that month or before. */
export function priceAt(tool, month) {
  let price = tool.amount;
  let from = '';
  for (const p of tool.prices ?? []) if (p.fromMonth <= month && p.fromMonth >= from) { price = p.amount; from = p.fromMonth; }
  return price;
}

/** Planned amount in the tool currency for `month` (0 when the tool is not in use). */
export function plannedAmount(tool, month) {
  if (!isActiveIn(tool, month)) return 0;
  if (tool.kind === 'annual') return tool.amount / 12;
  if (tool.kind === 'one_time') return tool.amount / Math.max(1, tool.spreadMonths || 1);
  return priceAt(tool, month);
}

/**
 * One cell of the monthly table / one tool of a month's cost:
 * { active, planned (VND), actual (VND | null), actualAmount (tool currency | null), value (VND: actual else planned) }.
 */
export function toolMonth(tool, month, actuals = {}) {
  const active = isActiveIn(tool, month);
  const a = active ? actuals[actualKey(tool.id, month)] : null;
  const planned = toVnd(plannedAmount(tool, month), tool.currency);
  const actual = a ? toVnd(a.amount, a.currency) : null;
  return { active, planned, actual, actualAmount: a ? a.amount : null, value: actual ?? planned };
}

/** Tools in use in `month` with their VND cost of that month, as computeCosts() expects them. */
export function toolsForMonth(tools, actuals, month) {
  return (tools ?? []).filter((t) => isActiveIn(t, month)).map((t) => {
    const c = toolMonth(t, month, actuals);
    return { id: t.id, name: t.name, monthlyCost: c.value, appliesTo: t.appliesTo ?? [], actual: c.actual != null };
  });
}

/** The actual of `month` is due from day CLOSE_DAY + 1 of the following month. */
export function actualDue(month, today) {
  return today >= `${addMonths(month, 1)}-${String(CLOSE_DAY + 1).padStart(2, '0')}`;
}

/**
 * "Theo mức dùng" months still on the estimate although the invoice is due ("Ước tính" + orange dot).
 * Checked from the tool's first entered actual (else its Từ tháng, else `windowStart`) up to the last due month.
 */
export function missingActuals(tools, actuals, today, windowStart) {
  const out = [];
  for (const t of tools ?? []) {
    if (t.kind !== 'usage') continue;
    const entered = Object.keys(actuals ?? {}).filter((k) => k.startsWith(`${t.id}|`)).map((k) => k.slice(t.id.length + 1)).sort();
    let m = entered[0] ?? (t.startMonth && t.startMonth > windowStart ? t.startMonth : windowStart);
    for (; actualDue(m, today); m = addMonths(m, 1)) {
      if (isActiveIn(t, m) && !actuals[actualKey(t.id, m)]) out.push({ toolId: t.id, name: t.name, month: m });
    }
  }
  return out;
}
