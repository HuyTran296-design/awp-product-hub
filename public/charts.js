// Hand-rolled SVG charts: sparkline, revenue bars + cost line, multi-line, cost share bar.
// One y-axis per chart; recessive grid; hover via data-tip (plain text) + CSS crosshair.

import { formatDate, formatNumber, formatPct, formatVnd, formatVndCompact } from '/shared/format.js';
import { esc } from './ui.js';

const W = 640;

function niceMax(v) {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const n = v / exp;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * exp;
}

const shortDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Small trend line; tooltip per point. values: [{date, value}] */
export function sparkline(points, { color = 'var(--text-2)', format = (v) => formatNumber(v) } = {}) {
  const pts = points.filter((p) => p.value != null);
  if (pts.length < 2) return '<svg class="spark" viewBox="0 0 200 40"></svg>';
  const h = 40;
  const w = 200;
  const vals = pts.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i) => (i / (pts.length - 1)) * (w - 4) + 2;
  const y = (v) => h - 4 - ((v - min) / span) * (h - 8);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const step = (w - 4) / (pts.length - 1);
  const hits = pts.map((p, i) => `<g class="hit-group"><line class="xhair" x1="${x(i)}" x2="${x(i)}" y1="0" y2="${h}"/>
    <rect class="hit" x="${x(i) - step / 2}" y="0" width="${step}" height="${h}" data-tip="${esc(`${formatDate(p.date)}\n${format(p.value)}`)}"/></g>`).join('');
  return `<svg class="spark chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Xu hướng">
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    <circle cx="${x(pts.length - 1)}" cy="${y(pts[pts.length - 1].value)}" r="3" fill="${color}"/>${hits}</svg>`;
}

