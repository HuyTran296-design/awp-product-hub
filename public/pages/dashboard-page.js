// Dashboard tổng: team totals, one row per root project (status, baseline dots, finance), cost share bar.
// A Dự án row shows the sum of its products with "3 Tốt · 1 Cần chú ý"; its chevron button expands it into its products,
// its name opens the Trang tổng hợp (and expands it).

import { get } from '../api.js';
import { shareBar } from '../charts.js';
import { branchState, branchToggle, childCountsText, coverageNote, delta, esc, lifecycleBadge, platformIcons, profitBadge, revenueLabel, sampleTag, statusBadge, statusShape, stopLossBadge } from '../ui.js';
import { formatDate, formatPct, formatVnd } from '/shared/format.js';
import { STATUS_LABELS } from '/shared/health-score.js';

let sortBy = 'score';
const branches = branchState('dash', false);
const navBranches = branchState('nav', true);
let turned = null; // branch whose chevron plays its turn on the next draw

export async function render(root, ctx) {
  const [data, sl] = await Promise.all([get(`/api/dashboard?period=${ctx.state.period}`), get('/api/stoploss')]);
  if (!ctx.isCurrent()) return;
  const stopLoss = Object.fromEntries(sl.rows.map((r) => [r.id, r]));
  const { team, range } = data;

  const draw = () => {
    // Paused projects keep their score but are not ranked: they always come after running ones.
    const ranked = (p) => p.lifecycle !== 'paused';
    // Build-phase projects (without children) form their own list, outside the profit/score ranking.
    const byScore = (a, b) => (sortBy === 'profit' ? b.profit - a.profit : (b.score ?? -1) - (a.score ?? -1));
    const order = (a, b) => (ranked(b) - ranked(a)) || byScore(a, b);
    const isParentRow = (p) => Boolean(p.isFolder);
    const building = data.rows.filter((p) => p.phase === 'build' && !isParentRow(p));
    const rows = data.rows.filter((p) => p.phase !== 'build' || isParentRow(p)).sort(order);
    root.innerHTML = `
      ${ctx.pageHeader({ title: 'Dashboard', crumb: 'Tổng hợp tất cả dự án & sản phẩm', range })}
      ${team.overheadNegative ? '<div class="alert error" style="margin-bottom:16px">⚠ Tổng lương đang vượt chi phí cố định của team.</div>' : ''}
      <section class="kpi-grid" aria-label="Tổng team">
        ${data.scoped ? `
          ${kpi(revenueLabel('Tổng doanh thu'), formatVnd(team.revenue), `${delta(team.revenueDelta)}<span>Phạm vi bạn được xem</span>`)}
          ${kpi(`Tổng chi phí (${esc(range.label)})`, formatVnd(team.cost), '<span>Phạm vi bạn được xem</span>')}
          ${kpi('Lãi/Lỗ', formatVnd(team.profit), profitBadge(team.profit))}`
        : `
          ${kpi(revenueLabel('Tổng doanh thu'), formatVnd(team.revenue), delta(team.revenueDelta))}
          ${kpi(`Tổng chi phí team (${esc(range.label)})`, formatVnd(team.cost), '<span>Chi phí cố định × hệ số kỳ</span>')}
          ${kpi('Lãi/Lỗ team', `${formatVnd(team.profit)}`, `${profitBadge(team.profit)} ${delta(team.profitDelta)}`)}
          ${kpi('Chi phí chưa phân bổ', formatVnd(team.unallocated), `<span>${formatPct(team.unallocatedPct)} chi phí team</span>`)}`}
      </section>

      <div class="list-head">
        <h2>Dự án <span class="muted small">(${data.rows.filter((r) => r.isFolder).length} dự án · ${data.projects.length} sản phẩm)</span></h2>
        <div class="seg" role="group" aria-label="Sắp xếp">
          <button type="button" data-sort="score" aria-pressed="${sortBy === 'score'}">Theo điểm</button>
          <button type="button" data-sort="profit" aria-pressed="${sortBy === 'profit'}">Theo lãi/lỗ</button>
        </div>
      </div>
      ${rows.length ? `<div class="project-list">${rows.map((p) => (isParentRow(p)
        ? parentRow(p, stopLoss[p.id], turned === p.id) + (branches.isOpen(p.id) ? [...p.children].sort(order).map((c) => projectRow(c, stopLoss[c.id], 'child')).join('') : '')
        : projectRow(p, stopLoss[p.id]))).join('')}</div>` : ''}
      ${building.length ? `<div class="list-head" style="margin-top:20px"><h2>Đang xây dựng <span class="muted small">(${building.length})</span></h2>
        <span class="note">Không tính vào xếp hạng lời/lỗ · chi phí vẫn cộng đủ vào tổng chi phí team</span></div>
        <div class="project-list">${building.map((p) => projectRow(p, stopLoss[p.id])).join('')}</div>` : ''}

      ${data.costShare ? `<section class="card" style="margin-top:16px">
        <div class="card-head"><div><h2>Tỷ trọng chi phí team</h2><div class="sub">Theo chi phí cố định/tháng — từng dự án và phần chưa phân bổ</div></div>${sampleTag()}</div>
        ${shareBar(data.costShare)}
      </section>` : ''}`;
    ctx.bindPageHeader(root);
    root.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => { sortBy = b.dataset.sort; draw(); }));
    root.querySelectorAll('[data-expand]').forEach((b) => b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = Number(b.dataset.expand);
      branches.set(id, !branches.isOpen(id));
      turned = id;
      draw();
      turned = null;
      root.querySelector(`[data-expand="${id}"]`)?.focus();
    }));
    root.querySelectorAll('[data-branch-open]').forEach((a) => a.addEventListener('click', () => {
      branches.set(Number(a.dataset.branchOpen), true);
      navBranches.set(Number(a.dataset.branchOpen), true);
    }));
  };
  draw();
}

