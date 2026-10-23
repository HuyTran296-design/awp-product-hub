// Cấu hình → Quản lý dự án: status tabs with counts, search, sortable flat table, per-row "⋯" lifecycle menu.

import { get } from '../api.js';
import { openLifecycleDialog } from '../components/lifecycle-dialog.js';
import { coverageNote, esc, initials, lifecycleBadge, platformIcons, statusBadge, stopLossBadge } from '../ui.js';
import { STATUS_RANK } from '/shared/stop-loss.js';
import { formatDate, formatDateTime, formatNumber, formatPct, formatVnd } from '/shared/format.js';

const TABS = [['all', 'Tất cả'], ['active', 'Đang chạy'], ['paused', 'Tạm dừng'], ['draft', 'Nháp'], ['archived', 'Lưu trữ']];
const CONN_SHORT = { ga4: 'GA4', app_store: 'App Store', google_play: 'Google Play' };
const CONN_STATUS = { connected: 'đã kết nối', error: 'lỗi', not_configured: 'không dùng / chưa cấu hình' };
const COLUMNS = [
  { key: 'name', label: 'Dự án', value: (r) => r.name.toLowerCase() },
  { key: 'platforms', label: 'Nền tảng', value: (r) => r.platforms?.join(',') ?? '' },
  { key: 'status', label: 'Trạng thái', value: (r) => ['active', 'paused', 'draft', 'archived'].indexOf(r.status) },
  { key: 'phase', label: 'Giai đoạn', value: (r) => ['build', 'launch', 'growth', 'stable'].indexOf(r.phase) },
  { key: 'fte', label: 'Nhân sự', value: (r) => r.fte, right: true },
  { key: 'monthlyCost', label: 'Chi phí/tháng', value: (r) => r.monthlyCost, right: true },
  { key: 'teamPct', label: '% chi phí team', value: (r) => r.teamPct, right: true },
  { key: 'score', label: 'Điểm sức khỏe', value: (r) => r.score ?? -1 },
  { key: 'stopLoss', label: 'Cắt lỗ', value: (r) => STATUS_RANK[r.stopLoss?.status ?? 'off'] },
  { key: 'connections', label: 'Kết nối', value: (r) => (r.connections ?? []).filter((c) => c.status === 'connected').length },
  { key: 'lastUpdated', label: 'Cập nhật lần cuối', value: (r) => r.lastUpdated ?? '' },
];

const view = { tab: 'all', q: '', sort: 'name', dir: 1 };

/** Project rows merged with their stop-loss status. */
async function load() {
  const [list, sl] = await Promise.all([get('/api/projects'), get('/api/stoploss')]);
  const byId = Object.fromEntries(sl.rows.map((r) => [r.id, r]));
  list.rows.forEach((r) => { r.stopLoss = byId[r.id] ?? null; });
  return list;
}

