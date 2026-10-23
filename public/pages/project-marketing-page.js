// Dự án → Marketing: website KPIs (GA4), install sources by channel, top 5 blog posts (sortable).

import { get } from '../api.js';
import { legend, lineChart } from '../charts.js';
import { delta, esc, platformTags, projectCrumb, sampleTag } from '../ui.js';
import { formatNumber, formatPct } from '/shared/format.js';

const blogSort = { key: 'views', dir: -1 };
const expanded = new Set(); // channel keys opened with ▸ (kept while navigating)

const BLOG_COLUMNS = [
  { key: 'views', label: 'Lượt xem', fmt: formatNumber },
  { key: 'clicks', label: 'Click "Tải app"', fmt: formatNumber },
  { key: 'ctr', label: 'CTR', fmt: (v) => formatPct(v) },
  { key: 'clicksIos', label: 'Click iOS', fmt: formatNumber },
  { key: 'clicksAndroid', label: 'Click Android', fmt: formatNumber },
  { key: 'installs', label: 'Lượt tải ghi nhận', fmt: formatNumber },
];

export async function render(root, ctx) {
  const [projectId] = ctx.params;
  const data = await get(`/api/projects/${projectId}/marketing?period=${ctx.state.period}`);
  if (!ctx.isCurrent()) return;
  const { project: p, range, website: w, websiteSeries: s, channels } = data;
  const hasWeb = data.hasWeb;
  const hasBlog = Boolean(data.blog);
  const yt = data.youtube;

  const draw = () => {
    root.innerHTML = `
      ${ctx.pageHeader({
        title: `<span style="display:inline-flex;align-items:center;gap:10px"><span class="project-swatch" style="background:${esc(p.color)};height:24px"></span>${esc(p.name)} · Marketing</span>`,
        crumb: `${projectCrumb(p, 'Marketing')} · ${platformTags(p.platforms.filter((x) => x !== 'blog'))}`, range,
      })}

      <section class="card">
        <div class="card-head"><div><h2>${data.productType === 'youtube_playables' ? 'Landing page' : 'Website'}</h2><div class="sub">Nguồn: GA4</div></div>${sampleTag()}</div>
        ${hasWeb ? `<div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:16px">
          ${tile('Người dùng', formatNumber(w.users.value), delta(w.users.delta))}
          ${tile('Phiên', formatNumber(w.sessions.value), delta(w.sessions.delta))}
          ${tile('Tỷ lệ tương tác', formatPct(w.engagementRate.value), delta(w.engagementRate.delta, { points: true }))}
          ${tile('Click "Tải app"', formatNumber(w.clicks.value), delta(w.clicks.delta))}
          ${tile('Tỷ lệ click/phiên', formatPct(w.clickRate.value, 2), delta(w.clickRate.delta, { points: true }))}
        </div>
        ${legend([{ name: 'Người dùng', color: 'var(--ios)', type: 'line' }, { name: 'Phiên', color: 'var(--text-2)', type: 'line' },
          { name: 'Click "Tải app"', color: 'var(--android)', type: 'line' }])}
        <div class="chart-scroll">${lineChart([
          { name: 'Người dùng', color: 'var(--ios)', points: s.users },
          { name: 'Phiên', color: 'var(--text-2)', points: s.sessions },
          { name: 'Click "Tải app"', color: 'var(--android)', points: s.clicks },
        ], { granularity: s.granularity, width: Math.max(640, Math.min(1100, root.clientWidth - 40)) })}</div>
        <p class="small muted" style="margin:6px 0 0">${s.granularity === 'week' ? 'Tổng theo tuần.' : 'Theo ngày.'}${range.days < 14 ? ' Kỳ ngắn: biểu đồ hiển thị 14 ngày gần nhất.' : ''}</p>`
        : '<div class="empty">Dự án không có website.</div>'}
      </section>

      ${data.note ? `<p class="note" style="margin:12px 0 0">ⓘ ${esc(data.note)}.</p>` : ''}
      ${yt ? `<section class="card" style="margin-top:16px">
        <div class="card-head"><div><h2>Kênh YouTube</h2><div class="sub">Nguồn: YouTube Analytics${yt.connected ? '' : ' · chưa kết nối (dữ liệu mẫu)'}</div></div>${sampleTag()}</div>
        <div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:16px">
          ${tile('Lượt xem', formatNumber(yt.views.value), delta(yt.views.delta))}
          ${tile('Thời gian xem (giờ)', formatNumber(yt.hours.value), delta(yt.hours.delta))}
          ${tile('Người đăng ký mới', formatNumber(yt.subs.value), delta(yt.subs.delta))}
        </div>
        <div class="small muted" style="margin-bottom:6px">Lượt xem video kênh theo ${s.granularity === 'week' ? 'tuần' : 'ngày'}</div>
        <div class="chart-scroll">${lineChart([
          { name: 'Lượt xem', color: 'var(--accent)', points: yt.series.views },
        ], { granularity: s.granularity, width: Math.max(640, Math.min(1100, root.clientWidth - 40)) })}</div>
      </section>` : ''}

      ${channels ? `<section class="card" style="margin-top:16px">
        <div class="card-head"><div><h2>Nguồn tải app theo kênh</h2>
          <div class="sub">Link UTM (GA4) · campaign link App Store · UTM Google Play</div></div>${sampleTag()}</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Kênh</th><th class="r">Click link</th><th class="r">Tải iOS</th><th class="r">Tải Android</th>
            <th class="r">Tổng</th><th class="r">Tỷ lệ click → tải</th><th class="r">Tỷ trọng</th></tr></thead>
          <tbody>${channels.map((c) => channelRows(c, expanded.has(c.key))).join('')}</tbody>
          <tfoot><tr><td>Tổng</td><td class="r">${formatNumber(channels.reduce((a, c) => a + (c.clicks ?? 0), 0))}</td>
            <td class="r">${formatNumber(channels.reduce((a, c) => a + c.ios, 0))}</td>
            <td class="r">${formatNumber(channels.reduce((a, c) => a + c.android, 0))}</td>
            <td class="r">${formatNumber(data.channelTotal)}</td><td></td><td class="r">100,0%</td></tr></tfoot>
        </table></div>
        <p class="small muted" style="margin:8px 0 0">Ghi chú nguồn: Click link đo bằng link UTM trên GA4; lượt tải iOS từ campaign link App Store Connect (provider token &amp; campaign token); lượt tải Android từ UTM Google Play (referrer). "Promote từ nền tảng khác" = tổng các nguồn promote, mỗi nguồn có link theo dõi riêng (quản lý ở Kết nối dữ liệu → Nguồn promote). "Tìm kiếm trên Store" lấy từ nguồn App Store Search / Google Play Search nên không có click link.</p>
      </section>

      ` : ''}

      ${hasBlog ? `<section class="card" style="margin-top:16px">
        <div class="card-head"><div><h2>Blog — Top 5 bài viết</h2><div class="sub">Bấm tiêu đề cột để sắp xếp</div></div>${sampleTag()}</div>
        ${hasBlog ? `<div class="table-wrap"><table>
          <thead><tr><th>Bài viết</th>${BLOG_COLUMNS.map((c) => `<th class="r sortable" data-sort="${c.key}" tabindex="0"
            aria-sort="${blogSort.key === c.key ? (blogSort.dir < 0 ? 'descending' : 'ascending') : 'none'}">${c.label}<span class="sort-ind">${blogSort.key === c.key ? (blogSort.dir < 0 ? '▼' : '▲') : '↕'}</span></th>`).join('')}</tr></thead>
          <tbody>${[...data.blog].sort((a, b) => ((a[blogSort.key] ?? 0) - (b[blogSort.key] ?? 0)) * blogSort.dir).map((post) => `<tr>
            <td class="wrap">${esc(post.title)}${post.project ? ` <span class="note">· ${esc(post.project)}</span>` : ''}</td>${BLOG_COLUMNS.map((c) => `<td class="r">${c.fmt(post[c.key])}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty">Dự án không có blog.</div>'}
      </section>` : ''}`;
    ctx.bindPageHeader(root);
    root.querySelectorAll('[data-expand]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.expand;
      if (expanded.has(k)) expanded.delete(k); else expanded.add(k);
      draw();
      root.querySelector(`[data-expand="${k}"]`)?.focus();
    }));
    root.querySelectorAll('th[data-sort]').forEach((th) => {
      const sort = () => {
        blogSort.dir = blogSort.key === th.dataset.sort ? -blogSort.dir : -1;
        blogSort.key = th.dataset.sort;
        draw();
        root.querySelector(`th[data-sort="${blogSort.key}"]`)?.focus();
      };
      th.addEventListener('click', sort);
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort(); } });
    });
  };
  draw();
}

/** Channel row; "Promote từ nền tảng khác" expands (▸/▾) into one row per promote source. */
function channelRows(c, open) {
  const cells = (x) => `<td class="r">${x.clicks == null ? '<span class="muted" title="Không có link click — người dùng tìm trực tiếp trên Store">—</span>' : formatNumber(x.clicks)}</td>
    <td class="r">${formatNumber(x.ios)}</td><td class="r">${formatNumber(x.android)}</td>
    <td class="r"><b>${formatNumber(x.total)}</b></td>
    <td class="r">${x.clickToInstall == null ? '—' : formatPct(x.clickToInstall)}</td>
    <td class="r">${formatPct(x.share)}</td>`;
  const kids = c.children ?? null;
  const toggle = kids ? `<button type="button" class="tree-toggle" data-expand="${c.key}" aria-expanded="${open}"
    aria-label="${open ? 'Thu gọn' : 'Xem'} ${kids.length} nguồn con của ${esc(c.name)}">${open ? '▾' : '▸'}</button>` : '<span class="tree-spacer"></span>';
  const row = `<tr><td title="${esc(c.source)}"><span class="ch-name">${toggle}<span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}
    ${kids ? `<span class="note">(${kids.length} nguồn)</span>` : ''}</span></td>${cells(c)}</tr>`;
  if (!kids || !open) return row;
  return row + (kids.map((k) => `<tr class="child-row"><td title="Mã nguồn: ${esc(k.code)}"><span class="ch-name sub"><span class="dot sm" style="background:${esc(c.color)}"></span>
    <span>${esc(k.name)}${k.note ? ` <span class="note">(${esc(k.note)})</span>` : ''}</span></span></td>${cells(k)}</tr>`).join('')
    || '<tr class="child-row"><td colspan="7" class="muted">Chưa có nguồn promote — thêm ở Quản lý dự án → Kết nối dữ liệu → Nguồn promote.</td></tr>');
}

function tile(label, value, foot) {
  return `<div style="border:1px solid var(--border);border-radius:12px;padding:12px">
    <div class="kpi-label">${label}</div><div class="kpi-value" style="font-size:20px">${value}</div><div class="kpi-foot">${foot}</div></div>`;
}
