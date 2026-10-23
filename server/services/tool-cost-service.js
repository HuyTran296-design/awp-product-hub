// Chi phí Tools/AI: the tool list (Cấu hình), price versions ("Đổi giá từ tháng…") and actuals per month (Theo tháng).
// The list is not effective-dated: each tool carries its own months (Từ/Đến tháng, Hằng năm, Một lần) and prices.
// A tool with cost in a closed month cannot be removed — "Đến tháng" stops it and keeps the old months.
// Editing an actual of a past month corrects data: that month's cost, P&L and stop-loss are recomputed from it.

import { addMonths } from '../../shared/closing.js';
import { formatVnd } from '../../shared/format.js';
import {
  CURRENCIES, formatMoney, hasPriceVersions, missingActuals, monthLabel, priceAt, TOOL_KINDS, toolMonth,
} from '../../shared/tool-costs.js';
import { listProjects, listTools, loadToolActuals, normalizeTool, saveTool, tx } from '../database.js';
import { logChange } from './audit-log.js';
import { httpError } from './connection-service.js';

const ACTION = 'Chi phí Tools/AI';
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Months shown in "Theo tháng": the 6 previous months, the current month and the next one. */
export function tableMonths(today) {
  const cur = today.slice(0, 7);
  return Array.from({ length: 8 }, (_, i) => addMonths(cur, i - 6));
}

/** True when the tool has cost in a month before `openMonth` (closed): it can only be stopped, not removed. */
export const hasClosedCost = (tool, openMonth) => !tool.startMonth || tool.startMonth < openMonth;

function appliesToLabel(db, ids) {
  if (!ids?.length) return 'Tất cả dự án';
  const names = new Map(listProjects(db).map((p) => [p.id, p.name]));
  return ids.map((id) => names.get(id) ?? 'Đã xóa').join(', ');
}

/** One-line description of a tool's configuration for the change history. */
export function toolLabel(db, t, month) {
  const money = (v) => formatMoney(v, t.currency);
  const cost = {
    monthly: `${money(priceAt(t, month))}/tháng`,
    usage: `ước tính ${money(priceAt(t, month))}/tháng`,
    annual: `${money(t.amount)}/năm`,
    one_time: `${money(t.amount)}, chia đều ${t.spreadMonths} tháng`,
  }[t.kind];
  const range = [t.startMonth ? `từ ${monthLabel(t.startMonth)}` : '', t.endMonth ? `đến ${monthLabel(t.endMonth)}` : ''].filter(Boolean).join(' ');
  return [TOOL_KINDS[t.kind], cost, range, appliesToLabel(db, t.appliesTo)].filter(Boolean).join(' · ');
}

