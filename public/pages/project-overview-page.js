// Dự án → Tổng quan: header badges, 5 baseline cards, finance block + chart, project members.
// A Dự án gets its Trang tổng hợp instead (project-folder-page.js).

import { get } from '../api.js';
import { legend, revenueCostChart } from '../charts.js';
import { openProposalDialog } from '../components/proposal-dialog.js';
import { openBaselinePanel } from '../components/baseline-panel.js';
import { stopLossBlock } from '../components/stoploss-block.js';
import { openManualEntry } from '../components/manual-entry-dialog.js';
import { renderFolder } from './project-folder-page.js';
import {
  coverageNote, delta, esc, formatMetric, lifecycleBadge, platformTags, profitBadge, projectCrumb, revenueLabel, sampleTag, statusBadge,
} from '../ui.js';
import { formatDate, formatNumber, formatPct, formatVnd } from '/shared/format.js';
import { PLAYABLES_REVENUE_NOTE } from '/shared/metric-catalog.js';

export async function render(root, ctx) {
  const [projectId] = ctx.params;
  const [data, sl] = await Promise.all([get(`/api/projects/${projectId}/overview?period=${ctx.state.period}`), get(`/api/projects/${projectId}/stoploss`)]);
  if (!ctx.isCurrent()) return;
  if (data.folder) {
    const slRows = (await get('/api/stoploss')).rows;
    if (ctx.isCurrent()) renderFolder(root, ctx, data, sl, slRows);
    return;
  }
  const { project: p, range, chart, members } = data;
  const isAdmin = ctx.state.user.role === 'admin';
  const pl = p;

  root.innerHTML = `
    ${ctx.pageHeader({
      title: `<span style="display:inline-flex;align-items:center;gap:10px"><span class="project-swatch" style="background:${esc(p.color)};height:24px"></span>${esc(p.name)}</span>`,
      crumb: `${projectCrumb(p, 'Tổng quan')} · ${platformTags(p.platforms.filter((x) => x !== 'blog'))}`,
      range,
      extra: `<div class="chips">${p.lifecycle !== 'active' ? lifecycleBadge(p.lifecycle, p.lifecycleLabel) : ''}${statusBadge(p.status, p.score, { large: true })}
        ${p.budget?.inBuild ? investBadge(p.budget, true) : profitBadge(pl.profit, { large: true })}
        <span class="badge neutral lg">Giai đoạn: ${esc(p.phaseLabel)}</span>
        ${isAdmin && (p.baselines.some((b) => b.source === 'manual') || p.platforms?.includes('playables')) ? '<button class="btn sm primary" data-manual-entry>Cập nhật số liệu</button>' : ''}
        ${coverageNote(p.scoreUsed, p.scoreTotal) ? `<span class="badge neutral lg">${coverageNote(p.scoreUsed, p.scoreTotal)}</span>` : ''}
        <span class="badge neutral lg">${p.scoreDelta == null ? '— so kỳ trước' : `${p.scoreDelta >= 0 ? '▲' : '▼'} ${formatPct(Math.abs(p.scoreDelta))} điểm`}</span></div>`,
    })}

    ${data.connectionErrors?.length ? `<p class="conn-warning" role="status">⚠ Kết nối ${esc(data.connectionErrors.join(', '))} bị lỗi –
      <a href="#/config/projects/${p.id}?tab=connections">Xem chi tiết</a></p>` : ''}
    ${p.budget?.inBuild ? buildBlock(p.budget) : ''}
    ${p.platforms?.includes('playables') ? `<p class="note" style="margin:-6px 0 10px">ⓘ ${esc(PLAYABLES_REVENUE_NOTE)}.</p>` : ''}
    ${coverageNote(p.scoreUsed, p.scoreTotal) ? `<p class="note" style="margin:-6px 0 10px">Điểm sức khỏe ${coverageNote(p.scoreUsed, p.scoreTotal).toLowerCase()} — baseline chưa có dữ liệu không được tính.</p>` : ''}
    <section aria-label="Baseline" class="baseline-grid" data-count="${Math.min(p.baselines.length, 5)}">${p.baselines.map((b) => baselineCard(b)).join('')}</section>

    <div class="two-col" style="margin-top:16px">
      ${p.budget?.inBuild && !p.revenue ? `<section class="card"><div class="card-head"><div><h2>Doanh thu & chi phí theo thời gian</h2></div></div>
        <div class="empty">Giai đoạn Xây dựng: chưa có doanh thu. Theo dõi chi phí ở khối "Giai đoạn Xây dựng" phía trên.</div></section>` : `<section class="card">
        <div class="card-head"><div><h2>Doanh thu & chi phí theo thời gian</h2>
          <div class="sub">${chart.extended ? `${chart.buckets.length} ngày gần nhất (kỳ ngắn được mở rộng để thấy xu hướng)` : `Theo ${{ day: 'ngày', week: 'tuần', month: 'tháng' }[chart.granularity]}`} · Chi phí theo ngày làm việc</div></div>${sampleTag()}</div>
        ${legend([{ name: 'Doanh thu', color: p.color }, { name: 'Chi phí', type: 'dashed' }])}
        <div class="chart-scroll">${revenueCostChart(chart.buckets, { barColor: p.color, granularity: chart.granularity })}</div>
      </section>`}
      <section class="card">
        <div class="card-head"><div><h2>Tài chính</h2><div class="sub">Kỳ ${esc(range.label)}</div></div>${sampleTag()}</div>
        <div class="fin-list">
          ${finRow(revenueLabel(), formatVnd(p.revenue), [...revenueParts(p.revenueByPlatform), delta(p.revenueDelta)].join(' · '))}
          ${finRow('Chi phí kỳ', formatVnd(p.cost), p.costDirect != null
            ? `Lương (trực tiếp + chia từ nhân sự chung của dự án) ${formatVnd(p.costDirect)} + Tools/AI ${formatVnd(p.costTools)}`
            : 'Tổng chi phí sản phẩm (lương nhân sự + Tools/AI)')}
          ${p.cumulative ? finRow(`Chi phí lũy kế từ ${p.cumulative.since ? formatDate(p.cumulative.since) : '—'}`, formatVnd(p.cumulative.value),
            'Từ ngày bắt đầu tính chi phí · tháng hiện tại theo số ngày làm việc đã qua') : ''}
          ${p.budget?.inBuild
            ? finRow('Chi phí lũy kế / ngân sách Xây dựng', `${formatVnd(p.budget.spend)} / ${p.budget.budget ? formatVnd(p.budget.budget) : '—'}`,
              `Đang đầu tư — không xét lời/lỗ trong giai đoạn Xây dựng · ${p.budget.spendSource === 'manual' ? 'theo số nhập thủ công' : 'theo chi phí hệ thống từ ngày bắt đầu Xây dựng'}`)
            : `${finRow('Lãi/Lỗ', `${profitBadge(pl.profit)} ${formatVnd(pl.profit)}`, 'Doanh thu − Chi phí kỳ')}
          ${finRow('Biên lợi nhuận', p.margin == null ? '—' : formatPct(p.margin))}`}
          ${finRow('% chi phí team', formatPct(pl.teamPct), `FTE riêng ${formatNumber(p.fte, 1)} · ${formatVnd(p.costMonthly)}/tháng`)}
          ${p.budget?.inBuild ? '' : finRow('Doanh thu cần để hòa vốn/tháng', formatVnd(data.breakEvenMonthly))}
        </div>
      </section>
    </div>

    ${sl.enabled ? stopLossBlock(sl, isAdmin, `#/config/projects/${p.id}?tab=stoploss`) : ''}

    <section class="card" style="margin-top:16px">
      <div class="card-head"><div><h2>Nhân sự sản phẩm</h2><div class="sub">${members.length} người · FTE ${formatNumber(p.fte, 1)} (trực tiếp + chia từ nhân sự chung của dự án)</div></div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Họ tên</th><th>Vai trò</th><th class="r">% effort</th><th>Loại</th>${isAdmin ? '<th class="r">Chi phí cho sản phẩm/tháng</th>' : ''}</tr></thead>
        <tbody>${members.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.role)}</td><td class="r">${formatPct(m.effortPct, 0)}</td>
          <td>${m.shared ? `Chia từ nhân sự chung của ${esc(m.fromName ?? 'dự án')}` : 'Trực tiếp'}</td>
          ${isAdmin ? `<td class="r">${formatVnd(m.monthlyCost)}</td>` : ''}</tr>`).join('')
          || `<tr><td colspan="5" class="empty">Chưa có nhân sự. ${isAdmin ? `<a href="#/config/projects/${p.id}?tab=staffing">Gán nhân sự</a>` : ''}</td></tr>`}</tbody>
        ${isAdmin && members.length ? `<tfoot><tr><td colspan="4">Chi phí nhân sự/tháng <span class="muted small">(chưa gồm Tools/AI)</span></td>
          <td class="r"><b>${formatVnd(members.reduce((a, m) => a + (m.monthlyCost ?? 0), 0))}</b></td></tr></tfoot>` : ''}
      </table></div>
    </section>`;
  ctx.bindPageHeader(root);
  // Baseline detail panel, remembered in the URL (?baseline=key) so links open it directly.
  const setBaselineParam = (key) => {
    const [path, qs] = location.hash.slice(1).split('?');
    const q = new URLSearchParams(qs || '');
    if (key) q.set('baseline', key); else q.delete('baseline');
    history.replaceState(null, '', `#${path}${q.toString() ? `?${q}` : ''}`);
  };
  const openPanel = (key) => openBaselinePanel({ baselines: p.baselines, key, score: p.score, thresholds: p.thresholds, range,
    projectId: p.id, isAdmin, onChange: setBaselineParam });
  root.querySelectorAll('[data-baseline]').forEach((btn) => btn.addEventListener('click', () => {
    setBaselineParam(btn.dataset.baseline);
    openPanel(btn.dataset.baseline);
  }));
  ctx.onLeave(() => document.querySelector('.drawer-backdrop')?.remove());
  if (ctx.query.baseline && p.baselines.some((b) => b.metricKey === ctx.query.baseline)) {
    root.querySelector(`[data-baseline="${ctx.query.baseline}"]`)?.focus();
    openPanel(ctx.query.baseline);
  }

  root.querySelector('[data-manual-entry]')?.addEventListener('click', () => openManualEntry(p.id, () => ctx.navigate(location.hash)));

  if (ctx.query.section === 'stoploss') {
    const block = root.querySelector('#stoploss');
    block?.scrollIntoView({ block: 'start' });
    block?.focus({ preventScroll: true });
  }
  root.querySelector('[data-open-proposal]')?.addEventListener('click', (e) => openProposalDialog(Number(e.currentTarget.dataset.openProposal), {
    isAdmin, onDone: () => ctx.navigate(location.hash) }));
}

