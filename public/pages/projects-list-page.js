// Cấu hình → Quản lý dự án & sản phẩm: status tabs (for both) with counts, search, sortable tree table (Dự án ▸ Sản phẩm),
// per-row "⋯" lifecycle menu.

import { get } from '../api.js';
import { openLifecycleDialog } from '../components/lifecycle-dialog.js';
import { branchState, branchToggle, coverageNote, esc, initials, lifecycleBadge, platformIcons, statusBadge, stopLossBadge } from '../ui.js';
import { STATUS_RANK } from '/shared/stop-loss.js';
import { formatDate, formatDateTime, formatNumber, formatPct, formatVnd } from '/shared/format.js';

const TABS = [['all', 'Tất cả'], ['active', 'Đang chạy'], ['paused', 'Tạm dừng'], ['draft', 'Nháp'], ['archived', 'Lưu trữ']];
const CONN_SHORT = { ga4: 'GA4', app_store: 'App Store', google_play: 'Google Play' };
const CONN_STATUS = { connected: 'đã kết nối', error: 'lỗi', not_configured: 'không dùng / chưa cấu hình' };
const COLUMNS = [
  { key: 'name', label: 'Dự án / Sản phẩm', value: (r) => r.name.toLowerCase() },
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
const branches = branchState('list', true);
const navBranches = branchState('nav', true);
let turned = null; // branch whose chevron plays its turn on the next draw

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
      ${ctx.pageHeader({ title: 'Quản lý dự án & sản phẩm', crumb: 'Cấu hình',
        extra: '<div class="chips"><a class="btn primary" href="#/config/projects/new">＋ Thêm dự án</a><a class="btn primary" href="#/config/products/new">＋ Thêm sản phẩm</a></div>' })}
      <div class="toolbar">
        <div class="tabs" role="tablist" style="margin:0">${TABS.map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${view.tab === k}">
          ${l}<span class="count">${data.counts[k] ?? 0}</span></button>`).join('')}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input class="input search" type="search" placeholder="Tìm dự án, sản phẩm…" value="${esc(view.q)}" data-search aria-label="Tìm dự án hoặc sản phẩm"></div>
      </div>
      <section class="card" style="padding:0">
        <div class="table-wrap" style="border:0"><table>
          <thead><tr>${COLUMNS.map((c) => `<th class="sortable${c.right ? ' r' : ''}" data-sort="${c.key}" tabindex="0"
            aria-sort="${view.sort === c.key ? (view.dir > 0 ? 'ascending' : 'descending') : 'none'}">${c.label}<span class="sort-ind">${view.sort === c.key ? (view.dir > 0 ? '▲' : '▼') : '↕'}</span></th>`).join('')}
            <th><span class="sr-only">Thao tác</span></th></tr></thead>
          <tbody>${tree(rows) || `<tr><td colspan="${COLUMNS.length + 1}" class="empty">Không có dự án / sản phẩm nào${view.q ? ` khớp "${esc(view.q)}"` : ''}.</td></tr>`}</tbody>
        </table></div>
      </section>
      <p class="note" style="margin-top:10px">Chi phí, % chi phí team và nhân sự tính theo cấu hình đang áp dụng hôm nay (dự án = tổng các sản phẩm; nhân sự của dự án = nhân sự chung) · Điểm sức khỏe theo kỳ Tháng gần nhất · Kết nối: xanh = đã kết nối, đỏ = lỗi, xám = không dùng.</p>`;
    ctx.bindPageHeader(root);
    bind();
  };

  /** Tree: root projects (sorted); a Dự án (chevron button, product count) is followed by its products. Filters keep a parent visible when a child matches. */
  const tree = (rows) => {
    const shown = new Set(rows.map((r) => r.id));
    const kidsOf = (id) => rows.filter((r) => r.parentId === id);
    const roots = data.rows.filter((r) => r.parentId == null || !data.rows.some((x) => x.id === r.parentId))
      .filter((r) => shown.has(r.id) || kidsOf(r.id).length);
    const order = new Map(rows.map((r, i) => [r.id, i]));
    roots.sort((a, b) => (order.get(a.id) ?? -1) - (order.get(b.id) ?? -1));
    return roots.map((r) => row(r, false, kidsOf(r.id).length) + (!branches.isOpen(r.id) ? '' : kidsOf(r.id).map((k) => row(k, true)).join(''))).join('');
  };

  const row = (r, child = false, kids = 0) => `<tr class="clickable${child ? ' child-row' : ''}" data-open="${r.id}">
    <td><span style="display:inline-flex;align-items:center;gap:8px;font-weight:600">${r.childCount
      ? branchToggle({ id: r.id, name: r.name, open: branches.isOpen(r.id), attr: 'data-collapse', turned: turned === r.id })
      : child ? '' : '<span class="branch-spacer"></span>'}<span class="dot" style="background:${esc(r.color)}"></span>${r.isFolder
      ? `<a class="tree-name-link" href="#/projects/${r.id}/overview" data-branch-open="${r.id}">${esc(r.name)}</a>` : esc(r.name)}${r.isFolder ? ` <span class="count">${r.childCount}</span>` : ''}</span>
      ${r.isFolder ? '<div class="note">Dự án · số liệu tổng hợp từ các sản phẩm</div>' : ''}
      ${kids && kids !== r.childCount ? `<div class="note">hiện ${kids}/${r.childCount} sản phẩm</div>` : ''}
      ${r.scheduledParentId !== r.parentId ? '<div class="note">Chuyển sang dự án khác (đã lên lịch)</div>' : ''}</td>
    <td>${platformIcons(r.platforms ?? [])}</td>
    <td>${lifecycleBadge(r.status, r.statusLabel)}${r.pending ? `<div class="note">${esc(r.pending.label)} từ ${formatDate(r.pending.date)}</div>` : ''}</td>
    <td>${r.isFolder ? '<span class="muted">—</span>' : esc(r.phaseLabel ?? '—')}</td>
    <td class="r"><span class="avatars">${r.members.map((m) => `<span class="avatar" data-tip="${esc(`${m.name} · ${formatNumber(m.effortPct)}%`)}">${esc(initials(m.name))}</span>`).join('')}</span>
      <div class="note">FTE ${formatNumber(r.fte, 1)}</div></td>
    <td class="r">${formatVnd(r.monthlyCost)}</td>
    <td class="r">${formatPct(r.teamPct)}</td>
    <td>${r.isFolder ? folderScore(r) : `${statusBadge(r.scoreStatus, r.score)}${coverageNote(r.scoreUsed, r.scoreTotal) ? `<div class="note">${coverageNote(r.scoreUsed, r.scoreTotal)}</div>` : ''}`}</td>
    <td>${r.stopLoss ? stopLossBadge(r.stopLoss.status, r.stopLoss.statusLabel, { href: `#/projects/${r.id}/overview?section=stoploss` }) : '—'}</td>
    <td>${r.connections == null ? '<span class="muted">—</span>' : `<span class="conn-icons">${r.connections.map((c) => `<span class="conn-icon ${c.status}" data-tip="${esc(`${c.name}: ${CONN_STATUS[c.status]}`)}">${CONN_SHORT[c.source]}</span>`).join('')}</span>`}</td>
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
    root.querySelectorAll('[data-collapse]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = Number(b.dataset.collapse);
      branches.set(id, !branches.isOpen(id));
      turned = id;
      draw();
      turned = null;
      root.querySelector(`[data-collapse="${id}"]`)?.focus();
    }));
    // A Dự án name opens its Trang tổng hợp (not the edit page of the row) and expands its products.
    root.querySelectorAll('[data-branch-open]').forEach((a) => a.addEventListener('click', (e) => {
      e.stopPropagation();
      branches.set(Number(a.dataset.branchOpen), true);
      navBranches.set(Number(a.dataset.branchOpen), true);
    }));
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
      if (e.target.closest('.row-menu, [data-collapse], [data-branch-open]')) return;
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
        project: r, action: a.action, label: a.label, status: r.pending?.status ?? r.status, latestDate: r.pending?.date, childCount: r.childCount,
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

/** Điểm tổng hợp of a Dự án: "Chưa có điểm" when no child can be scored, else the score and how many children count. */
function folderScore(r) {
  if (r.score == null) return '<span class="badge neutral">○ Chưa có điểm</span>';
  return `${statusBadge(r.scoreStatus, r.score)}<div class="note">Tổng hợp ${r.scoreUsed}/${r.scoreTotal} sản phẩm</div>`;
}
