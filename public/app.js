// App shell: session, sidebar menu, hash router, shared period filter, theme switch,
// and an unsaved-changes guard that asks with an in-page dialog before leaving a page.

import { get, post, del } from './api.js';
import { branchState, branchToggle, confirmDialog, esc, initials, installTooltip, rangeInfo } from './ui.js';
import { DEFAULT_PERIOD, PERIODS } from '/shared/periods.js';
import * as dashboardPage from './pages/dashboard-page.js';
import * as overviewPage from './pages/project-overview-page.js';
import * as marketingPage from './pages/project-marketing-page.js';
import * as projectsListPage from './pages/projects-list-page.js';
import * as projectWizardPage from './pages/project-wizard-page.js';
import * as projectEditPage from './pages/project-edit-page.js';
import * as teamCostsPage from './pages/team-costs-page.js';
import * as membersConfigPage from './pages/config-members-page.js';
import * as usersPage from './pages/users-page.js';

const ROUTES = [
  { re: /^\/dashboard$/, page: dashboardPage },
  { re: /^\/projects\/(\d+)\/overview$/, page: overviewPage },
  { re: /^\/projects\/(\d+)\/marketing$/, page: marketingPage },
  { re: /^\/config\/projects$/, page: projectsListPage, admin: true, nav: '/config/projects' },
  { re: /^\/config\/projects\/new$/, page: projectWizardPage, admin: true, nav: '/config/projects/new' },
  { re: /^\/config\/products\/new$/, page: projectWizardPage, admin: true, nav: '/config/products/new' },
  { re: /^\/config\/projects\/(\d+)$/, page: projectEditPage, admin: true, nav: '/config/projects' },
  { re: /^\/config\/team-costs$/, page: teamCostsPage, admin: true },
  { re: /^\/config\/members$/, page: membersConfigPage, admin: true },
  { re: /^\/config\/users$/, page: usersPage, admin: true },
];

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  remove(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};

const THEMES = [['light', '☀\uFE0E', 'Sáng'], ['dark', '☾\uFE0E', 'Tối'], ['auto', '◐\uFE0E', 'Tự động theo máy']];

/** The period filter lasts one sign-in: every login / logout starts again from "Tháng". The theme is kept. */
function resetSessionPrefs() {
  store.remove('awp-period');
  state.period = DEFAULT_PERIOD;
}

const state = {
  user: null,
  meta: null,
  period: PERIODS.some((p) => p.key === store.get('awp-period')) ? store.get('awp-period') : DEFAULT_PERIOD,
  theme: store.get('awp-theme', 'light'),
};

const appEl = document.getElementById('app');
let renderToken = 0;
let guard = null; // () => boolean — true when the current page has unsaved changes
let leaveHandlers = [];
let lastHash = location.hash;
let suppressHashChange = false;
const navTree = branchState('nav', true);
let navAutoOpened = null; // product whose Dự án was last opened automatically
let navTurned = null;     // branch whose chevron should play its turn on the next render

