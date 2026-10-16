// Small UI helpers: escaping, status/profit badges, deltas, value formatting, toasts, modal, tooltip.

import {
  formatDate, formatDateTime, formatDuration, formatNumber, formatPct, formatVnd,
} from '/shared/format.js';
import { ACHIEVEMENT_CAP, DEFAULT_THRESHOLDS, STATUS_LABELS } from '/shared/health-score.js';
import { getMetricDef } from '/shared/metric-catalog.js';

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const sampleTag = () => '<span class="sample-tag" title="Số liệu sinh từ MockDataSource">Dữ liệu mẫu</span>';

export function statusShape(status) {
  return status ? `<i class="shape ${status}" aria-hidden="true"></i>` : '';
}

/** "● Tốt · 99%" — color always paired with a label and a shape. */
export function statusBadge(status, score, { large = false, text, tip } = {}) {
  if (!status) return `<span class="badge neutral${large ? ' lg' : ''}">Đang thu thập dữ liệu</span>`;
  const s = text ?? (score != null ? ` · ${formatPct(score, 0)}` : '');
  const t = tip ? ` tabindex="0" data-tip="${esc(tip)}"` : '';
  return `<span class="badge ${status}${large ? ' lg' : ''}"${t}>${statusShape(status)}${STATUS_LABELS[status]}${s}</span>`;
}

/** "Tính trên 2/3 baseline" when only part of the baselines has data; '' otherwise. */
export function coverageNote(used, total) {
  return used && used < total ? `Tính trên ${used}/${total} baseline` : '';
}

export function thresholdText(th = DEFAULT_THRESHOLDS) {
  return `Tốt > ${formatNumber(th.green)}%, Cần chú ý ${formatNumber(th.red)}–${formatNumber(th.green)}%, Báo động < ${formatNumber(th.red)}%`;
}

/** Plain value for formulas: money/counts without unit, others in their unit. */
function formulaValue(v, unit) {
  return unit === 'vnd' || unit === 'count' ? formatNumber(v) : formatMetric(v, unit);
}

/** "Đạt 113,6% mục tiêu = 2.272.400 ÷ 2.000.000. Ngưỡng: …" (lower-is-better divides target by actual). */
export function achievementTip(b, thresholds) {
  if (b.pct == null) return '';
  const [num, den] = b.direction === 'lower' ? [b.target, b.actual] : [b.actual, b.target];
  const cap = b.pct >= ACHIEVEMENT_CAP ? ` (tối đa ${ACHIEVEMENT_CAP}%)` : '';
  return `Đạt ${formatPct(b.pct)} mục tiêu${cap} = ${formulaValue(num, b.unit)} ÷ ${formulaValue(den, b.unit)}. Ngưỡng: ${thresholdText(thresholds)}.`;
}

/** "Còn thiếu 580 người" when the period target is not reached yet; '' otherwise. */
export function shortfallText(b) {
  if (b.actual == null || b.target == null) return '';
  const gap = b.direction === 'lower' ? b.actual - b.target : b.target - b.actual;
  if (!(gap > 1e-9)) return '';
  const noun = getMetricDef(b.metricKey)?.noun;
  const amount = {
    vnd: () => formatVnd(Math.ceil(gap)),
    count: () => `${formatNumber(Math.ceil(gap))}${noun ? ` ${noun}` : ''}`,
    pct: () => `${formatNumber(gap, 1)} điểm %`,
    seconds: () => formatDuration(gap),
    minutes: () => `${formatNumber(gap, 1)} phút`,
    rating: () => `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(gap)} điểm`,
  }[b.unit]?.() ?? formatNumber(gap);
  return b.direction === 'lower' ? `Cần giảm thêm ${amount}` : `Còn thiếu ${amount}`;
}

/** Caption-style change: "▲ 4,1% so với kỳ trước" in muted text, only the arrow colored (inverted for lower-is-better). */
export function deltaCaption(change, direction = 'higher') {
  if (change == null || Number.isNaN(change)) return '<span class="delta-caption">— so với kỳ trước</span>';
  if (Math.abs(change) < 0.05) return `<span class="delta-caption"><span class="arrow">■</span> 0,0% so với kỳ trước</span>`;
  const up = change > 0;
  const good = up === (direction !== 'lower');
  return `<span class="delta-caption"><span class="arrow ${good ? 'good' : 'bad'}">${up ? '▲' : '▼'}</span> ${formatPct(Math.abs(change))} so với kỳ trước</span>`;
}

export function profitBadge(profit, { large = false } = {}) {
  if (profit == null) return '';
  const win = profit >= 0;
  return `<span class="badge ${win ? 'green' : 'red'}${large ? ' lg' : ''}">${win ? '▲ Lời' : '▼ Lỗ'}</span>`;
}

/**
 * ▲/▼ change vs previous period. `direction` decides good/bad coloring ('higher'|'lower'|'neutral').
 * points=true renders percentage-point change ("điểm %").
 */
