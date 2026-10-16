// "Cắt lỗ" block of Dự án → Tổng quan (a parent is evaluated incl. its children). Uses closed months only.

import { legend, stopLossChart } from '../charts.js';
import { esc, stopLossBadge } from '../ui.js';
import { formatDate, formatNumber, formatPct, formatVnd } from '/shared/format.js';

/** "Cắt lỗ" block (only when the project's stop-loss is enabled). Uses closed months only. */
export function stopLossBlock(sl, isAdmin, configHref) {
  // id="stoploss": badges on the Dashboard / project list link here (?section=stoploss).
  const pct = sl.usedPct ?? 0;
  const fill = Math.min(100, pct);
  const color = pct >= 100 ? 'var(--red-mark)' : pct >= sl.warnPct ? 'var(--yellow-mark)' : 'var(--green-mark)';
  const ms = sl.nextMilestone;
  const closed = sl.evaluatedThrough ? `${sl.evaluatedThrough.slice(5)}/${sl.evaluatedThrough.slice(0, 4)}` : null;
  return `<section class="card" style="margin-top:16px;scroll-margin-top:16px" id="stoploss" tabindex="-1">
    <div class="card-head"><div><h2>Cắt lỗ</h2><div class="sub">Theo dõi từ ${sl.start ? formatDate(sl.start) : '—'} ·
      ${closed ? `tính đến tháng đã chốt ${closed}` : 'chưa có tháng đã chốt đủ dữ liệu'} · kích hoạt khi ≥ ${sl.need} điều kiện thỏa</div></div>
      <div class="chips">${stopLossBadge(sl.display.status, sl.display.label)}
        ${sl.proposal?.status === 'pending' ? `<button class="btn sm${isAdmin ? ' primary' : ''}" data-open-proposal="${sl.proposal.id}">${isAdmin ? 'Mở đề xuất' : 'Xem đề xuất'} #${sl.proposal.id}</button>` : ''}
        ${isAdmin && configHref ? `<a class="btn sm" href="${configHref}">Cấu hình</a>` : ''}</div></div>
    <div class="two-col">
      <div class="stack" style="gap:14px">
        ${sl.conditions.find((c) => c.key === 'cumulative_loss')?.enabled === false ? '' : `<div>
          <div class="fin-row" style="border:0;padding:0 0 6px"><span class="label">Lỗ lũy kế</span>
            <span class="value num">${formatNumber(sl.cumLoss)} / ${formatNumber(sl.threshold)} (${formatPct(sl.usedPct)})</span></div>
          <div class="sl-bar" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"
            aria-label="Đã dùng ${formatPct(pct)} ngưỡng lỗ lũy kế"><span style="width:${fill}%;background:${color}"></span>
            <i class="tick" style="left:${sl.warnPct}%"></i><span class="tick-label" style="left:${sl.warnPct}%">Cảnh báo ${formatNumber(sl.warnPct)}%</span></div>
        </div>`}
        <div style="margin-top:8px">${sl.conditions.map((c) => `<div class="cond-status">
          <span>${c.met ? '<b style="color:var(--red-ink)">■ Thỏa</b>' : c.warning ? '<b style="color:var(--yellow-ink)">▲ Cảnh báo</b>' : '<span class="muted">○ Chưa thỏa</span>'}
            ${esc(c.label)}${c.enabled ? '' : ' <span class="muted">(tắt)</span>'}</span>
          <span class="small">${esc(c.detail)}</span></div>`).join('')}</div>
        <div class="fin-list">
          <div class="fin-row"><span class="label">Mốc gần nhất</span><span class="value small">${ms
            ? `${formatDate(ms.date)} · ${ms.daysLeft >= 0 ? `còn ${ms.daysLeft} ngày` : 'chờ chốt sổ'} · ${ms.achieving == null ? '—' : ms.achieving ? '✓ chỉ tiêu đang đạt' : '✗ chỉ tiêu đang không đạt'}`
            : 'Không có mốc'}</span></div>
          <div class="fin-row"><span class="label">Lỗ trung bình 3 tháng gần nhất</span><span class="value">${formatVnd(sl.avg3Loss)}</span></div>
          <div class="fin-row"><span class="label">Thời gian còn lại ước tính</span><span class="value small">${esc(sl.remaining?.text ?? '—')}</span></div>
        </div>
      </div>
      <div>${sl.months.length ? `${legend([{ name: 'Lời', color: 'var(--green-mark)' }, { name: 'Lỗ', color: 'var(--red-mark)' },
        { name: 'Lũy kế lãi/lỗ', color: 'var(--text)', type: 'line' }, { name: 'Ngưỡng lỗ lũy kế', type: 'dashed' }])}
        <div class="chart-scroll sl-chart">${stopLossChart(sl.months, sl.threshold)}</div>` : '<div class="empty">Chưa có tháng đã chốt để hiển thị.</div>'}</div>
    </div>
  </section>`;
}