/** Parse "#/config/projects/2?tab=staffing" -> { path, query } */
function currentRoute() {
  const raw = location.hash.slice(1) || '/dashboard';
  const [path, qs] = raw.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

function navigate(hash) {
  if (location.hash === hash) renderPage();
  else location.hash = hash;
}

async function refreshMeta() {
  state.meta = await get('/api/meta');
  renderSidebar();
}

/** Route changes pass through the unsaved-changes guard (in-page dialog, never a browser prompt). */
async function onHashChange(e) {
  if (suppressHashChange) { suppressHashChange = false; return; }
  if (guard?.()) {
    const target = location.hash;
    suppressHashChange = true;
    // oldURL also reflects in-page history.replaceState() (e.g. tab switches), unlike a cached hash.
    location.hash = e?.oldURL ? new URL(e.oldURL).hash : lastHash;
    const ok = await confirmDialog({ title: 'Rời trang khi chưa lưu?', body: '<p>Các thay đổi chưa lưu trên trang này sẽ bị mất.</p>',
      confirmLabel: 'Rời trang', cancelLabel: 'Ở lại', danger: true });
    if (!ok) return;
    guard = null;
    location.hash = target;
    return;
  }
  renderPage();
}

async function boot() {
  installTooltip();
  // Badges with data-href (inside clickable rows/cards) navigate on their own, in the capture phase.
  const follow = (e) => {
    const t = e.target.closest?.('[data-href]');
    if (!t || (e.type === 'keydown' && e.key !== 'Enter')) return;
    e.preventDefault();
    e.stopPropagation();
    navigate(t.dataset.href);
  };
  document.addEventListener('click', follow, true);
  document.addEventListener('keydown', follow, true);
  window.addEventListener('awp:unauthorized', () => { state.user = null; renderLogin(); });
  const invite = location.hash.match(/^#\/invite\/([a-f0-9]+)$/);
  if (invite) return renderInvite(invite[1]);
  const s = await get('/api/session');
  if (!s.user) return renderLogin();
  state.user = s.user;
  state.meta = await get('/api/meta');
  window.addEventListener('hashchange', onHashChange);
  // Closing/reloading the tab can only be guarded by the browser's own prompt.
  window.addEventListener('beforeunload', (e) => { if (guard?.()) e.preventDefault(); });
  renderPage();
}

const SAMPLE_ACCOUNTS = [
  ['khanh.mai@abcdigital.io', 'Admin'],
  ['huy.tran@abcdigital.io', 'Viewer · tất cả dự án & sản phẩm'],
  ['quan.do@abcdigital.io', 'Viewer · chỉ sản phẩm Zen Bell'],
  ['thanh.chau@abcdigital.io', 'Viewer · dự án Zell App'],
];

function brandHtml() {
  return '<div class="brand"><div class="brand-mark">AWP</div><div><div class="brand-name">AWP Product Hub</div><div class="brand-sub">ABC Digital</div></div></div>';
}

/** Email sign-in (prototype: no password). */
function renderLogin(message = '') {
  appEl.innerHTML = `<div class="login"><form class="card" novalidate>
    ${brandHtml()}
    <h1>Đăng nhập</h1>
    ${message ? `<div class="alert info">${esc(message)}</div>` : ''}
    <label class="field"><span>Email</span><input class="input" type="email" name="email" autocomplete="email" required placeholder="ten@abcdigital.io"></label>
    <div data-error></div>
    <button class="btn primary" type="submit">Đăng nhập</button>
    <div class="note">Prototype — tài khoản mẫu (bấm để điền):</div>
    <div class="stack" style="gap:6px">${SAMPLE_ACCOUNTS.map(([email, role]) =>
      `<button type="button" class="btn sm" data-email="${email}" style="justify-content:space-between">${email}<span class="muted">${role}</span></button>`).join('')}</div>
  </form></div>`;
  const form = appEl.querySelector('form');
  appEl.querySelectorAll('[data-email]').forEach((b) => b.addEventListener('click', () => { form.email.value = b.dataset.email; form.email.focus(); }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await post('/api/session', { email: form.email.value });
      resetSessionPrefs();
      location.hash = '#/dashboard';
      location.reload();
    } catch (err) {
      form.querySelector('[data-error]').innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });
  form.email.focus();
}

/** Invite link: activate the account, then enter the app. */
async function renderInvite(token) {
  try {
    const r = await post('/api/invite/accept', { token });
    resetSessionPrefs();
    location.hash = '#/dashboard';
    location.reload();
    return r;
  } catch (err) {
    renderLogin(err.message);
  }
}

function renderShell() {
  if (document.getElementById('main')) return renderSidebar();
  appEl.innerHTML = `<div class="shell"><aside class="sidebar" id="sidebar"></aside>
    <div class="content"><header class="topbar" id="topbar"></header><main class="main" id="main"></main></div></div>`;
  renderSidebar();
  renderTopbar();
}

function renderSidebar() {
  const { path } = currentRoute();
  const navPath = ROUTES.find((r) => r.re.test(path))?.nav ?? path;
  const isAdmin = state.user.role === 'admin';
  const link = (href, label, extra = '') => `<a href="#${href}" class="${navPath === href ? 'active' : ''} ${extra}">${label}</a>`;
  // One tree "DỰ ÁN", sorted by name: a Dự án (chevron button + number of products) with its products indented below.
  // A Dự án has one page (Trang tổng hợp), so no sub-pages; the open product shows "Tổng quan · Marketing".
  // The chevron only opens/closes the branch; the Dự án name opens its Trang tổng hợp and its branch.
  // A Viewer scoped to some products of a Dự án sees that Dự án as a plain (non-clickable) group.
  const projects = state.meta.projects;
  const locked = state.meta.lockedParents ?? [];
  const byName = (a, b) => a.name.localeCompare(b.name, 'vi');
  const visibleIds = new Set(projects.map((p) => p.id));
  const kidsOf = (id) => projects.filter((p) => p.parentId === id).sort(byName);
  const roots = [...projects.filter((p) => p.parentId == null || !visibleIds.has(p.parentId)).filter((p) => !locked.some((l) => l.id === p.parentId)),
    ...locked.map((l) => ({ ...l, kind: 'folder', locked: true }))].sort(byName);
  const currentId = Number(path.match(/^\/projects\/(\d+)\//)?.[1]) || null;
  // Viewing a product opens its Dự án once (it can still be collapsed afterwards).
  if (currentId !== navAutoOpened) {
    navAutoOpened = currentId;
    const parentId = projects.find((p) => p.id === currentId)?.parentId;
    if (parentId != null) navTree.set(parentId, true);
  }
  const pages = (p, cls) => (!p.folder && path.startsWith(`/projects/${p.id}/`)
    ? `${link(`/projects/${p.id}/overview`, 'Tổng quan', cls)}${link(`/projects/${p.id}/marketing`, 'Marketing', cls)}` : '');
  const projectLink = (p, child = false) => {
    const folder = p.kind === 'folder';
    const kids = folder ? kidsOf(p.id) : [];
    const open = kids.length > 0 && navTree.isOpen(p.id);
    const toggle = kids.length ? branchToggle({ id: p.id, name: p.name, open, attr: 'data-nav-toggle', turned: navTurned === p.id }) : '';
    const here = path.startsWith(`/projects/${p.id}/`);
    const label = `<span class="dot" style="background:${esc(p.color)}"></span><span class="nav-name">${esc(p.name)}</span>${folder ? ` <span class="note">(${kids.length})</span>` : ''}${p.status === 'paused' ? ' <span class="note">(tạm dừng)</span>' : ''}`;
    return `<div class="nav-project${child ? ' child' : ''}${kids.length ? ' has-kids' : ''}">${toggle}
      ${p.locked ? `<span class="project-link locked">${label}</span>`
        : `<a href="#/projects/${p.id}/overview" class="project-link ${here ? 'active' : ''}"${here ? ' aria-current="page"' : ''}${folder ? ` data-nav-open="${p.id}"` : ''}>${label}</a>`}</div>
      ${pages({ ...p, folder }, child ? 'sub sub2' : 'sub')}
      ${open ? kids.map((k) => projectLink(k, true)).join('') : ''}`;
  };
  const tree = roots.map((p) => projectLink(p)).join('');
  const sidebar = document.getElementById('sidebar');
  const wasOpen = sidebar.classList.contains('open');

  sidebar.innerHTML = `
      <div class="brand"><div class="brand-mark">AWP</div><div style="flex:1"><div class="brand-name">AWP Product Hub</div><div class="brand-sub">ABC Digital</div></div></div>
      <button class="icon-btn menu-toggle" id="menu-toggle" aria-label="Mở menu" aria-expanded="${wasOpen}">☰</button>
      <nav class="nav" aria-label="Menu chính">
        ${link('/dashboard', '▦ Dashboard')}
        <div class="nav-section">Dự án</div>
        ${tree}
        ${isAdmin ? '<a href="#/config/projects/new" class="nav-btn add">＋ Thêm dự án</a><a href="#/config/products/new" class="nav-btn add">＋ Thêm sản phẩm</a>' : ''}
        ${isAdmin ? `<div class="nav-section">Cấu hình</div>
          ${link('/config/projects', 'Quản lý dự án & sản phẩm')}
          ${link('/config/team-costs', 'Chi phí team')}
          ${link('/config/members', 'Nhân sự')}
          ${link('/config/users', 'Người dùng & phân quyền')}` : ''}
      </nav>`;

  document.getElementById('menu-toggle').addEventListener('click', (e) => {
    const open = sidebar.classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', String(open));
  });
  sidebar.querySelector('.nav').addEventListener('click', (e) => { if (e.target.closest('a')) sidebar.classList.remove('open'); });
  // Clicking a Dự án name opens its Trang tổng hợp and its branch; the chevron only opens/closes the branch.
  sidebar.querySelectorAll('[data-nav-open]').forEach((a) => a.addEventListener('click', () => navTree.set(Number(a.dataset.navOpen), true)));
  sidebar.querySelectorAll('[data-nav-toggle]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const id = Number(b.dataset.navToggle);
    navTree.set(id, b.getAttribute('aria-expanded') !== 'true');
    navTurned = id;
    renderSidebar();
    navTurned = null;
    document.querySelector(`[data-nav-toggle="${id}"]`)?.focus();
  }));
}

/** Top bar: account menu (name, role, Đăng xuất) and the prototype "Xem với vai trò…" switch for Admins. */
function renderTopbar() {
  const u = state.user;
  const bar = document.getElementById('topbar');
  const roleLabel = u.role === 'admin' ? 'Admin' : 'Viewer';
  bar.innerHTML = `${u.viewAs ? `<div class="viewas-banner">Đang xem với vai trò <b>${esc(u.viewAs.label)}</b> (prototype)
      <button class="btn sm" data-viewas-reset>Quay lại Admin</button></div>` : '<span></span>'}
    <div class="top-actions">
    <div class="theme-seg" role="group" aria-label="Giao diện">${THEMES.map(([v, icon, label]) =>
      `<button type="button" data-theme-set="${v}" aria-pressed="${state.theme === v}" aria-label="${label}" data-tip="${label}"><span aria-hidden="true">${icon}</span></button>`).join('')}</div>
    <div class="account">
      <button class="account-btn" id="account-btn" aria-haspopup="true" aria-expanded="false">
        <span class="avatar">${esc(initials(u.name))}</span><span><b>${esc(u.name)}</b><span class="note">${roleLabel}${u.viewAs ? ' (xem thử)' : ''}</span></span> ▾</button>
      <div class="menu-pop" id="account-menu" hidden>
        <div style="padding:8px 10px"><b>${esc(u.name)}</b><div class="note">${esc(u.email)} · ${u.realRole === 'admin' ? 'Admin' : 'Viewer'}</div></div>
        ${u.realRole === 'admin' ? `<hr><label class="field" style="padding:4px 10px"><span>Xem với vai trò… <span class="muted">(prototype)</span></span>
          <select class="input" id="view-as"><option value="">Admin (vai trò của tôi)</option><option value="viewer-all" ${u.viewAs && !u.viewAs.userId ? 'selected' : ''}>Viewer · tất cả dự án & sản phẩm</option></select></label>` : ''}
        <hr><button id="logout" type="button">Đăng xuất</button>
      </div>
    </div></div>`;
  bar.querySelectorAll('[data-theme-set]').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.themeSet)));
  const btn = bar.querySelector('#account-btn');
  const menu = bar.querySelector('#account-menu');
  btn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); });
  menu.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => { menu.hidden = true; }, { once: true });
  bar.querySelector('#logout').addEventListener('click', async () => { await del('/api/session'); resetSessionPrefs(); location.hash = ''; location.reload(); });
  const switchTo = async (body) => { await post('/api/view-as', body); location.hash = '#/dashboard'; location.reload(); };
  bar.querySelector('[data-viewas-reset]')?.addEventListener('click', () => switchTo({}));
  const sel = bar.querySelector('#view-as');
  if (sel) {
    get('/api/view-as').then((r) => {
      sel.insertAdjacentHTML('beforeend', r.viewers.filter((v) => v.scope === 'selected').map((v) =>
        `<option value="${v.id}" ${u.viewAs?.userId === v.id ? 'selected' : ''}>Như ${esc(v.name)} (Viewer · phạm vi được chọn)</option>`).join(''));
    });
    sel.addEventListener('change', () => switchTo(sel.value === 'viewer-all' ? { mode: 'viewer-all' } : sel.value ? { userId: Number(sel.value) } : {}));
  }
}

