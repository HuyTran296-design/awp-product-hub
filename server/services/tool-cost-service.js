// Chi phí Tools/AI: the tool list (Cấu hình) and actuals per month (Theo tháng).
// Implicit rules (no month fields in the UI): a change of Kiểu chi phí / Số tiền / Tiền tệ / Áp dụng cho applies from the
// current month (a version; earlier months keep theirs), a new tool starts in the current month, and "Xóa" stops a tool
// from the current month — earlier months keep its cost and "Theo tháng" still shows them ("Đã ngừng").
// Editing an actual of a past month corrects data: that month's cost, P&L and stop-loss are recomputed from it.

import { addMonths } from '../../shared/closing.js';
import { formatVnd } from '../../shared/format.js';
import {
  AMOUNT_SUFFIX, CURRENCIES, formatMoney, isActiveIn, latestVersion, missingActuals, monthLabel, TOOL_KINDS, toolMonth, versionAt,
} from '../../shared/tool-costs.js';
import { listProjects, listTools, loadToolActuals, saveTool, tx } from '../database.js';
import { logChange } from './audit-log.js';
import { httpError } from './connection-service.js';

const ACTION = 'Chi phí Tools/AI';
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const VERSION_FIELDS = ['kind', 'currency', 'amount', 'appliesTo'];

/** Months shown in "Theo tháng": the 6 previous months, the current month and the next one. */
export function tableMonths(today) {
  const cur = today.slice(0, 7);
  return Array.from({ length: 8 }, (_, i) => addMonths(cur, i - 6));
}

function appliesToLabel(db, ids) {
  if (!ids?.length) return 'Tất cả dự án';
  const names = new Map(listProjects(db).map((p) => [p.id, p.name]));
  return ids.map((id) => names.get(id) ?? 'Đã xóa').join(', ');
}

/** "Hằng tháng · 6.000.000 ₫/tháng · Tất cả dự án" for the change history. */
export function versionLabel(db, v) {
  const suffix = AMOUNT_SUFFIX[v.kind] === 'một lần' ? ' một lần' : AMOUNT_SUFFIX[v.kind];
  return [TOOL_KINDS[v.kind], `${formatMoney(v.amount, v.currency)}${suffix}`, appliesToLabel(db, v.appliesTo)].join(' · ');
}

/** Rows of the Cấu hình list: { id?, name, kind, currency, amount, appliesTo }. */
export function parseTools(db, list) {
  if (!Array.isArray(list)) throw httpError(422, 'Danh sách Tools/AI không hợp lệ.');
  const live = new Set(listProjects(db).map((p) => p.id));
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
    const appliesTo = [...new Set((t.appliesTo ?? []).map(Number))];
    if (appliesTo.some((id) => !live.has(id))) throw httpError(422, `${name}: dự án trong "Áp dụng cho" không tồn tại.`);
    return { id: t.id == null ? null : String(t.id), name, kind, currency, amount, appliesTo };
  });
}

const sameVersion = (a, b) => VERSION_FIELDS.every((f) => JSON.stringify(a[f]) === JSON.stringify(b[f]));

/**
 * Save the Cấu hình list. A changed tool gets a version from `month` (replacing one already made this month, or
 * updating a version that only starts later); a new tool starts in `month`. Removing rows is done with deleteTool.
 */
export function saveTools(db, body, { actor, month }) {
  const stored = listTools(db);
  const rows = parseTools(db, body.tools);
  const byId = new Map(stored.map((t) => [t.id, t]));
  tx(db, () => {
    const log = (field, o, n) => logChange(db, { actor, action: ACTION, field, oldValue: o, newValue: n, effectiveDate: `${month}-01`, reason: body.reason });
    let sort = 0;
    const kept = new Set();
    for (const r of rows) {
      const next = { fromMonth: month, kind: r.kind, currency: r.currency, amount: r.amount, appliesTo: r.appliesTo };
      const old = r.id && byId.get(r.id);
      if (!old || old.removedFrom) {
        const id = `t${Date.now().toString(36)}${sort}`;
        saveTool(db, id, sort++, { name: r.name, versions: [next], removedFrom: null });
        log(`Thêm ${r.name}`, '—', versionLabel(db, next));
        continue;
      }
      kept.add(old.id);
      const last = latestVersion(old);
      let versions = old.versions;
      if (!sameVersion(last, next)) {
        // A version made this month, or one that only starts later, is updated in place (keeping its start month).
        versions = last.fromMonth && last.fromMonth >= month
          ? [...old.versions.slice(0, -1), { ...next, fromMonth: last.fromMonth }]
          : [...old.versions, next];
        log(old.name === r.name ? r.name : `${old.name} → ${r.name}`, versionLabel(db, last), versionLabel(db, next));
      } else if (old.name !== r.name) log(`Tên ${old.name}`, old.name, r.name);
      saveTool(db, old.id, sort++, { ...old, name: r.name, versions });
    }
    // Stopped tools keep their place after the list (they still show in "Theo tháng").
    for (const t of stored) if (!kept.has(t.id)) db.prepare('UPDATE tools SET sort = ? WHERE id = ?').run(sort++, t.id);
  });
}

