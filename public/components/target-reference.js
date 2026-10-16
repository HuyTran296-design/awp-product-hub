// "Tham chiếu" block under a baseline's monthly target: 6 closed months (bars) with the typed target as a dashed
// line, reference numbers, suggestion buttons that fill the target, a back-test and a difficulty label (always text).

import { esc, formatMetric } from '../ui.js';
import { formatNumber, formatPct } from '/shared/format.js';
import { backtest, difficulty, suggestions } from '/shared/target-reference.js';

const DIFF_CLASS = { easy: 'neutral', fair: 'green', hard: 'yellow', very_hard: 'red' };
const monthLabel = (ym) => `T${Number(ym.slice(5, 7))}/${ym.slice(0, 4)}`;

/** Bar chart of the closed months + dashed target line (re-drawn while typing). */
function chart(stats, target, unit) {
  const w = 300;
  const h = 96;
  const pad = { t: 8, b: 18, l: 4, r: 4 };
  const vals = stats.months.map((m) => m.value);
  const max = Math.max(...vals, target > 0 ? target : 0) * 1.08 || 1;
  const bw = (w - pad.l - pad.r) / vals.length;
  const y = (v) => pad.t + (h - pad.t - pad.b) * (1 - v / max);
  const bars = stats.months.map((m, i) => {
    const x = pad.l + i * bw + bw * 0.18;
    const tip = `${monthLabel(m.month)}: ${formatMetric(m.value, unit)}${m.applied ? `\nMục tiêu áp dụng tháng đó ${formatMetric(m.applied.target, unit)} · đạt ${formatPct(m.applied.pct, 0)}` : ''}`;
    return `<g class="ref-bar" tabindex="0" data-tip="${esc(tip)}" role="img" aria-label="${esc(tip.replace('\n', ' · '))}">
      <rect x="${x}" y="${y(m.value)}" width="${bw * 0.64}" height="${Math.max(1, h - pad.b - y(m.value))}" rx="3"></rect>
      <text x="${x + bw * 0.32}" y="${h - 4}" text-anchor="middle">${monthLabel(m.month).replace(/\/\d{2}(\d{2})$/, '/$1')}</text></g>`;
  }).join('');
  const line = target > 0 ? `<line class="ref-target" x1="${pad.l}" x2="${w - pad.r}" y1="${y(target)}" y2="${y(target)}"></line>` : '';
  return `<svg viewBox="0 0 ${w} ${h}" class="ref-chart" role="group" aria-label="6 tháng đã chốt gần nhất và mục tiêu đang nhập">${bars}${line}</svg>`;
}

/** Live part: chart line, "Nếu áp mục tiêu này cho 6 tháng qua…" and the difficulty label. */
export function referenceLive(ref, target, thresholds) {
  const s = ref.stats;
  if (!s.count) return '';
  const bt = backtest(target, s, ref.direction, thresholds);
  const d = difficulty(target, s, ref.direction);
  return `${chart(s, target, ref.unit)}
    <div class="ref-check">${bt ? `Nếu áp mục tiêu này cho ${bt.total} tháng qua: đạt 100% ở <b>${bt.reached}/${bt.total}</b> tháng · mức Tốt ở <b>${bt.good}/${bt.total}</b> tháng` : 'Nhập mục tiêu để kiểm tra với dữ liệu cũ.'}
      ${d ? ` <span class="badge ${DIFF_CLASS[d.key]}">Độ khó: ${esc(d.label)} · ${formatNumber(d.ratio, 1)}% TB 3 tháng</span>` : ''}</div>`;
}

/** Whole block (static numbers + suggestion buttons + live part). `pct` = the editable "Tăng/Giảm X%". */
export function referenceHtml(ref, { target, thresholds, pct = 10, index }) {
  const s = ref.stats;
  const u = ref.unit;
  const sg = suggestions(s, { unit: u, direction: ref.direction, pct, breakEven: ref.breakEven });
  const stat = (label, value) => `<div class="ref-stat"><span class="note">${label}</span><b class="num">${value}</b></div>`;
  const buttons = sg.map((x) => (x.key === 'change'
    ? `<span class="ref-suggest"><button type="button" class="btn sm" data-suggest="${index}" data-value="${x.value}">${ref.direction === 'lower' ? 'Giảm' : 'Tăng'}</button>
        <input class="input ref-pct" type="number" min="1" max="200" step="1" value="${pct}" data-suggest-pct="${index}" aria-label="% thay đổi so với TB 3 tháng"><span class="note">% → ${formatMetric(x.value, u)}</span></span>`
    : `<button type="button" class="btn sm" data-suggest="${index}" data-value="${x.value}">${esc(x.label)} → ${formatMetric(x.value, u)}</button>`)).join('');
  const sib = ref.siblings;
  return `<div class="ref-source note">${esc(ref.sourceText)}</div>
    ${s.count ? `<div class="ref-grid">
        <div data-ref-live="${index}">${referenceLive(ref, target, thresholds)}</div>
        <div class="ref-stats">
          ${stat(`Tháng gần nhất (${monthLabel(s.lastMonth)})`, formatMetric(s.last, u))}
          ${stat('TB 3 tháng', formatMetric(s.avg3, u))}
          ${stat('TB 6 tháng', formatMetric(s.avg6, u))}
          ${stat('Thấp nhất / Cao nhất 6 tháng', `${formatMetric(s.min6, u)} / ${formatMetric(s.max6, u)}`)}
          ${stat('Tăng trưởng TB/tháng', s.growth == null ? '—' : `${s.growth >= 0 ? '+' : ''}${formatPct(s.growth * 100, 1)}`)}
          ${s.yoy != null ? stat(`Cùng kỳ năm trước (${monthLabel(s.yoyMonth)})`, formatMetric(s.yoy, u)) : ''}
        </div></div>
        ${s.fewData ? `<p class="note ref-few">⚠ Ít dữ liệu (${s.count} tháng), nên xem lại mục tiêu sau 3 tháng.</p>` : ''}`
      : `<p class="ref-empty">Chưa có dữ liệu của sản phẩm này.</p>
        ${sib ? `<div class="ref-stats">${stat(`Các sản phẩm khác của ${esc(sib.parentName)} ở tháng đầu ra mắt (${sib.count} sản phẩm)`, `TB ${formatMetric(sib.avg, u)}`)}
          ${stat('Thấp nhất / Cao nhất', `${formatMetric(sib.min, u)} / ${formatMetric(sib.max, u)}`)}</div>` : ''}`}
    ${buttons ? `<div class="ref-buttons"><span class="note">Gợi ý mục tiêu:</span>${buttons}</div>` : ''}`;
}