function forbiddenHtml() {
  return `<div class="forbidden card"><div style="font-size:36px" aria-hidden="true">🔒</div><h1>Bạn không có quyền truy cập</h1>
    <p class="muted">Trang này dành cho Admin hoặc nằm ngoài phạm vi dự án / sản phẩm bạn được xem.</p><a class="btn primary" href="#/dashboard">Về Dashboard</a></div>`;
}

function setTheme(theme) {
  state.theme = theme;
  store.set('awp-theme', theme);
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  document.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeSet === theme)));
}

function setPeriod(period) {
  state.period = period;
  store.set('awp-period', period);
  renderPage();
}

/** Page header; dashboard pages also get the shared period filter + range line. */
function pageHeader({ title, crumb = '', range = null, extra = '' }) {
  const filter = range ? `<div class="filter-bar"><div class="seg" role="group" aria-label="Bộ lọc thời gian">${PERIODS.map((p) =>
    `<button type="button" data-period="${p.key}" aria-pressed="${state.period === p.key}">${p.label}</button>`).join('')}</div>
    ${rangeInfo(range)}</div>` : '';
  return `<div class="page-head"><div class="page-title">${crumb ? `<span class="crumb">${crumb}</span>` : ''}<h1>${title}</h1></div>${extra}</div>${filter}`;
}