/**
 * "Xóa": stop the tool from `month`; earlier months keep their cost. A tool that never counted before `month`
 * (added this month, or starting later) is removed completely.
 */
export function deleteTool(db, id, { actor, month }) {
  const tool = listTools(db).find((t) => t.id === id && !t.removedFrom);
  if (!tool) throw httpError(404, 'Không tìm thấy tool');
  const first = tool.versions[0].fromMonth;
  tx(db, () => {
    if (first && first >= month) db.prepare('DELETE FROM tools WHERE id = ?').run(id);
    else saveTool(db, id, db.prepare('SELECT sort FROM tools WHERE id = ?').get(id).sort, { ...tool, removedFrom: month });
    logChange(db, { actor, action: ACTION, field: `Xóa ${tool.name}`, oldValue: versionLabel(db, latestVersion(tool)),
      newValue: `Ngừng tính từ tháng ${monthLabel(month)}`, effectiveDate: `${month}-01` });
  });
}

/** Enter (amount) or clear (amount null) the actual of a tool in a month it exists in. */
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
  const currency = versionAt(tool, month).currency;
  const before = cell.actual != null ? formatVnd(cell.actual) : `Dự kiến ${formatVnd(cell.planned)}`;
  tx(db, () => {
    if (clear) db.prepare('DELETE FROM tool_actuals WHERE tool_id = ? AND month = ?').run(tool.id, month);
    else {
      db.prepare(`INSERT INTO tool_actuals (tool_id, month, amount, currency, entered_by, entered_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(tool_id, month) DO UPDATE SET amount = excluded.amount, currency = excluded.currency,
        entered_by = excluded.entered_by, entered_at = excluded.entered_at`).run(tool.id, month, amount, currency, actor, new Date().toISOString());
    }
    const after = clear ? `Dự kiến ${formatVnd(cell.planned)}` : formatVnd(toolMonth(tool, month, { [`${tool.id}|${month}`]: { amount, currency } }).actual);
    logChange(db, { actor, action: ACTION, field: `${clear ? 'Xóa số thực tế' : 'Số thực tế'} ${tool.name} tháng ${monthLabel(month)}`,
      oldValue: before, newValue: after, effectiveDate: `${month}-01` });
  });
}

/**
 * "Theo tháng": one row per tool (stopped tools too, while they have months in the table: "Đã ngừng"), one cell per
 * month (planned / actual / estimate still waiting for its invoice), the monthly total, and the actuals due.
 */
export function monthlyTable(tools, actuals, today) {
  const months = tableMonths(today);
  const missing = missingActuals(tools, actuals, today, months[0]);
  const isMissing = new Set(missing.map((x) => `${x.toolId}|${x.month}`));
  const rows = tools.filter((t) => !t.removedFrom || months.some((m) => isActiveIn(t, m))).map((t) => ({
    id: t.id, name: t.name, kind: latestVersion(t).kind, removedFrom: t.removedFrom,
    cells: months.map((month) => ({ month, ...toolMonth(t, month, actuals), currency: (versionAt(t, month) ?? latestVersion(t)).currency,
      missing: isMissing.has(`${t.id}|${month}`),
      enteredBy: actuals[`${t.id}|${month}`]?.enteredBy ?? null, enteredAt: actuals[`${t.id}|${month}`]?.enteredAt ?? null })),
  }));
  const totals = months.map((month, i) => ({ month, value: rows.reduce((s, r) => s + r.cells[i].value, 0) }));
  return { months, currentMonth: today.slice(0, 7), rows, totals, missing };
}