/**
 * Compact baseline card — a real button (Tab + Enter): name, actual value, status badge "● Tốt · Đạt 114%", "›".
 * Details (target, progress, change, weight, platforms, chart) live in the slide-in panel.
 */
function baselineCard(b) {
  if (b.stale) {
    return `<button type="button" class="card baseline-card compact stale" data-baseline="${esc(b.metricKey)}" aria-haspopup="dialog"
        aria-label="${esc(`${b.name}: chưa cập nhật`)}">
      <span class="top"><span class="name">${esc(b.name)}</span><span class="chev" aria-hidden="true">›</span></span>
      <span class="value num muted">—</span>
      <span><span class="badge neutral">○ Chưa cập nhật</span></span>
    </button>`;
  }
  return `<button type="button" class="card baseline-card compact" data-baseline="${esc(b.metricKey)}" aria-haspopup="dialog"
      aria-label="${esc(`${b.name}: xem chi tiết`)}">
    <span class="top"><span class="name">${esc(b.name)}</span><span class="chev" aria-hidden="true">›</span></span>
    <span class="value num">${formatMetric(b.actual, b.unit)}</span>
    <span>${statusBadge(b.status, null, { text: b.pct == null ? '' : ` · Đạt ${formatPct(b.pct, 0)}` })}</span>
  </button>`;
}

