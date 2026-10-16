// Trang tổng hợp of a Dự án — its only page (shares the period filter). Everything is the sum of its
// children: header, totals, sortable children table, revenue/cost chart, cost share between children, "Nhân sự chung",
// and the parent-level stop-loss block when enabled. No baseline cards.

import { legend, revenueCostChart, shareBar } from '../charts.js';
import { openProposalDialog } from '../components/proposal-dialog.js';
import { stopLossBlock } from '../components/stoploss-block.js';
import {
  childCountsText, delta, esc, lifecycleBadge, platformIcons, profitBadge, projectCrumb, sampleTag, statusBadge, stopLossBadge,
} from '../ui.js';
import { formatPct, formatVnd } from '/shared/format.js';
import { STATUS_RANK } from '/shared/stop-loss.js';
import { PARENT_SPLIT_METHODS } from '/shared/cost-calculator.js';

const COLS = [
  { key: 'name', label: 'Sản phẩm', value: (c) => c.name.toLowerCase() },
  { key: 'phase', label: 'Giai đoạn', value: (c) => ['build', 'launch', 'growth', 'stable'].indexOf(c.phase) },
  { key: 'score', label: 'Trạng thái', value: (c) => c.score ?? -1 },
  { key: 'platforms', label: 'Nền tảng', value: (c) => c.platforms.join(',') },
  { key: 'revenue', label: 'Doanh thu', value: (c) => c.revenue ?? 0, right: true },
  { key: 'cost', label: 'Chi phí', value: (c) => c.cost, right: true },
  { key: 'profit', label: 'Lời/Lỗ', value: (c) => (c.budget?.inBuild ? -Infinity : c.profit), right: true },
  { key: 'teamPct', label: '% chi phí team', value: (c) => c.teamPct, right: true },
  { key: 'stopLoss', label: 'Cắt lỗ', value: (c) => STATUS_RANK[c.stopLoss?.status ?? 'off'] ?? 0 },
];
const view = { sort: 'score', dir: -1 };