export function delta(change, { direction = 'higher', points = false } = {}) {
  if (change == null || Number.isNaN(change)) {
    return '<span class="delta na" title="Kỳ trước chưa đủ dữ liệu">— so kỳ trước</span>';
  }
  const flat = Math.abs(change) < 0.05;
  const up = change > 0;
  const cls = flat || direction === 'neutral' ? 'flat' : (up === (direction === 'higher') ? 'good' : 'bad');
  const arrow = flat ? '■' : up ? '▲' : '▼';
  const txt = points ? `${formatNumber(Math.abs(change), 1)} điểm %` : formatPct(Math.abs(change));
  return `<span class="delta ${cls}">${arrow} ${txt}</span>`;
}

/** Format a metric value by catalog unit. */
export function formatMetric(value, unit) {
  if (value == null) return '—';
  switch (unit) {
    case 'vnd': return formatVnd(value);
    case 'pct': return formatPct(value);
    case 'seconds': return formatDuration(value);
    case 'minutes': return `${formatNumber(value, 1)} phút`;
    case 'rating': return new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(value);
    default: return formatNumber(value);
  }
}

export function formatTarget(value, unit, direction) {
  return `${direction === 'lower' ? '≤ ' : ''}${formatMetric(value, unit)}`;
}

export const PLATFORM_LABELS = { ios: 'iOS', android: 'Android', web: 'Website', playables: 'YouTube Playables', blog: 'Blog' };
export const PLATFORM_COLORS = { ios: 'var(--ios)', android: 'var(--android)', web: 'var(--web)', playables: 'var(--playables)', blog: 'var(--muted)' };

export function platformTags(platforms) {
  return platforms.map((p) => `<span class="platform-tag"><i style="background:${PLATFORM_COLORS[p]}"></i>${PLATFORM_LABELS[p] ?? p}</span>`).join('');
}

/** Compact platform icons for tables: colored letter chips with a tooltip. */
export function platformIcons(platforms) {
  const short = { ios: 'iOS', android: 'And', web: 'Web', playables: 'YTP' };
  return `<span class="plat-icons">${platforms.filter((p) => short[p]).map((p) =>
    `<span class="plat-icon" style="background:${PLATFORM_COLORS[p]}" data-tip="${PLATFORM_LABELS[p]}" aria-label="${PLATFORM_LABELS[p]}">${short[p]}</span>`).join('')}</span>`;
}

export function rangeInfo(range) {
  if (!range) return '';
  return `<div class="range-info">
    <span>Kỳ: <b>${formatDate(range.from)} – ${formatDate(range.to)}</b>${range.days > 1 ? ` <span class="muted">· ${range.days} ngày gần nhất có đủ dữ liệu</span>` : ''}</span>
    <span>So với: ${formatDate(range.prevFrom)} – ${formatDate(range.prevTo)}</span>
    <span>Cập nhật lần cuối: <b>${formatDateTime(range.lastUpdated)}</b></span>
    ${sampleTag()}
  </div>`;
}

/** Parse "25.000.000" / "25000000" -> 25000000 (VND inputs). */
export function parseVnd(text) {
  const digits = String(text ?? '').replace(/[^\d-]/g, '');
  return digits === '' || digits === '-' ? NaN : Number(digits);
}

/** Parse decimals typed with a Vietnamese comma ("18,6") or dot. */
export function parseDecimal(text) {
  const s = String(text ?? '').trim().replace(/\s/g, '');
  if (!s) return NaN;
  // "1.234,5" -> 1234.5 ; "18,6" -> 18.6 ; "18.6" -> 18.6
  if (s.includes(',')) return Number(s.replace(/\./g, '').replace(',', '.'));
  return Number(s);
}

export function toast(message, type = 'info') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  box.append(el);
  setTimeout(() => el.remove(), 4200);
}

