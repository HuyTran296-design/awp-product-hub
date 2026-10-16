// Staffing editor: pick members (each shows free effort before selection), set monthly cost and % effort.
// Free effort = 100% − effort on other running projects in the selected month; updates live while typing.
// Used by the project edit tab, the wizard and the "Tiếp tục" dialog.

import { esc, parseVnd } from '../ui.js';
import { formatNumber, formatPct, formatVnd } from '/shared/format.js';

/**
 * @param {HTMLElement} el
 * @param {{context:{members:object[], allocationMode:string, workingDays:number}, rows:object[], manualAllocPct:number,
 *          compact?:boolean, optional?:boolean, onChange?:Function}} opts  optional: no staff is fine (Nhân sự chung of a Dự án)
 */
export function createStaffingEditor(el, opts) {
  let ctx = opts.context;
  let rows = [];
  let manual = 0;
  let initial = '';

  const snapshot = () => JSON.stringify({ rows, manual });
  const member = (id) => ctx.members.find((m) => m.id === id);
  const effortOf = (r) => (Number.isFinite(r?.effortPct) ? r.effortPct : 0);
  const rowOf = (id) => rows.find((r) => r.memberId === id);
  const overBy = (r) => effortOf(r) - member(r.memberId).available;

  const reset = (context, sourceRows, manualPct) => {
    ctx = context;
    rows = sourceRows.filter((r) => member(r.memberId)).map((r) => ({ memberId: r.memberId, effortPct: r.effortPct,
      monthlyCost: member(r.memberId).monthlyCost }));
    manual = manualPct ?? 0;
    initial = snapshot();
    draw();
  };

  /** Replace the current rows (keeping typed costs) without changing the saved baseline used by isDirty. */
  const setRows = (sourceRows, manualPct) => {
    rows = sourceRows.filter((r) => member(r.memberId)).map((r) => ({ memberId: r.memberId, effortPct: r.effortPct,
      monthlyCost: r.monthlyCost ?? member(r.memberId).monthlyCost }));
    manual = manualPct ?? 0;
    draw();
  };

  /** "chỉ còn trống 10%" or, when fully used elsewhere, "Nam đã dùng 100% ở ABC Studio Game". */
  const usedText = (m) => {
    if (m.available > 0 || !m.allocations.length) return `chỉ còn trống ${formatPct(Math.max(0, m.available), 0)}`;
    return `${m.name.trim().split(/\s+/).pop()} đã dùng ${formatPct(100 - m.available, 0)} ở ${m.allocations.map((a) => a.name).join(', ')}`;
  };
  const allocTip = (m) => (m.allocations.length
    ? m.allocations.map((a) => `${a.name} ${formatNumber(a.effortPct)}%`).join(' · ')
    : 'Chưa tham gia sản phẩm / dự án nào khác');

  const pickItem = (m) => {
    const selected = Boolean(rowOf(m.id));
    const full = m.available <= 0 && !selected;
    const used = Math.min(100, 100 - m.available);
    const busiest = [...m.allocations].sort((a, b) => b.effortPct - a.effortPct)[0];
    return `<label class="pick${full ? ' full' : ''}${selected ? ' on' : ''}">
      <input type="checkbox" data-pick="${m.id}" ${selected ? 'checked' : ''} ${full ? 'disabled' : ''}>
      <span class="who"><b>${esc(m.name)}</b> <span class="muted">· ${esc(m.role)}</span></span>
      <span class="cap">
        <span class="free-label" data-pick-free="${m.id}">${full ? 'Đã đủ 100%' : `Còn trống ${formatPct(Math.max(0, m.available), 0)}`}</span>
        <span class="capbar" tabindex="0" data-tip="${esc(`Effort đã dùng ${formatPct(used, 0)}: ${allocTip(m)}`)}"><span style="width:${used}%"></span></span>
      </span>
      ${full && busiest ? `<a class="small" href="#/config/projects/${busiest.projectId}?tab=staffing">Xem / giảm effort ở nơi khác</a>` : ''}
    </label>`;
  };

  const draw = () => {
    const sorted = [...ctx.members].sort((a, b) => b.available - a.available || a.name.localeCompare(b.name, 'vi'));
    el.innerHTML = `
      <div class="field"><span>Nhân sự tham gia</span>
        <div class="team-capacity" data-capacity></div>
        <div class="pick-list">${sorted.map(pickItem).join('')}</div>
        ${opts.compact ? '' : '<span class="hint">Còn trống = 100% − effort ở các sản phẩm / dự án khác trong tháng hiệu lực. Sửa chi phí nhân sự ở đây sẽ cập nhật hồ sơ của người đó từ cùng ngày hiệu lực.</span>'}</div>
      <div class="member-rows" style="margin-top:12px">${rows.map((r) => {
        const m = member(r.memberId);
        return `<div class="member-row">
          <div class="who"><b>${esc(m.name)}</b><span class="small muted">${esc(m.role)}</span>
            <div class="free" data-free="${r.memberId}"></div></div>
          <label class="field"><span>Chi phí nhân sự/tháng</span><div class="input-suffix" data-suffix="₫">
            <input class="input right" inputmode="numeric" data-cost="${r.memberId}" value="${formatNumber(r.monthlyCost)}"></div></label>
          <label class="field"><span>% effort <span class="muted">(tối đa ${formatNumber(Math.max(0, m.available))}%)</span></span><div class="input-suffix" data-suffix="%">
            <input class="input right" type="number" min="0" max="${Math.max(0, m.available)}" step="5" data-effort="${r.memberId}"
              placeholder="≤ ${formatNumber(Math.max(0, m.available))}" value="${Number.isFinite(r.effortPct) ? r.effortPct : ''}"></div></label>
          <div class="calc" data-calc="${r.memberId}"></div>
        </div>`;
      }).join('') || (opts.optional ? '<div class="note">Chưa chọn nhân sự nào (không bắt buộc).</div>' : '<div class="alert warn">Chưa chọn nhân sự nào.</div>')}</div>
      ${ctx.allocationMode === 'manual' ? `<label class="field" style="margin-top:12px;max-width:240px"><span>% chi phí chung</span>
        <div class="input-suffix" data-suffix="%"><input class="input right" type="number" min="0" max="100" step="0.1" id="manual-pct" value="${manual}"></div>
        <span class="hint">Cách phân bổ đang là thủ công (đặt ở Chi phí team).</span></label>` : ''}`;
    bind();
    refresh();
  };

  /** Live numbers: per-row free effort before → after, picker labels, team capacity line. */
  const refresh = () => {
    let teamFree = 0;
    for (const m of ctx.members) {
      const r = rowOf(m.id);
      const after = m.available - effortOf(r);
      teamFree += Math.max(0, after);
      const label = el.querySelector(`[data-pick-free="${m.id}"]`);
      if (label && r) label.textContent = `Còn trống ${formatPct(Math.max(0, m.available), 0)} → ${formatPct(Math.max(0, after), 0)}`;
    }
    el.querySelector('[data-capacity]').innerHTML =
      `Năng lực còn trống của team: <b>${formatNumber(teamFree / 100, 1)} FTE (${formatPct(teamFree, 0)})</b>`;

    for (const r of rows) {
      const m = member(r.memberId);
      const effort = effortOf(r);
      const over = overBy(r);
      const freeEl = el.querySelector(`[data-free="${r.memberId}"]`);
      freeEl.className = `free${over > 0 ? ' neg' : ''}`;
      freeEl.textContent = over > 0
        ? `Vượt ${formatPct(over, 0)} (${usedText(m)})`
        : `Còn trống: ${formatPct(m.available, 0)} → ${formatPct(m.available - effort, 0)} sau khi giao`;
      const monthly = (Number.isFinite(r.monthlyCost) ? r.monthlyCost : 0) * effort / 100;
      el.querySelector(`[data-calc="${r.memberId}"]`).innerHTML =
        `<b>${formatVnd(monthly)}</b>/tháng · ${formatVnd(monthly / (ctx.workingDays || 21))}/ngày`;
      el.querySelector(`[data-effort="${r.memberId}"]`).classList.toggle('invalid', over > 0 || !(effort >= 0 && effort <= 100));
    }
  };

  const changed = () => { refresh(); opts.onChange?.(); };

  const bind = () => {
    el.querySelectorAll('[data-pick]').forEach((c) => c.addEventListener('change', () => {
      const id = Number(c.dataset.pick);
      if (c.checked) rows.push({ memberId: id, effortPct: 0, monthlyCost: member(id).monthlyCost });
      else rows = rows.filter((r) => r.memberId !== id);
      rows.sort((a, b) => a.memberId - b.memberId);
      draw();
      el.querySelector(`[data-effort="${id}"]`)?.focus();
      opts.onChange?.();
    }));
    el.querySelectorAll('[data-cost]').forEach((i) => {
      i.addEventListener('input', () => { rowOf(Number(i.dataset.cost)).monthlyCost = parseVnd(i.value); changed(); });
      i.addEventListener('blur', () => { const v = parseVnd(i.value); if (Number.isFinite(v)) i.value = formatNumber(v); });
    });
    el.querySelectorAll('[data-effort]').forEach((i) => i.addEventListener('input', () => {
      rowOf(Number(i.dataset.effort)).effortPct = i.value === '' ? NaN : Number(i.value);
      changed();
    }));
    el.querySelector('#manual-pct')?.addEventListener('input', (e) => { manual = e.target.value === '' ? 0 : Number(e.target.value); changed(); });
  };

  reset(opts.context, opts.rows, opts.manualAllocPct);
  return {
    reset,
    setRows,
    getValue: () => ({ rows: rows.map((r) => ({ ...r, effortPct: effortOf(r) })), manualAllocPct: manual }),
    isDirty: () => snapshot() !== initial,
    /** Blocks "Tiếp"/save: missing numbers or effort above a member's free capacity. */
    hasLocalErrors: () => rows.some((r) => !Number.isFinite(r.effortPct) || !Number.isFinite(r.monthlyCost)
      || !(r.effortPct >= 0 && r.effortPct <= 100) || overBy(r) > 0),
    localErrors: () => rows.filter((r) => overBy(r) > 0).map((r) => {
      const m = member(r.memberId);
      return `${m.name}: Vượt ${formatPct(overBy(r), 0)} (${usedText(m)}).`;
    }),
  };
}