/** @param {object} data  /api/projects/:id/overview of a Dự án ({ folder: true, … }) */
export function renderFolder(root, ctx, data, sl, slRows) {
  const { project: g, range, chart } = data;
  const isAdmin = ctx.state.user.role === 'admin';
  const slById = Object.fromEntries(slRows.map((r) => [r.id, r]));
  const kidsAll = data.children.map((c) => ({ ...c, stopLoss: slById[c.id] ?? null }));
  const counts = childCountsText(g.counts);

  const draw = () => {
    const col = COLS.find((c) => c.key === view.sort);
    const kids = [...kidsAll].sort((a, b) => {
      const x = col.value(a);
      const y = col.value(b);
      return (x < y ? -1 : x > y ? 1 : 0) * view.dir;
    });
    root.innerHTML = `
      ${ctx.pageHeader({
        title: `<span style="display:inline-flex;align-items:center;gap:10px"><span class="project-swatch" style="background:${esc(g.color)};height:24px"></span>${g.icon ? `<span aria-hidden="true">${esc(g.icon)}</span>` : ''}${esc(g.name)}</span>`,
        crumb: `${projectCrumb({ ...g, parentId: null }, 'Tổng hợp')} · ${platformIcons(g.platforms)}`,
        range,
        extra: `<div class="chips">${g.lifecycle !== 'active' ? lifecycleBadge(g.lifecycle, g.lifecycleLabel) : ''}
          ${counts ? `<span class="badge neutral lg">${esc(counts)}</span>` : ''}
          ${g.score == null ? '<span class="badge neutral lg">○ Chưa có điểm</span>' : statusBadge(g.status, g.score, { large: true })}${profitBadge(g.profit, { large: true })}
          ${isAdmin ? `<a class="btn sm" href="#/config/projects/${g.id}">Cấu hình dự án</a>` : ''}</div>`,
      })}
      ${g.description ? `<p class="note" style="margin:-6px 0 10px">${esc(g.description)}</p>` : ''}
      <section class="kpi-grid five" aria-label="Tổng các sản phẩm">
        ${kpi('Doanh thu thực nhận', formatVnd(g.revenue), `${delta(g.revenueDelta)}<span>Tổng các sản phẩm</span>`)}
        ${kpi(`Chi phí (${esc(range.label)})`, formatVnd(g.cost), '<span>Tổng các sản phẩm</span>')}
        ${kpi('Lời/Lỗ', formatVnd(g.profit), `${profitBadge(g.profit)} ${delta(g.profitDelta)}`)}
        ${kpi('% chi phí team', formatPct(g.teamPct), '<span>Tổng các sản phẩm</span>')}
        ${kpi('Điểm tổng hợp', g.score == null ? 'Chưa có điểm' : formatPct(g.score),
          `<span data-tip="Trung bình điểm các sản phẩm theo chi phí kỳ; bỏ qua sản phẩm Xây dựng, Tạm dừng hoặc chưa có điểm">Trung bình theo chi phí${g.scoreUsed ? ` · ${g.scoreUsed}/${g.scoreTotal} sản phẩm` : ''} ⓘ</span>`)}
      </section>

      <section class="card" style="margin-top:12px;padding:0">
        <div class="card-head" style="padding:16px 18px 0"><div><h2>Sản phẩm</h2><div class="sub">${kids.length} sản phẩm · bấm một dòng để mở Tổng quan</div></div>
          <div class="chips">${isAdmin ? `<a class="btn sm" href="#/config/products/new?project=${g.id}">＋ Thêm sản phẩm</a>` : ''}${sampleTag()}</div></div>
        <div class="table-wrap" style="border:0;margin-top:8px"><table>
          <thead><tr>${COLS.map((c) => `<th class="sortable${c.right ? ' r' : ''}" data-sort="${c.key}" tabindex="0"
            aria-sort="${view.sort === c.key ? (view.dir > 0 ? 'ascending' : 'descending') : 'none'}">${c.label}<span class="sort-ind">${view.sort === c.key ? (view.dir > 0 ? '▲' : '▼') : '↕'}</span></th>`).join('')}</tr></thead>
          <tbody>${kids.map((c) => `<tr class="clickable" data-open="${c.id}">
            <td><a href="#/projects/${c.id}/overview"><span class="dot" style="background:${esc(c.color)}"></span> ${esc(c.name)}</a></td>
            <td>${esc(c.phaseLabel ?? '—')}</td>
            <td>${c.lifecycle !== 'active' ? lifecycleBadge(c.lifecycle, c.lifecycleLabel) : c.phase === 'build' ? '<span class="badge lc-active">◆ Đang xây dựng</span>' : statusBadge(c.status, c.score)}</td>
            <td>${platformIcons(c.platforms)}</td>
            <td class="r">${formatVnd(c.revenue)}</td><td class="r">${formatVnd(c.cost)}</td>
            <td class="r">${c.budget?.inBuild ? `<span class="badge lc-active">◆ Đang đầu tư · ${c.budget.usedPct == null ? '—' : formatPct(c.budget.usedPct, 0)} ngân sách</span>` : `${profitBadge(c.profit)} ${formatVnd(c.profit)}`}</td>
            <td class="r">${formatPct(c.teamPct)}</td>
            <td>${c.stopLoss && ['warning', 'triggered'].includes(c.stopLoss.status)
              ? stopLossBadge(c.stopLoss.status, c.stopLoss.statusLabel, { href: `#/projects/${c.id}/overview?section=stoploss` }) : '<span class="muted">—</span>'}</td></tr>`).join('')
            || `<tr><td colspan="${COLS.length}" class="empty">Dự án chưa có sản phẩm.${isAdmin ? ` <a href="#/config/products/new?project=${g.id}">Thêm sản phẩm</a>` : ''}</td></tr>`}</tbody>
        </table></div>
      </section>

      <div class="two-col" style="margin-top:16px">
        <section class="card">
          <div class="card-head"><div><h2>Doanh thu & chi phí theo thời gian</h2>
            <div class="sub">${chart.extended ? `${chart.buckets.length} ngày gần nhất (kỳ ngắn được mở rộng để thấy xu hướng)` : `Theo ${{ day: 'ngày', week: 'tuần', month: 'tháng' }[chart.granularity]}`} · tổng các sản phẩm</div></div>${sampleTag()}</div>
          ${legend([{ name: 'Doanh thu thực nhận', color: g.color }, { name: 'Chi phí', type: 'dashed' }])}
          <div class="chart-scroll">${revenueCostChart(chart.buckets, { barColor: g.color, granularity: chart.granularity })}</div>
        </section>
        <section class="card">
          <div class="card-head"><div><h2>Tỷ trọng chi phí giữa các sản phẩm</h2><div class="sub">Kỳ ${esc(range.label)}</div></div>${sampleTag()}</div>
          ${data.costShare.length ? shareBar(data.costShare) : '<div class="empty">Chưa có chi phí trong kỳ.</div>'}
        </section>
      </div>

      ${sl?.enabled ? stopLossBlock(sl, isAdmin, `#/config/projects/${g.id}?tab=stoploss`) : ''}

      <section class="card" style="margin-top:16px">
        <div class="card-head"><div><h2>Nhân sự chung của dự án</h2><div class="sub">Làm cho các sản phẩm · ${esc(PARENT_SPLIT_METHODS[data.splitMethod] ?? '—')}</div></div>
          ${isAdmin ? `<a class="btn sm" href="#/config/projects/${g.id}?tab=staffing">Sửa</a>` : ''}</div>
        ${data.noRunningChild ? '<div class="alert warn" style="margin-bottom:10px">Dự án chưa có sản phẩm để chia chi phí — chi phí nhân sự chung đang nằm ở "Chưa phân bổ" của Chi phí team.</div>' : ''}
        ${data.warnings.length && !data.noRunningChild ? `<div class="alert warn" style="margin-bottom:10px"><ul>${data.warnings.map((w) => `<li>${esc(w.message)}</li>`).join('')}</ul></div>` : ''}
        <div class="table-wrap"><table><thead><tr><th>Họ tên</th><th>Vai trò</th><th class="r">% effort</th>${isAdmin ? '<th class="r">Chi phí/tháng</th>' : ''}</tr></thead>
          <tbody>${data.sharedStaff.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.role)}</td><td class="r">${formatPct(m.effortPct, 0)}</td>
            ${isAdmin ? `<td class="r">${formatVnd(m.monthlyCost)}</td>` : ''}</tr>`).join('') || `<tr><td colspan="${isAdmin ? 4 : 3}" class="empty">Không có nhân sự chung.</td></tr>`}</tbody></table></div>
      </section>`;
    ctx.bindPageHeader(root);
    root.querySelectorAll('th[data-sort]').forEach((th) => {
      const sort = () => { view.dir = view.sort === th.dataset.sort ? -view.dir : -1; view.sort = th.dataset.sort; draw(); };
      th.addEventListener('click', sort);
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort(); } });
    });
    root.querySelectorAll('tr[data-open]').forEach((tr) => tr.addEventListener('click', (e) => {
      if (!e.target.closest('a')) ctx.navigate(`#/projects/${tr.dataset.open}/overview`);
    }));
    root.querySelector('[data-open-proposal]')?.addEventListener('click', (e) => openProposalDialog(Number(e.currentTarget.dataset.openProposal), {
      isAdmin, onDone: () => ctx.navigate(location.hash) }));
    if (ctx.query.section === 'stoploss') root.querySelector('#stoploss')?.scrollIntoView({ block: 'start' });
  };
  draw();
}

function kpi(label, value, foot) {
  return `<div class="card"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot}</div></div>`;
}
