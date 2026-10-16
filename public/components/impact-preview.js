// "Xem trước tác động": monthly cost before → after for every project and the unallocated share.

import { esc, profitBadge } from '../ui.js';
import { formatDate, formatNumber, formatPct, formatVnd } from '/shared/format.js';
import { PROJECT_STATUSES } from '/shared/cost-timeline.js';

const same = (a, b) => Math.abs(a - b) < 0.5;

function change(before, after, fmt) {
  if (same(before, after)) return `<span>${fmt(after)}</span>`;
  return `<span>${fmt(before)}</span><span class="arrow-sep">→</span><span class="changed">${fmt(after)}</span>`;
}

/**
 * @param {object} preview  impactPreview() payload
 * @param {{focusId?:number, revenueMonthly?:{value:number}}} opts
 */
export function impactPreviewHtml(preview, { focusId, revenueMonthly } = {}) {
  if (!preview) return '<div class="note">Đang tính…</div>';
  const pct = (v) => formatPct(v);
  const rows = preview.rows.map((r) => {
    const b = r.before;
    const a = r.after;
    const status = r.statusBefore !== r.statusAfter
      ? `<span class="small muted">${PROJECT_STATUSES[r.statusBefore] ?? '—'} → <b>${PROJECT_STATUSES[r.statusAfter] ?? '—'}</b></span>` : '';
    const profit = r.projectId === focusId && revenueMonthly?.value != null
      ? `<div class="detail">Doanh thu vẫn tính (30 ngày gần nhất ${formatVnd(revenueMonthly.value)}) − chi phí ${formatVnd(a.total)}
         = ${profitBadge(revenueMonthly.value - a.total)} ${formatVnd(Math.abs(revenueMonthly.value - a.total))}/tháng</div>` : '';
    return `<div class="impact-row"${r.projectId === focusId ? ' style="border-color:var(--border-strong)"' : ''}>
      <div class="head"><b><span class="dot" style="background:${esc(r.color)}"></span> ${esc(r.name)}</b> ${status}
        <span class="num">${change(b.total, a.total, formatVnd)} <span class="muted">(${change(b.teamPct, a.teamPct, pct)})</span></span></div>
      <div class="detail">Trực tiếp ${change(b.direct, a.direct, formatVnd)} · FTE ${change(b.fte * 100, a.fte * 100, (v) => formatNumber(v / 100, 1))}
        · Chi phí chung ${change(b.overhead, a.overhead, formatVnd)}</div>${profit}
    </div>`;
  }).join('');
  const u = preview.unallocated;
  return `<div class="impact">
    <div class="note">Chi phí cố định/tháng áp dụng từ ${formatDate(preview.date)} · trước → sau</div>
    ${rows}
    <div class="impact-row"><div class="head"><b>Chưa phân bổ</b>
      <span class="num">${change(u.before.total, u.after.total, formatVnd)} <span class="muted">(${change(u.before.teamPct, u.after.teamPct, pct)})</span></span></div></div>
  </div>`;
}
