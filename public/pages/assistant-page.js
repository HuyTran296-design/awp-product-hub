// Trợ lý: a chat box (like ChatGPT / Gemini / Claude). Each question ("Doanh thu Zen Bell hôm nay") becomes a section
// above the box with live numbers from the Dashboard API; the user can remove any section.
// Questions are read by shared/assistant-intent.js (keyword rules, no AI service). Only the question texts are kept,
// per user in this browser, so the numbers are fetched again on each visit.

import { get } from '../api.js';
import { delta, esc, formatMetric, formatTarget, profitBadge, statusBadge, statusShape } from '../ui.js';
import { formatDate, formatVnd } from '/shared/format.js';
import { metricLabel, parseQuestion, PERIOD_PHRASES } from '/shared/assistant-intent.js';

const PLACEHOLDER = 'Bạn muốn xem thông tin gì hôm nay?';
const SUGGESTIONS = ['Doanh thu Zen Bell hôm nay', 'Lãi/lỗ Zell App tháng này', 'DAU Mindfulness Bell tuần này', 'Tổng quan team quý này'];
const MONEY = new Set(['revenue', 'cost', 'profit', 'score']);

const storageKey = (user) => `awp-assistant:${user.id}`;
function loadSections(user) {
  try { return JSON.parse(localStorage.getItem(storageKey(user)) ?? '[]').filter((s) => s?.id && s?.text); } catch { return []; }
}
function saveSections(user, sections) {
  try { localStorage.setItem(storageKey(user), JSON.stringify(sections)); } catch { /* storage unavailable */ }
}