function bindPageHeader(root) {
  root.querySelectorAll('[data-period]').forEach((b) => b.addEventListener('click', () => setPeriod(b.dataset.period)));
}

async function renderPage() {
  const token = ++renderToken;
  const { path, query } = currentRoute();
  // A Dự án has only its Trang tổng hợp: its Marketing / former children URLs go there.
  const sub = path.match(/^\/projects\/(\d+)\/(marketing|children)$/);
  if (sub && (sub[2] === 'children' || state.meta?.projects.find((p) => p.id === Number(sub[1]))?.kind === 'folder')) {
    history.replaceState(null, '', `#/projects/${sub[1]}/overview`);
    return renderPage();
  }
  const route = ROUTES.find((r) => r.re.test(path));
  if (!route) return navigate('#/dashboard');
  // Leaving the previous page: drop its guard and listeners.
  guard = null;
  leaveHandlers.forEach((fn) => fn());
  leaveHandlers = [];
  lastHash = location.hash;
  renderShell();
  const main = document.getElementById('main');
  if (route.admin && state.user.role !== 'admin') { main.innerHTML = forbiddenHtml(); return; }
  main.classList.add('loading');
  try {
    const params = path.match(route.re).slice(1).map(Number);
    await route.page.render(main, {
      params, query, state, navigate, refreshMeta, pageHeader, bindPageHeader,
      isCurrent: () => token === renderToken,
      setGuard: (fn) => { guard = fn; },
      onLeave: (fn) => leaveHandlers.push(fn),
    });
  } catch (err) {
    if (token !== renderToken) return;
    main.innerHTML = err.status === 403 ? forbiddenHtml() : `<div class="alert error">Không tải được trang: ${esc(err.message)}</div>`;
  } finally {
    if (token === renderToken) main.classList.remove('loading');
  }
}

boot().catch((err) => {
  appEl.innerHTML = `<div class="login"><div class="alert error">Không khởi động được ứng dụng: ${esc(err.message)}</div></div>`;
});
