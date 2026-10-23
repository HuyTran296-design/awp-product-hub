// Dashboard tổng: totals of the projects in view, one row per project (status, baseline dots, finance),
// a separate "Đang xây dựng" group, cost share bar.

import { get } from '../api.js';
import { shareBar } from '../charts.js';
import { coverageNote, delta, esc, lifecycleBadge, platformIcons, profitBadge, revenueLabel, sampleTag, statusBadge, statusShape, stopLossBadge } from '../ui.js';
import { formatDate, formatPct, formatVnd } from '/shared/format.js';
import { STATUS_LABELS } from '/shared/health-score.js';

let sortBy = 'score';

export async function render(root, ctx) {
  const [data, sl] = await Promise.all([get(`/api/dashboard?period=${ctx.state.period}`), get('/api/stoploss')]);
  if (!ctx.isCurrent()) return;
  const stopLoss = Object.fromEntries(sl.rows.map((r) => [r.id, r]));
  const { team, range } = data;

  const draw = () => {
    // Paused projects keep their score but are not ranked: they always come after running ones.
    const ranked = (p) => p.lifecycle !== 'paused';
    // Build-phase projects form their own list, outside the profit/score ranking.
    const byScore = (a, b) => (sortBy === 'profit' ? b.profit - a.profit : (b.score ?? -1) - (a.score ?? -1));
    const order = (a, b) => (ranked(b) - ranked(a)) || byScore(a, b);
    const building = data.projects.filter((p) => p.phase === 'build');
    const rows = data.projects.filter((p) => p.phase !== 'build').sort(order);
    root.innerHTML = `
      ${ctx.pageHeader({ title: 'Dashboard', crumb: 'Tổng hợp tất cả dự án', range })}
      <section class="kpi-grid" aria-label="Tổng team">
        ${data.scoped ? `
          ${kpi(revenueLabel('Tổng doanh thu'), formatVnd(team.revenue), `${delta(team.revenueDelta)}<span>Phạm vi bạn được xem</span>`)}
          ${kpi(`Tổng chi phí (${esc(range.label)})`, formatVnd(team.cost), '<span>Phạm vi bạn được xem</span>')}
          ${kpi('Lãi/Lỗ', formatVnd(team.profit), profitBadge(team.profit))}`
        : `
          ${kpi(revenueLabel('Tổng doanh thu'), formatVnd(team.revenue), delta(team.revenueDelta))}
          ${kpi(`Tổng chi phí team (${esc(range.label)})`, formatVnd(team.cost), '<span>Lương nhân sự + Tools/AI × hệ số kỳ</span>')}
          ${kpi('Lãi/Lỗ team', `${formatVnd(team.profit)}`, `${profitBadge(team.profit)} ${delta(team.profitDelta)}`)}
          ${kpi('Chi phí chưa phân bổ', formatVnd(team.unallocated), `<span>${formatPct(team.unallocatedPct)} chi phí team</span>`)}`}
      </section>

      <div class="list-head">
        <h2>Dự án <span class="muted small">(${data.projects.length})</span></h2>
        <div class="seg" role="group" aria-label="Sắp xếp">
          <button type="button" data-sort="score" aria-pressed="${sortBy === 'score'}">Theo điểm</button>
          <button type="button" data-sort="profit" aria-pressed="${sortBy === 'profit'}">Theo lãi/lỗ</button>
        </div>
      </div>
      ${rows.length ? `<div class="project-list">${rows.map((p) => projectRow(p, stopLoss[p.id])).join('')}</div>` : ''}
      ${building.length ? `<div class="list-head" style="margin-top:20px"><h2>Đang xây dựng <span class="muted small">(${building.length})</span></h2>
        <span class="note">Không tính vào xếp hạng lời/lỗ · chi phí vẫn cộng đủ vào tổng chi phí team</span></div>
        <div class="project-list">${building.map((p) => projectRow(p, stopLoss[p.id])).join('')}</div>` : ''}

      ${data.costShare ? `<section class="card" style="margin-top:16px">
        <div class="card-head"><div><h2>Tỷ trọng chi phí team</h2><div class="sub">Theo tổng chi phí team/tháng — từng dự án và phần chưa phân bổ</div></div>${sampleTag()}</div>
        ${shareBar(data.costShare)}
      </section>` : ''}`;
    ctx.bindPageHeader(root);
    root.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => { sortBy = b.dataset.sort; draw(); }));
  };
  draw();
}

function kpi(label, value, foot) {
  return `<div class="card"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot}</div></div>`;
}

function projectRow(p, sl) {
  // Stop-loss badge only when it needs attention; it opens the proposal (or the project's stop-loss block).
  const slBadge = sl && ['warning', 'triggered'].includes(sl.status)
    ? stopLossBadge(sl.status, sl.statusLabel, { href: `#/projects/${p.id}/overview?section=stoploss` })
    : '';
  const dots = p.baselines.map((b) => `<span class="baseline-dot ${b.status ?? ''}" tabindex="0" role="img"
      aria-label="${esc(`${b.name}: ${b.pct == null ? 'Chưa có dữ liệu' : `${STATUS_LABELS[b.status]} · Đạt ${formatPct(b.pct, 0)} mục tiêu`}`)}"
      data-tip="${esc(`${b.name}\n${b.pct == null ? 'Chưa có dữ liệu' : `${STATUS_LABELS[b.status]} · Đạt ${formatPct(b.pct, 0)} mục tiêu`}`)}">${statusShape(b.status)}</span>`).join('');
  return `<a class="project-row" href="#/projects/${p.id}/overview" aria-label="Mở dự án ${esc(p.name)}">
    <div class="project-name"><span class="project-swatch" style="background:${esc(p.color)}"></span>
      <div>${esc(p.name)}<div class="small muted" style="font-weight:400">${platformIcons(p.platforms)}</div></div></div>
    <div><div class="chips" style="gap:6px">${statusBadge(p.status, p.score)}${p.lifecycle === 'paused' ? lifecycleBadge('paused', 'Tạm dừng') : ''}${slBadge}</div>
      ${p.lifecycle === 'paused' ? '<div class="note">Không xếp hạng · chi phí = 0 khi tạm dừng</div>' : ''}
      ${coverageNote(p.scoreUsed, p.scoreTotal) ? `<div class="note">${coverageNote(p.scoreUsed, p.scoreTotal)}</div>` : ''}<div class="baseline-dots">${dots}</div></div>
    <div><span class="cell-label">Doanh thu</span><span class="cell-value num">${formatVnd(p.revenue)}</span><div>${delta(p.revenueDelta)}</div></div>
    <div><span class="cell-label">Chi phí</span><span class="cell-value num">${formatVnd(p.cost)}</span></div>
    ${p.budget?.inBuild
      ? `<div><span class="cell-label">Đầu tư</span><span class="cell-value num">${formatVnd(p.budget.spend)}</span>
          <div><span class="badge lc-active" style="white-space:normal">◆ Đang đầu tư · đã dùng ${p.budget.usedPct == null ? '—' : formatPct(p.budget.usedPct, 0)} ngân sách</span></div>
          ${p.budget.launchDate ? `<div class="note">Ra mắt dự kiến ${formatDate(p.budget.launchDate)} (còn ${p.budget.daysToLaunch} ngày)</div>` : ''}</div>`
      : `<div><span class="cell-label">Lãi/Lỗ</span><span class="cell-value num">${formatVnd(p.profit)}</span><div>${profitBadge(p.profit)}</div></div>`}
    <div><span class="cell-label">% chi phí team</span><span class="cell-value num">${formatPct(p.teamPct)}</span></div>
  </a>`;
}