export async function render(root, ctx) {
  const { user, meta } = ctx.state;
  const projects = meta.projects;
  let sections = loadSections(user);
  const cache = new Map(); // period -> Dashboard payload (one fetch per period per visit)
  const dashboard = (period) => {
    if (!cache.has(period)) cache.set(period, get(`/api/dashboard?period=${period}`));
    return cache.get(period);
  };

  root.innerHTML = `<div class="assistant">
    ${ctx.pageHeader({ title: 'Trợ lý', crumb: 'Hỏi nhanh số liệu bằng câu tự nhiên' })}
    <div class="assistant-feed" id="assistant-feed" aria-live="polite"></div>
    <div class="assistant-dock">
      <div class="assistant-reply" id="assistant-reply" role="status"></div>
      <form class="assistant-box" id="assistant-form">
        <label class="sr-only" for="assistant-input">Câu hỏi cho Trợ lý</label>
        <textarea id="assistant-input" rows="1" placeholder="${PLACEHOLDER}" autocomplete="off"></textarea>
        <button class="assistant-send" type="submit" aria-label="Gửi câu hỏi" disabled>↑</button>
      </form>
      <div class="note assistant-hint">Enter để gửi · Shift + Enter xuống dòng · Số liệu lấy từ Dashboard, trong phạm vi bạn được xem</div>
    </div>
  </div>`;
  const feed = root.querySelector('#assistant-feed');
  const reply = root.querySelector('#assistant-reply');
  const form = root.querySelector('#assistant-form');
  const input = form.querySelector('textarea');
  const send = form.querySelector('button');

  const grow = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    send.disabled = !input.value.trim();
  };

  const emptyState = () => `<div class="assistant-empty">
    <div class="assistant-hello">Xin chào ${esc(user.name.split(' ').pop())},<br>${PLACEHOLDER}</div>
    <div class="chips assistant-suggest">${SUGGESTIONS.map((s) => `<button type="button" class="chip-btn" data-ask="${esc(s)}">${esc(s)}</button>`).join('')}</div>
  </div>`;

  const shell = (s) => `<section class="card assistant-section" data-section="${esc(s.id)}" aria-busy="true">
    <div class="card-head"><div><h2>…</h2><div class="sub">Bạn hỏi: “${esc(s.text)}”</div></div>${removeButton(s, s.text)}</div>
    <div class="assistant-body"><div class="muted small">Đang lấy số liệu…</div></div></section>`;

  async function fill(s) {
    const el = feed.querySelector(`[data-section="${CSS.escape(s.id)}"]`);
    if (!el) return;
    const intent = parseQuestion(s.text, projects);
    try {
      const html = intent ? sectionHtml(s, intent, await dashboard(intent.period ?? ctx.state.period))
        : `<div class="card-head"><div><h2>Không hiểu câu hỏi</h2><div class="sub">Bạn hỏi: “${esc(s.text)}”</div></div>${removeButton(s, s.text)}</div>`;
      if (!ctx.isCurrent() || !el.isConnected) return;
      el.innerHTML = html;
    } catch (err) {
      if (!el.isConnected) return;
      el.querySelector('.assistant-body').innerHTML = `<div class="alert error">Không tải được số liệu: ${esc(err.message)}</div>`;
    }
    el.removeAttribute('aria-busy');
  }

  function drawFeed() {
    feed.innerHTML = sections.length ? sections.map(shell).join('') : emptyState();
    sections.forEach(fill);
  }

  function ask(text) {
    const q = text.trim();
    if (!q) return;
    if (!parseQuestion(q, projects)) {
      reply.innerHTML = `<div class="assistant-bubble">Mình chưa hiểu “${esc(q)}”. Hãy nêu chỉ số (doanh thu, chi phí, lãi/lỗ, điểm, DAU, lượt tải…),
        dự án / sản phẩm và khoảng thời gian (hôm nay, tuần, tháng, quý, năm). Ví dụ: ${SUGGESTIONS.slice(0, 3).map((x) =>
          `<button type="button" class="link-btn" data-ask="${esc(x)}">${esc(x)}</button>`).join(', ')}.</div>`;
      return;
    }
    reply.innerHTML = '';
    const s = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text: q };
    sections.push(s);
    saveSections(user, sections);
    if (sections.length === 1) feed.innerHTML = '';
    feed.insertAdjacentHTML('beforeend', shell(s));
    fill(s).then(() => feed.querySelector(`[data-section="${CSS.escape(s.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    input.value = '';
    grow();
  }

  function remove(id) {
    const i = sections.findIndex((s) => s.id === id);
    if (i < 0) return;
    sections.splice(i, 1);
    saveSections(user, sections);
    feed.querySelector(`[data-section="${CSS.escape(id)}"]`)?.remove();
    if (!sections.length) feed.innerHTML = emptyState();
    // Keep keyboard users in place: focus the next section's remove button, else the chat box.
    (feed.querySelectorAll('[data-remove]')[Math.min(i, sections.length - 1)] ?? input).focus();
  }

  root.addEventListener('click', (e) => {
    const askBtn = e.target.closest('[data-ask]');
    if (askBtn) { ask(askBtn.dataset.ask); return; }
    const rm = e.target.closest('[data-remove]');
    if (rm) remove(rm.dataset.remove);
  });
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); ask(input.value); });

  drawFeed();
  input.focus();
}

function removeButton(s, title) {
  return `<button type="button" class="icon-btn assistant-remove" data-remove="${esc(s.id)}" aria-label="Xóa mục ${esc(title)}" data-tip="Xóa mục này">✕</button>`;
}

/** Title + tiles: one tile per (target × metric). Team-wide score / baselines list each project instead. */
function sectionHtml(s, intent, data) {
  const { range } = data;
  const rows = new Map();
  for (const r of data.rows) {
    rows.set(r.id, r);
    for (const c of r.children ?? []) rows.set(c.id, c);
  }
  const picked = intent.projectIds.map((id) => rows.get(id)).filter(Boolean);
  const names = picked.map((r) => r.name);
  if (intent.team) names.unshift(data.scoped ? 'phạm vi bạn được xem' : 'toàn team');
  const title = `${intent.metrics.length > 3 ? 'Tổng quan' : intent.metrics.map(metricLabel).join(', ')} ${names.join(', ')} ${PERIOD_PHRASES[range.period] ?? range.label}`;
  const when = range.from === range.to ? `Ngày ${formatDate(range.to)} · ngày` : `${formatDate(range.from)} – ${formatDate(range.to)} · ${range.label.toLowerCase()}`;

  const tiles = [];
  for (const metric of intent.metrics) {
    const baseline = !MONEY.has(metric);
    if (intent.team) {
      if (metric === 'score' || baseline) {
        // No team-wide value: one tile per product that has it.
        const all = [...rows.values()].filter((r) => (baseline ? !r.isFolder && r.baselines?.some((b) => b.metricKey === metric) : r.parentId == null || !rows.has(r.parentId)));
        all.forEach((r) => tiles.push(tile(r, metric, intent.metrics.length > 1)));
      } else {
        tiles.push(teamTile(data.team, metric, data.scoped, intent.metrics.length > 1));
      }
    }
    for (const r of picked) {
      if (baseline && r.isFolder) (r.children ?? []).forEach((c) => tiles.push(tile(c, metric, intent.metrics.length > 1)));
      else tiles.push(tile(r, metric, intent.metrics.length > 1));
    }
  }
  return `<div class="card-head"><div><h2>${esc(title.replace(/\s+/g, ' ').trim().replace(/^./, (c) => c.toUpperCase()))}</h2>
      <div class="sub">${esc(when)} gần nhất có đủ dữ liệu · Bạn hỏi: “${esc(s.text)}”</div></div>
      ${removeButton(s, title)}</div>
    <div class="assistant-body">${tiles.length ? `<div class="assistant-tiles">${tiles.join('')}</div>`
      : '<div class="muted">Không có số liệu cho câu hỏi này trong phạm vi bạn được xem.</div>'}</div>`;
}

function teamTile(team, metric, scoped, showMetric) {
  const name = scoped ? 'Phạm vi bạn được xem' : 'Toàn team';
  const value = { revenue: team.revenue, cost: team.cost, profit: team.profit }[metric];
  const foot = metric === 'revenue' ? delta(team.revenueDelta) : metric === 'profit' ? `${profitBadge(team.profit)} ${delta(team.profitDelta)}` : '';
  return tileHtml({ name, color: 'var(--text)', label: showMetric ? metricLabel(metric) : '', value: formatVnd(value), foot, href: '#/dashboard' });
}

function tile(r, metric, showMetric) {
  const base = { name: r.name, color: r.color, label: showMetric ? metricLabel(metric) : '', href: `#/projects/${r.id}/overview` };
  if (metric === 'revenue') return tileHtml({ ...base, value: formatVnd(r.revenue), foot: delta(r.revenueDelta) });
  if (metric === 'cost') return tileHtml({ ...base, value: formatVnd(r.cost) });
  if (metric === 'profit') return tileHtml({ ...base, value: formatVnd(r.profit), foot: `${profitBadge(r.profit)} ${delta(r.profitDelta)}` });
  if (metric === 'score') {
    return tileHtml({ ...base, value: r.score == null ? '—' : `${Math.round(r.score)}%`, foot: r.score == null ? '<span class="muted small">Chưa có điểm</span>' : statusBadge(r.status) });
  }
  const b = r.baselines?.find((x) => x.metricKey === metric);
  if (!b) return tileHtml({ ...base, label: metricLabel(metric), value: '—', foot: '<span class="muted small">Sản phẩm không theo dõi chỉ số này</span>' });
  return tileHtml({
    ...base,
    label: b.short,
    value: b.actual == null ? '—' : formatMetric(b.actual, b.unit),
    foot: `${statusShape(b.status)} ${b.target == null ? '' : `<span class="muted small">Mục tiêu ${formatTarget(b.target, b.unit, b.direction)}</span>`} ${delta(b.delta, { direction: b.direction })}`,
  });
}

function tileHtml({ name, color, label, value, foot = '', href }) {
  return `<a class="assistant-tile" href="${href}">
    <div class="assistant-tile-name"><span class="dot" style="background:${esc(color)}"></span>${esc(name)}${label ? ` <span class="muted">· ${esc(label)}</span>` : ''}</div>
    <div class="kpi-value num">${value}</div>
    <div class="kpi-foot">${foot}</div></a>`;
}