/** Tools/AI list from the form; existing monthly / usage tools keep their price versions (changed via changePrice). */
export function parseTools(db, list, stored) {
  if (!Array.isArray(list)) throw httpError(422, 'Danh sách Tools/AI không hợp lệ.');
  const live = new Set(listProjects(db).map((p) => p.id));
  const byId = new Map(stored.map((t) => [t.id, t]));
  const seen = new Set();
  return list.map((t, i) => {
    const name = String(t.name ?? '').trim();
    const label = name || `Tool dòng ${i + 1}`;
    if (!name) throw httpError(422, `Tool dòng ${i + 1}: vui lòng nhập tên.`);
    const kind = t.kind ?? 'monthly';
    if (!TOOL_KINDS[kind]) throw httpError(422, `${label}: kiểu chi phí không hợp lệ.`);
    const currency = t.currency ?? 'VND';
    if (!CURRENCIES.includes(currency)) throw httpError(422, `${label}: tiền tệ phải là VND hoặc USD.`);
    const amount = Number(t.amount);
    if (!(Number.isFinite(amount) && amount >= 0)) throw httpError(422, `${label}: số tiền phải ≥ 0.`);
    const startMonth = t.startMonth || null;
    const endMonth = kind === 'one_time' ? null : (t.endMonth || null);
    for (const m of [startMonth, endMonth]) if (m && !MONTH.test(m)) throw httpError(422, `${label}: tháng không hợp lệ.`);
    if ((kind === 'annual' || kind === 'one_time') && !startMonth) {
      throw httpError(422, `${label}: vui lòng chọn ${kind === 'annual' ? 'tháng bắt đầu' : 'tháng phát sinh'}.`);
    }
    if (startMonth && endMonth && endMonth < startMonth) throw httpError(422, `${label}: "Đến tháng" phải từ "Từ tháng" trở đi.`);
    const spreadMonths = kind === 'one_time' ? Number(t.spreadMonths ?? 1) : null;
    if (kind === 'one_time' && !(Number.isInteger(spreadMonths) && spreadMonths >= 1 && spreadMonths <= 60)) {
      throw httpError(422, `${label}: "Chia đều trong" phải từ 1 đến 60 tháng.`);
    }
    const appliesTo = [...new Set((t.appliesTo ?? []).map(Number))];
    if (appliesTo.some((id) => !live.has(id))) throw httpError(422, `${name}: dự án trong "Áp dụng cho" không tồn tại.`);
    let id = /^[\w-]{1,40}$/.test(String(t.id ?? '')) && byId.has(String(t.id)) ? String(t.id) : null;
    if (!id || seen.has(id)) id = `t${Date.now().toString(36)}${i}`;
    seen.add(id);
    const old = byId.get(id);
    const keepPrices = old && hasPriceVersions(old.kind) && hasPriceVersions(kind) && old.currency === currency;
    return { id, ...normalizeTool({ name, kind, currency, startMonth, endMonth, spreadMonths, appliesTo,
      amount: keepPrices ? old.amount : amount, prices: keepPrices ? old.prices : [] }) };
  });
}

/** Save the whole list (Cấu hình tab). */
export function saveTools(db, body, { actor, openMonth }) {
  const stored = listTools(db);
  const tools = parseTools(db, body.tools, stored);
  for (const o of stored) {
    if (!tools.some((t) => t.id === o.id) && hasClosedCost(o, openMonth)) {
      throw httpError(422, `Không thể xóa ${o.name}: tool đã có chi phí trong tháng đã chốt. Nhập "Đến tháng" để ngừng dùng.`);
    }
  }
  tx(db, () => {
    const log = (field, o, n) => logChange(db, { actor, action: ACTION, field, oldValue: o, newValue: n, reason: body.reason });
    tools.forEach((t, i) => {
      const o = stored.find((x) => x.id === t.id);
      saveTool(db, t.id, i, t);
      if (!o) log(`Thêm ${t.name}`, '—', toolLabel(db, t, openMonth));
      else if (o.name !== t.name || toolLabel(db, o, openMonth) !== toolLabel(db, t, openMonth)) {
        log(o.name === t.name ? t.name : `${o.name} → ${t.name}`, toolLabel(db, o, openMonth), toolLabel(db, t, openMonth));
      }
    });
    for (const o of stored) {
      if (tools.some((t) => t.id === o.id)) continue;
      db.prepare('DELETE FROM tools WHERE id = ?').run(o.id);
      log(`Xóa ${o.name}`, toolLabel(db, o, openMonth), '—');
    }
  });
}

/** "Đổi giá từ tháng…": a new price from `fromMonth` (an open month); earlier months keep the old price. */
export function changePrice(db, toolId, body, { actor, openMonth }) {
  const tool = listTools(db).find((t) => t.id === toolId);
  if (!tool) throw httpError(404, 'Không tìm thấy tool');
  if (!hasPriceVersions(tool.kind)) throw httpError(422, 'Chỉ đổi giá được tool Hằng tháng hoặc Theo mức dùng.');
  const fromMonth = String(body.fromMonth ?? '');
  if (!MONTH.test(fromMonth)) throw httpError(422, 'Vui lòng chọn tháng áp dụng giá mới.');
  if (fromMonth < openMonth) throw httpError(422, `Không thể đổi giá trong tháng đã chốt sổ. Chọn từ tháng ${monthLabel(openMonth)} trở đi.`);
  const amount = Number(body.amount);
  if (!(Number.isFinite(amount) && amount >= 0)) throw httpError(422, 'Giá mới phải ≥ 0.');
  const old = priceAt(tool, fromMonth);
  const prices = [...tool.prices.filter((p) => p.fromMonth !== fromMonth), { fromMonth, amount }].sort((a, b) => a.fromMonth.localeCompare(b.fromMonth));
  tx(db, () => {
    saveTool(db, tool.id, db.prepare('SELECT sort FROM tools WHERE id = ?').get(tool.id).sort, { ...tool, prices });
    logChange(db, { actor, action: ACTION, field: `Đổi giá ${tool.name}`, oldValue: `${formatMoney(old, tool.currency)}/tháng`,
      newValue: `${formatMoney(amount, tool.currency)}/tháng`, effectiveDate: `${fromMonth}-01`, reason: body.reason });
  });
}