function kpi(label, value, foot) {
  return `<div class="card"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot}</div></div>`;
}

/** Dự án row (sum of its products): status + score, child counts ("3 Tốt · 1 Cần chú ý"), revenue, cost, P&L, % team cost. */
function parentRow(g, sl, turned) {
  const counts = childCountsText(g.counts);
  const slBadge = sl && ['warning', 'triggered'].includes(sl.status)
    ? stopLossBadge(sl.status, sl.statusLabel, { href: `#/projects/${g.id}/overview?section=stoploss` }) : '';
  return `<div class="project-row group">
    <div class="project-name">${branchToggle({ id: g.id, name: g.name, open: branches.isOpen(g.id), attr: 'data-expand', turned })}
      <span class="project-swatch" style="background:${esc(g.color)}"></span>
      <div><a href="#/projects/${g.id}/overview" class="group-name-link" data-branch-open="${g.id}">${esc(g.name)}</a><div class="small muted" style="font-weight:400">${g.children.length} sản phẩm · ${platformIcons(g.platforms)}</div></div></div>
    <div><div class="chips" style="gap:6px">${g.score == null ? '<span class="badge neutral">○ Chưa có điểm</span>' : statusBadge(g.status, g.score)}${g.lifecycle === 'paused' ? lifecycleBadge('paused', 'Tạm dừng') : ''}${slBadge}</div>
      <div class="group-counts" style="margin-top:6px">${esc(counts)}</div></div>
    <div><span class="cell-label">Doanh thu</span><span class="cell-value num">${formatVnd(g.revenue)}</span><div>${delta(g.revenueDelta)}</div></div>
    <div><span class="cell-label">Chi phí</span><span class="cell-value num">${formatVnd(g.cost)}</span></div>
    <div><span class="cell-label">Lãi/Lỗ</span><span class="cell-value num">${formatVnd(g.profit)}</span><div>${profitBadge(g.profit)}</div></div>
    <div><span class="cell-label">% chi phí team</span><span class="cell-value num">${formatPct(g.teamPct)}</span></div>
  </div>`;
}

function projectRow(p, sl, variant = '') {
  // Stop-loss badge only when it needs attention; it opens the proposal (or the project's stop-loss block).
  const slBadge = sl && ['warning', 'triggered'].includes(sl.status)
    ? stopLossBadge(sl.status, sl.statusLabel, { href: `#/projects/${p.id}/overview?section=stoploss` })
    : '';
  const dots = p.baselines.map((b) => `<span class="baseline-dot ${b.status ?? ''}" tabindex="0" role="img"
      aria-label="${esc(`${b.name}: ${b.pct == null ? 'Chưa có dữ liệu' : `${STATUS_LABELS[b.status]} · Đạt ${formatPct(b.pct, 0)} mục tiêu`}`)}"
      data-tip="${esc(`${b.name}\n${b.pct == null ? 'Chưa có dữ liệu' : `${STATUS_LABELS[b.status]} · Đạt ${formatPct(b.pct, 0)} mục tiêu`}`)}">${statusShape(b.status)}</span>`).join('');
  return `<a class="project-row ${variant}" href="#/projects/${p.id}/overview" aria-label="Mở sản phẩm ${esc(p.name)}">
    <div class="project-name"><span class="project-swatch" style="background:${esc(p.color)}"></span>
      <div>${esc(p.name)}<div class="small muted" style="font-weight:400">${platformIcons(p.platforms)}</div></div></div>
    <div><div class="chips" style="gap:6px">${statusBadge(p.status, p.score)}${p.lifecycle === 'paused' ? lifecycleBadge('paused', 'Tạm dừng') : ''}${slBadge}</div>
      ${p.lifecycle === 'paused' ? '<div class="note">Không xếp hạng · chi phí = 0 khi tạm dừng</div>' : ''}
      ${coverageNote(p.scoreUsed, p.scoreTotal) ? `<div class="note">${coverageNote(p.scoreUsed, p.scoreTotal)}</div>` : ''}<div class="baseline-dots">${dots}</div></div>
    <div><span class="cell-label">Doanh thu</span><span class="cell-value num">${formatVnd(p.revenue)}</span><div>${delta(p.revenueDelta)}</div></div>
    <div><span class="cell-label">Chi phí</span><span class="cell-value num">${formatVnd(p.cost)}</span></div>
    ${p.budget?.inBuild
      ? `<div><span class="cell-label">Đầu tư</span><span class="cell-value num">${formatVnd(p.budget.spend)}</span>
          <div><span class="badge lc-active" style="white-space:normal">◆ Đã dùng ${p.budget.usedPct == null ? '—' : formatPct(p.budget.usedPct, 0)} ngân sách</span></div>
          ${p.budget.launchDate ? `<div class="note">Ra mắt dự kiến ${formatDate(p.budget.launchDate)} (còn ${p.budget.daysToLaunch} ngày)</div>` : ''}</div>`
      : `<div><span class="cell-label">Lãi/Lỗ</span><span class="cell-value num">${formatVnd(p.profit)}</span><div>${profitBadge(p.profit)}</div></div>`}
    <div><span class="cell-label">% chi phí team</span><span class="cell-value num">${formatPct(p.teamPct)}</span></div>
  </a>`;
}