export async function render(root, ctx) {
  let data = await load();
  if (!ctx.isCurrent()) return;
  const meta = ctx.state.meta;
  let openMenu = null;

  const visible = () => {
    const col = COLUMNS.find((c) => c.key === view.sort);
    return data.rows
      .filter((r) => view.tab === 'all' || r.status === view.tab)
      .filter((r) => r.name.toLowerCase().includes(view.q.trim().toLowerCase()))
      .sort((a, b) => {
        const x = col.value(a);
        const y = col.value(b);
        return (x < y ? -1 : x > y ? 1 : 0) * view.dir;
      });
  };

  const draw = () => {
    const rows = visible();
    root.innerHTML = `
      ${ctx.pageHeader({ title: 'Quản lý dự án', crumb: 'Cấu hình',
        extra: '<a class="btn primary" href="#/config/projects/new">＋ Thêm dự án</a>' })}
      <div class="toolbar">
        <div class="tabs" role="tablist" style="margin:0">${TABS.map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${view.tab === k}">
          ${l}<span class="count">${data.counts[k] ?? 0}</span></button>`).join('')}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input class="input search" type="search" placeholder="Tìm dự án…" value="${esc(view.q)}" data-search aria-label="Tìm dự án"></div>
      </div>
      <section class="card" style="padding:0">
        <div class="table-wrap" style="border:0"><table>
          <thead><tr>${COLUMNS.map((c) => `<th class="sortable${c.right ? ' r' : ''}" data-sort="${c.key}" tabindex="0"
            aria-sort="${view.sort === c.key ? (view.dir > 0 ? 'ascending' : 'descending') : 'none'}">${c.label}<span class="sort-ind">${view.sort === c.key ? (view.dir > 0 ? '▲' : '▼') : '↕'}</span></th>`).join('')}
            <th><span class="sr-only">Thao tác</span></th></tr></thead>
          <tbody>${rows.map(row).join('') || `<tr><td colspan="${COLUMNS.length + 1}" class="empty">Không có dự án nào${view.q ? ` khớp "${esc(view.q)}"` : ''}.</td></tr>`}</tbody>
        </table></div>
      </section>
      <p class="note" style="margin-top:10px">Chi phí, % chi phí team và nhân sự tính theo cấu hình đang áp dụng hôm nay · Điểm sức khỏe theo kỳ Tháng gần nhất · Kết nối: xanh = đã kết nối, đỏ = lỗi, xám = không dùng.</p>`;
    ctx.bindPageHeader(root);
    bind();
  };

  const row = (r) => `<tr class="clickable" data-open="${r.id}">
    <td><span style="display:inline-flex;align-items:center;gap:8px;font-weight:600"><span class="dot" style="background:${esc(r.color)}"></span>${esc(r.name)}</span></td>
    <td>${platformIcons(r.platforms ?? [])}</td>
    <td>${lifecycleBadge(r.status, r.statusLabel)}${r.pending ? `<div class="note">${esc(r.pending.label)} từ ${formatDate(r.pending.date)}</div>` : ''}</td>
    <td>${esc(r.phaseLabel ?? '—')}</td>
    <td class="r"><span class="avatars">${r.members.map((m) => `<span class="avatar" data-tip="${esc(`${m.name} · ${formatNumber(m.effortPct)}%`)}">${esc(initials(m.name))}</span>`).join('')}</span>
      <div class="note">FTE ${formatNumber(r.fte, 1)}</div></td>
    <td class="r">${formatVnd(r.monthlyCost)}</td>
    <td class="r">${formatPct(r.teamPct)}</td>
    <td>${statusBadge(r.scoreStatus, r.score)}${coverageNote(r.scoreUsed, r.scoreTotal) ? `<div class="note">${coverageNote(r.scoreUsed, r.scoreTotal)}</div>` : ''}</td>
    <td>${r.stopLoss ? stopLossBadge(r.stopLoss.status, r.stopLoss.statusLabel, { href: `#/projects/${r.id}/overview?section=stoploss` }) : '—'}</td>
    <td><span class="conn-icons">${r.connections.map((c) => `<span class="conn-icon ${c.status}" data-tip="${esc(`${c.name}: ${CONN_STATUS[c.status]}`)}">${CONN_SHORT[c.source]}</span>`).join('')}</span></td>
    <td class="small">${formatDateTime(r.lastUpdated)}</td>
    <td class="r"><div class="row-menu"><button class="icon-btn" data-menu="${r.id}" aria-haspopup="menu" aria-label="Thao tác cho ${esc(r.name)}">⋯</button>
      ${openMenu === r.id ? menu(r) : ''}</div></td>
  </tr>`;

  const menu = (r) => `<div class="menu-pop" role="menu">
    <a role="menuitem" href="#/projects/${r.id}/overview">Mở dashboard</a>
    ${data.readOnly ? '' : `<a role="menuitem" href="#/config/projects/${r.id}">Chỉnh sửa</a><hr>
    ${r.actions.map((a) => `<button role="menuitem" type="button" data-action="${a.action}" data-id="${r.id}"
      class="${a.action === 'delete' || a.action === 'archive' ? 'danger' : ''}" ${a.locked ? `disabled data-tip="${esc(a.tip)}" aria-disabled="true"` : ''}>${esc(a.label)}</button>`).join('')}`}
  </div>`;

  const bind = () => {
    root.querySelectorAll('[data-tab]').forEach((t) => t.addEventListener('click', () => { view.tab = t.dataset.tab; draw(); }));
    const search = root.querySelector('[data-search]');
    search.addEventListener('input', () => {
      view.q = search.value;
      const pos = search.selectionStart;
      draw();
      const s = root.querySelector('[data-search]');
      s.focus();
      s.setSelectionRange(pos, pos);
    });
    root.querySelectorAll('th[data-sort]').forEach((th) => {
      const sort = () => { view.dir = view.sort === th.dataset.sort ? -view.dir : 1; view.sort = th.dataset.sort; draw(); };
      th.addEventListener('click', sort);
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort(); } });
    });
    root.querySelectorAll('tr[data-open]').forEach((tr) => tr.addEventListener('click', (e) => {
      if (e.target.closest('.row-menu')) return;
      ctx.navigate(data.readOnly ? `#/projects/${tr.dataset.open}/overview` : `#/config/projects/${tr.dataset.open}`);
    }));
    root.querySelectorAll('[data-menu]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = Number(b.dataset.menu);
      openMenu = openMenu === id ? null : id;
      draw();
      root.querySelector('.menu-pop a, .menu-pop button:not(:disabled)')?.focus();
    }));
    root.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => {
      const r = data.rows.find((x) => x.id === Number(b.dataset.id));
      const a = r.actions.find((x) => x.action === b.dataset.action);
      openMenu = null;
      draw();
      openLifecycleDialog({
        project: r, action: a.action, label: a.label, status: r.pending?.status ?? r.status, latestDate: r.pending?.date,
        firstOpenDate: meta.firstOpenDate, today: meta.today,
        onDone: async () => { data = await load(); await ctx.refreshMeta(); draw(); },
      });
    }));
  };

  // Close the row menu on outside click / Escape.
  const close = (e) => {
    if (openMenu == null || (e.type === 'click' && e.target.closest('.row-menu'))) return;
    if (e.type === 'keydown' && e.key !== 'Escape') return;
    openMenu = null;
    draw();
  };
  document.addEventListener('click', close);
  document.addEventListener('keydown', close);
  ctx.onLeave(() => { document.removeEventListener('click', close); document.removeEventListener('keydown', close); });

  draw();
}