/** Revenue bars + cost line on one VND axis. buckets: [{from,to,revenue,cost}] */
export function revenueCostChart(buckets, { barColor, granularity }) {
  const H = 240;
  const pad = { l: 56, r: 12, t: 12, b: 28 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const max = niceMax(Math.max(...buckets.map((b) => Math.max(b.revenue, b.cost)), 1));
  const y = (v) => pad.t + ih - (v / max) * ih;
  const bw = iw / buckets.length;
  const barW = Math.max(2, Math.min(28, bw - 2));
  const label = (b) => (granularity === 'month' ? `T${Number(b.from.slice(5, 7))}/${b.from.slice(2, 4)}`
    : granularity === 'week' ? `${shortDate(b.from)}–${shortDate(b.to)}` : shortDate(b.from));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const every = Math.ceil(buckets.length / 8);
  const cx = (i) => pad.l + bw * i + bw / 2;
  // Cost accrues on working days only, so the line breaks across days without cost (weekends).
  const line = buckets.map((b, i) => {
    if (b.cost <= 0) return '';
    const cmd = i && buckets[i - 1].cost > 0 ? 'L' : 'M';
    return `${cmd}${cx(i).toFixed(1)},${y(b.cost).toFixed(1)}`;
  }).join('');

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Doanh thu và chi phí theo thời gian">
    ${ticks.map((t) => `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/>
      <text x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${formatVndCompact(t)}</text>`).join('')}
    ${buckets.map((b, i) => {
      const top = y(Math.max(b.revenue, 0));
      const h = Math.max(0, pad.t + ih - top);
      const r = Math.min(4, barW / 2, h);
      const x0 = cx(i) - barW / 2;
      const path = h > 0 ? `M${x0},${pad.t + ih}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + barW - r}Q${x0 + barW},${top} ${x0 + barW},${top + r}V${pad.t + ih}Z` : '';
      const tip = `${granularity === 'day' ? formatDate(b.from) : `${formatDate(b.from)} – ${formatDate(b.to)}`}\nDoanh thu: ${formatVnd(b.revenue)}\nChi phí: ${formatVnd(b.cost)}\n${b.revenue - b.cost >= 0 ? 'Lời' : 'Lỗ'}: ${formatVnd(Math.abs(b.revenue - b.cost))}`;
      return `<g class="hit-group">
        <path class="bar-mark" d="${path}" fill="${barColor}"/>
        <rect class="hit" x="${pad.l + bw * i}" y="${pad.t}" width="${bw}" height="${ih}" data-tip="${esc(tip)}" tabindex="-1"/>
        ${i % every === 0 ? `<text x="${cx(i)}" y="${H - 8}" text-anchor="middle">${esc(label(b))}</text>` : ''}
      </g>`;
    }).join('')}
    <line class="axis-line" x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}"/>
    <path d="${line}" fill="none" stroke="var(--cost-line)" stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round" pointer-events="none"/>
  </svg>`;
}

/** Multi-series line chart with crosshair tooltip listing every series. series: [{name,color,points:[{date,value}]}] */
export function lineChart(series, { granularity = 'day', format = (v) => formatNumber(v), width = 640, axisFormat = (v) => formatNumber(v), markers = [] } = {}) {
  const H = 240;
  const W = width;
  const pad = { l: 52, r: 12, t: 12, b: 28 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const n = series[0].points.length;
  const max = niceMax(Math.max(...series.flatMap((s) => s.points.map((p) => p.value ?? 0)), 1));
  const x = (i) => pad.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => pad.t + ih - (v / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const every = Math.ceil(n / 8);
  const step = n > 1 ? iw / (n - 1) : iw;
  const dates = series[0].points.map((p) => p.date);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Biểu đồ đường theo thời gian">
    ${ticks.map((t) => `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/>
      <text x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${esc(axisFormat(t))}</text>`).join('')}
    <line class="axis-line" x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + ih}" y2="${pad.t + ih}"/>
    ${series.map((s) => `<path d="${s.points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value ?? 0).toFixed(1)}`).join('')}"
      fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" ${s.dashed ? 'stroke-dasharray="5 4"' : ''}/>`).join('')}
    ${markers.map((m) => {
      // Vertical marker, e.g. "Đổi nguồn: GA4" on the day a baseline's data source changed.
      const i = dates.findIndex((d) => d >= m.date);
      if (i < 0) return '';
      return `<line x1="${x(i)}" x2="${x(i)}" y1="${pad.t}" y2="${pad.t + ih}" stroke="var(--yellow-mark)" stroke-width="2" stroke-dasharray="3 3"/>
        <text x="${x(i) + 4}" y="${pad.t + 10}" style="fill:var(--yellow-ink);font-weight:600">${esc(m.label)}</text>`;
    }).join('')}
    ${dates.map((d, i) => {
      const tip = `${granularity === 'week' ? `Tuần từ ${formatDate(d)}` : formatDate(d)}\n${series.map((s) => `${s.name}: ${format(s.points[i].value)}`).join('\n')}`;
      return `<g class="hit-group"><line class="xhair" x1="${x(i)}" x2="${x(i)}" y1="${pad.t}" y2="${pad.t + ih}"/>
        <rect class="hit" x="${x(i) - step / 2}" y="${pad.t}" width="${step}" height="${ih}" data-tip="${esc(tip)}"/>
        ${i % every === 0 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${shortDate(d)}</text>` : ''}</g>`;
    }).join('')}
  </svg>`;
}

/** Team cost share: one horizontal bar with a 2px gap between segments + legend with %. */
export function shareBar(items) {
  const segs = items.filter((i) => i.pct > 0).map((i) => `<div class="share-seg${i.id == null ? ' unallocated' : ''}"
    style="flex:${i.pct.toFixed(4)} 1 0;${i.id != null ? `background:${i.color}` : ''}"
    data-tip="${esc(`${i.name}\n${formatPct(i.pct)} chi phí team\n${formatVnd(i.monthly)}/tháng`)}"></div>`).join('');
  const legend = items.map((i) => `<span class="legend-item"><i class="key${i.id == null ? ' share-seg unallocated' : ''}"
    style="${i.id != null ? `background:${i.color}` : ''}"></i>${esc(i.name)} <b>${formatPct(i.pct)}</b></span>`).join('');
  return `<div class="share-bar" role="img" aria-label="Tỷ trọng chi phí team">${segs}</div><div class="legend">${legend}</div>`;
}

export function legend(items) {
  return `<div class="legend" style="margin:0 0 8px">${items.map((i) => `<span class="legend-item"><i class="key ${i.type || ''}"
    style="${i.type === 'dashed' ? '' : `background:${i.color}`}"></i>${esc(i.name)}</span>`).join('')}</div>`;
}


/**
 * Stop-loss chart: monthly P&L bars (Lời above / Lỗ below zero), cumulative P&L line and the
 * cumulative-loss threshold as a dashed horizontal line — one VND axis.
 */
export function stopLossChart(months, threshold, { width = 520 } = {}) {
  const W = width;
  const H = 240;
  const pad = { l: 64, r: 12, t: 14, b: 28 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  let cum = 0;
  const pts = months.map((m) => { cum += m.profit; return { ...m, cum }; });
  const lo = Math.min(0, -(threshold || 0), ...pts.map((p) => Math.min(p.profit, p.cum)));
  const hi = Math.max(0, ...pts.map((p) => Math.max(p.profit, p.cum)));
  const span = niceMax((hi - lo) * 1.08 || 1);
  const step = span / 4;
  const min = Math.floor(lo / step) * step;
  const max = Math.max(min + span, Math.ceil(hi / step) * step);
  const y = (v) => pad.t + ih - ((v - min) / (max - min)) * ih;
  const bw = iw / Math.max(1, pts.length);
  const barW = Math.max(4, Math.min(34, bw - 6));
  const cx = (i) => pad.l + bw * i + bw / 2;
  const ticks = [];
  for (let v = min; v <= max + 1; v += step) ticks.push(v);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)},${y(p.cum).toFixed(1)}`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Lãi/lỗ từng tháng, lũy kế và ngưỡng cắt lỗ">
    ${ticks.map((t) => `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/>
      <text x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end">${formatVndCompact(t)}</text>`).join('')}
    <line class="axis-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(0)}" y2="${y(0)}"/>
    ${threshold ? `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(-threshold)}" y2="${y(-threshold)}" stroke="var(--red-mark)" stroke-width="2" stroke-dasharray="6 4"/>
      <text x="${W - pad.r}" y="${y(-threshold) - 6}" text-anchor="end" style="fill:var(--red-ink)">Ngưỡng −${formatVndCompact(threshold)}</text>` : ''}
    ${pts.map((p, i) => {
      const top = y(Math.max(0, p.profit));
      const h = Math.abs(y(p.profit) - y(0));
      const tip = `Tháng ${p.month.slice(5)}/${p.month.slice(0, 4)}\n${p.profit >= 0 ? 'Lời' : 'Lỗ'}: ${formatVnd(Math.abs(p.profit))}\nDoanh thu: ${formatVnd(p.revenue)}\nChi phí: ${formatVnd(p.cost)}\nLũy kế: ${formatVnd(p.cum)}`;
      return `<g class="hit-group">
        <rect class="bar-mark" x="${cx(i) - barW / 2}" y="${top}" width="${barW}" height="${Math.max(1, h)}" rx="3" fill="${p.profit >= 0 ? 'var(--green-mark)' : 'var(--red-mark)'}" opacity=".85"/>
        <rect class="hit" x="${pad.l + bw * i}" y="${pad.t}" width="${bw}" height="${ih}" data-tip="${esc(tip)}"/>
        <text x="${cx(i)}" y="${H - 8}" text-anchor="middle">T${Number(p.month.slice(5))}/${p.month.slice(2, 4)}</text></g>`;
    }).join('')}
    <path d="${line}" fill="none" stroke="var(--text)" stroke-width="2" stroke-linejoin="round" pointer-events="none"/>
    ${pts.map((p, i) => `<circle cx="${cx(i)}" cy="${y(p.cum)}" r="3.5" fill="var(--text)" pointer-events="none"/>`).join('')}
  </svg>`;
}