/** Enter (amount) or clear (amount null) the actual of a tool in a month. */
export function setActual(db, body, { actor }) {
  const tool = listTools(db).find((t) => t.id === String(body.toolId ?? ''));
  if (!tool) throw httpError(404, 'Không tìm thấy tool');
  const month = String(body.month ?? '');
  if (!MONTH.test(month)) throw httpError(422, 'Tháng không hợp lệ.');
  const actuals = loadToolActuals(db);
  const cell = toolMonth(tool, month, actuals);
  if (!cell.active) throw httpError(422, `${tool.name} không dùng trong tháng ${monthLabel(month)}.`);
  const clear = body.amount == null || body.amount === '';
  const amount = Number(body.amount);
  if (!clear && !(Number.isFinite(amount) && amount >= 0)) throw httpError(422, 'Số thực tế phải ≥ 0.');
  const before = cell.actual != null ? formatVnd(cell.actual) : `Dự kiến ${formatVnd(cell.planned)}`;
  tx(db, () => {
    if (clear) db.prepare('DELETE FROM tool_actuals WHERE tool_id = ? AND month = ?').run(tool.id, month);
    else {
      db.prepare(`INSERT INTO tool_actuals (tool_id, month, amount, currency, entered_by, entered_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(tool_id, month) DO UPDATE SET amount = excluded.amount, currency = excluded.currency,
        entered_by = excluded.entered_by, entered_at = excluded.entered_at`).run(tool.id, month, amount, tool.currency, actor, new Date().toISOString());
    }
    const after = clear ? `Dự kiến ${formatVnd(cell.planned)}` : formatVnd(toolMonth(tool, month, { [`${tool.id}|${month}`]: { amount, currency: tool.currency } }).actual);
    logChange(db, { actor, action: ACTION, field: `${clear ? 'Xóa số thực tế' : 'Số thực tế'} ${tool.name} tháng ${monthLabel(month)}`,
      oldValue: before, newValue: after, effectiveDate: `${month}-01` });
  });
}

/**
 * "Theo tháng": one row per tool, one cell per month (planned / actual / estimate still waiting for its invoice),
 * the monthly total, and the actuals due but not entered ("Ước tính" + reminder line).
 */
export function monthlyTable(tools, actuals, today) {
  const months = tableMonths(today);
  const missing = missingActuals(tools, actuals, today, months[0]);
  const isMissing = new Set(missing.map((x) => `${x.toolId}|${x.month}`));
  const rows = tools.map((t) => ({
    id: t.id, name: t.name, kind: t.kind, currency: t.currency,
    cells: months.map((month) => ({ month, ...toolMonth(t, month, actuals), missing: isMissing.has(`${t.id}|${month}`),
      enteredBy: actuals[`${t.id}|${month}`]?.enteredBy ?? null, enteredAt: actuals[`${t.id}|${month}`]?.enteredAt ?? null })),
  }));
  const totals = months.map((month, i) => ({ month, value: rows.reduce((s, r) => s + r.cells[i].value, 0),
    planned: rows.some((r) => r.cells[i].active && r.cells[i].actual == null) }));
  return { months, currentMonth: today.slice(0, 7), rows, totals, missing };
}