/** Simple modal; returns { el, close }. `body` is trusted HTML built by the caller with esc(). */
export function openModal(title, body, { onSubmit, submitLabel = 'Lưu' } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<form class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <h2>${esc(title)}</h2>${body}
    <div class="form-error"></div>
    <div class="modal-actions"><button type="button" class="btn" data-close>Hủy</button>
    <button type="submit" class="btn primary">${esc(submitLabel)}</button></div></form>`;
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop || e.target.closest('[data-close]')) close(); });
  backdrop.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  backdrop.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await onSubmit?.(new FormData(e.target), backdrop);
      close();
    } catch (err) {
      backdrop.querySelector('.form-error').innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });
  document.body.append(backdrop);
  backdrop.querySelector('input, select, button')?.focus();
  return { el: backdrop, close };
}

/** Global tooltip for any element with data-tip (plain text, newline-separated). */
export function installTooltip() {
  const tip = document.getElementById('tooltip');
  const show = (target, x, y) => {
    tip.textContent = target.getAttribute('data-tip');
    tip.hidden = false;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const left = Math.min(window.innerWidth - w - 8, Math.max(8, x + 14));
    const top = y - h - 12 < 8 ? y + 16 : y - h - 12;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };
  document.addEventListener('pointermove', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (t) show(t, e.clientX, e.clientY);
    else tip.hidden = true;
  });
  document.addEventListener('focusin', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (!t) return;
    const r = t.getBoundingClientRect();
    show(t, r.left + r.width / 2, r.top);
  });
  document.addEventListener('focusout', () => { tip.hidden = true; });
  document.addEventListener('scroll', () => { tip.hidden = true; }, true);
}

/** Project lifecycle badge — always text + glyph, never color alone. */
export function lifecycleBadge(status, label) {
  if (!status) return '';
  const glyph = { active: '▶', paused: '❚❚', draft: '✎', archived: '▣', deleted: '✕' }[status] ?? '';
  return `<span class="badge lc-${status}">${glyph} ${esc(label)}</span>`;
}

/**
 * In-page confirmation dialog (no browser dialogs). Resolves true on confirm, false on cancel/Escape.
 * `body` is trusted HTML built with esc().
 */
export function confirmDialog({ title, body = '', confirmLabel = 'Xác nhận', cancelLabel = 'Hủy', danger = false }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `<div class="modal" role="alertdialog" aria-modal="true" aria-label="${esc(title)}">
      <h2>${esc(title)}</h2>${body}
      <div class="modal-actions"><button type="button" class="btn" data-no>${esc(cancelLabel)}</button>
      <button type="button" class="btn ${danger ? 'danger-solid' : 'primary'}" data-yes>${esc(confirmLabel)}</button></div></div>`;
    const done = (v) => { backdrop.remove(); resolve(v); };
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop || e.target.closest('[data-no]')) done(false);
      if (e.target.closest('[data-yes]')) done(true);
    });
    backdrop.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(false); });
    document.body.append(backdrop);
    backdrop.querySelector('[data-yes]').focus();
  });
}

/** Options for "Hiệu lực từ tháng": current (open) month and the next 12 months. */
export function monthOptions(firstOpenDate, selected, count = 13) {
  const [y, m] = firstOpenDate.split('-').map(Number);
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(y, m - 1 + i, 1);
    const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    out.push(`<option value="${v}" ${v === selected ? 'selected' : ''}>Tháng ${d.getMonth() + 1}/${d.getFullYear()}</option>`);
  }
  return out.join('');
}

export function initials(name) {
  const parts = String(name).trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ''}${parts.length > 1 ? parts[parts.length - 1][0] : ''}`.toUpperCase();
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** Stop-loss status badge — text + glyph, never color alone. */
export function stopLossBadge(status, label, { href } = {}) {
  if (!status) return '';
  const cls = { off: 'neutral', safe: 'neutral', warning: 'yellow', triggered: 'red', handled: 'lc-paused' }[status];
  const glyph = { off: '○', safe: '✓', warning: '▲', triggered: '■', handled: '✔' }[status];
  const attrs = href ? ` role="link" tabindex="0" data-href="${esc(href)}" style="cursor:pointer"` : '';
  return `<span class="badge ${cls}"${attrs}>${glyph} ${esc(label)}</span>`;
}

/** Breadcrumb "Dashboard / ABC Game Studio / Game A · Tổng quan" (the parent is a link). */
export function projectCrumb(p, page) {
  const parent = p.parentId ? `<a href="#/projects/${p.parentId}/overview">${esc(p.parentName ?? '')}</a> / ` : '';
  return `<a href="#/dashboard">Dashboard</a> / ${parent}${p.parentId ? esc(p.name) : `<a href="#/projects/${p.id}/overview">${esc(p.name)}</a>`} · ${esc(page)}`;
}

/** Products of a Dự án by status: "1 Tốt · 1 Đang xây dựng". */
const COUNT_LABELS = { green: 'Tốt', yellow: 'Cần chú ý', red: 'Báo động', build: 'Đang xây dựng', paused: 'Tạm dừng', none: 'Chưa có điểm' };
export function childCountsText(counts = {}) {
  return Object.entries(counts).map(([k, n]) => `${n} ${COUNT_LABELS[k] ?? k}`).join(' · ');
}

/**
 * Expand/collapse button of a Dự án row in the trees (sidebar, Dashboard, Quản lý dự án & sản phẩm).
 * It only opens/closes the product list — the Dự án name next to it is the link to its Trang tổng hợp.
 * `turned` plays the 90° chevron turn once (the row is re-rendered after each toggle).
 */
export function branchToggle({ id, name, open, attr, turned = false }) {
  return `<button type="button" class="branch-toggle${turned ? ' turned' : ''}" ${attr}="${id}" aria-expanded="${open}"
    aria-label="${open ? 'Thu gọn' : 'Mở'} danh sách sản phẩm của ${esc(name)}"><svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"
    focusable="false"><path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
}

/** Open/closed Dự án branches of one tree, remembered for the browser session (sessionStorage). */
export function branchState(tree, defaultOpen) {
  const key = (id) => `awp-tree-${tree}-${id}`;
  return {
    isOpen(id) {
      try { const v = sessionStorage.getItem(key(id)); return v == null ? defaultOpen : v === '1'; } catch { return defaultOpen; }
    },
    set(id, open) {
      try { sessionStorage.setItem(key(id), open ? '1' : '0'); } catch { /* storage unavailable: state lasts until reload */ }
    },
  };
}