/** "iOS 1.000 ₫ · Android 2.000 ₫ · Playables 0 ₫" — the platforms the product's Doanh thu is read from. */
function revenueParts(byPlatform = {}) {
  return Object.entries(REVENUE_PLATFORMS).filter(([k]) => byPlatform?.[k] != null).map(([k, label]) => `${label} ${formatVnd(byPlatform[k])}`);
}
const REVENUE_PLATFORMS = { ios: 'iOS', android: 'Android', playables: 'Playables' };

function finRow(label, value, detail = '') {
  return `<div class="fin-row"><span class="label">${label}</span><span class="value num">${value}</span>${detail ? `<span class="detail">${detail}</span>` : ''}</div>`;
}


/** "Đang đầu tư · đã dùng 64% ngân sách" — replaces Lời/Lỗ in the build phase. */
function investBadge(b, large = false) {
  return `<span class="badge lc-active${large ? ' lg' : ''}">◆ Đang đầu tư · đã dùng ${b.usedPct == null ? '—' : formatPct(b.usedPct, 0)} ngân sách</span>`;
}

function buildBlock(b) {
  const pct = b.usedPct ?? 0;
  const color = pct >= 100 ? 'var(--red-mark)' : pct >= 70 ? 'var(--yellow-mark)' : 'var(--accent)';
  return `<section class="card" style="margin-bottom:14px">
    <div class="card-head" style="margin-bottom:8px"><div><h2>Giai đoạn Xây dựng</h2><div class="sub">Từ ${formatDate(b.since)} · không xét lời/lỗ</div></div>${investBadge(b)}</div>
    <div class="fin-row" style="border:0;padding:0 0 6px"><span class="label">Chi phí lũy kế / ngân sách</span>
      <span class="value num">${formatVnd(b.spend)} / ${b.budget ? formatVnd(b.budget) : 'chưa đặt ngân sách'}</span></div>
    <div class="sl-bar" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100" aria-label="Đã dùng ${formatPct(pct, 0)} ngân sách">
      <span style="width:${Math.min(100, pct)}%;background:${color}"></span></div>
    <p class="note" style="margin:10px 0 0">${b.launchDate ? `Ra mắt dự kiến: <b>${formatDate(b.launchDate)}</b> (${b.daysToLaunch >= 0 ? `còn ${b.daysToLaunch} ngày` : `trễ ${-b.daysToLaunch} ngày`})` : 'Chưa đặt ngày ra mắt dự kiến'}
      ${b.plannedToDate ? ` · Ngân sách theo kế hoạch đến hôm nay: ${formatVnd(b.plannedToDate)}` : ''}</p>
  </section>`;
}
