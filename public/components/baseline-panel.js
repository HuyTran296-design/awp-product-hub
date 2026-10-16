// Baseline detail panel: slides in from the right (≈480px; full screen on phones) without leaving the page.
// Non-modal on desktop so the period filter stays usable — the panel then refreshes with the new period.
// Shows target & progress, change vs previous period, weight & contribution to the health score,
// iOS/Android split, period chart with a dashed target line, the calculation note, source and last update.

import { lineChart } from '../charts.js';
import {
  PLATFORM_COLORS, achievementTip, deltaCaption, esc, formatMetric, formatTarget, shortfallText, statusBadge, thresholdText,
} from '../ui.js';
import { formatDate, formatDateTime, formatNumber, formatPct, formatVndCompact } from '/shared/format.js';
import { contributions } from '/shared/health-score.js';

const PLATFORM_SHORT = { ios: 'iOS', android: 'Android', playables: 'Playables', web: 'Website' };

/**
 * @param {{baselines:object[], key:string, score:number|null, thresholds:object, range:object, projectId:number,
 *          isAdmin:boolean, onChange:(key:string|null)=>void}} o
 * @returns {{ close:Function }}
 */
export function openBaselinePanel(o) {
  let index = Math.max(0, o.baselines.findIndex((b) => b.metricKey === o.key));
  const opener = document.activeElement;
  const contrib = contributions(o.baselines);
  const root = document.createElement('div');
  root.className = 'drawer-backdrop';
  root.innerHTML = '<aside class="drawer" role="dialog" aria-modal="false"></aside>';
  document.body.append(root);
  const drawer = root.querySelector('.drawer');
  requestAnimationFrame(() => root.classList.add('open'));

  const close = () => {
    root.remove();
    document.removeEventListener('keydown', onKey);
    o.onChange(null);
    opener?.focus?.();
  };
  const go = (d) => {
    index = (index + d + o.baselines.length) % o.baselines.length;
    draw();
    o.onChange(o.baselines[index].metricKey);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) close();
  };
  document.addEventListener('keydown', onKey);

  const draw = () => {
    const b = o.baselines[index];
    const pct = b.pct ?? 0;
    const over = Math.round(pct) - 100;
    const shortfall = shortfallText(b);
    const parts = Object.entries(b.byPlatform ?? {}).filter(([, v]) => v != null);
    const split = parts.length > 1;
    const additive = b.platformCombine === 'sum';
    const total = parts.reduce((s, [, v]) => s + v, 0);
    drawer.setAttribute('aria-label', `Chi tiết ${b.name}`);
    drawer.innerHTML = `
      <header class="drawer-head">
        <div class="row-actions">
          <button class="icon-btn" data-prev aria-label="Baseline trước">‹</button>
          <button class="icon-btn" data-next aria-label="Baseline sau">›</button>
        </div>
        <h2>${esc(b.name)}</h2>
        <button class="icon-btn" data-close aria-label="Đóng (Esc)">✕</button>
      </header>
      <div class="drawer-body stack" style="gap:16px">
        <div><div class="value num" style="font-size:28px;font-weight:700">${formatMetric(b.actual, b.unit)}</div>
          ${statusBadge(b.status, null, { text: b.pct == null ? '' : ` · Đạt ${formatPct(b.pct, 0)}` })}</div>

        <div class="stack" style="gap:6px">
          <div class="small muted">Mục tiêu kỳ (${esc(b.manual?.period?.label ?? o.range.label)}): <b style="color:var(--text-2)">${formatTarget(b.target, b.unit, b.direction)}</b></div>
          <div class="progress-row">
            <div class="progress" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"
              aria-label="Đạt ${formatPct(b.pct, 0)} mục tiêu"><span class="${b.status ?? ''}" style="width:${Math.min(100, pct)}%"></span>
              <i class="target-tick" aria-hidden="true"></i></div>
            ${over > 0 ? `<span class="over-target">▸ +${over}%</span>` : ''}</div>
          <div class="progress-foot"><span>${esc(shortfall)}</span><span class="goal">Mục tiêu</span></div>
          <div>${deltaCaption(b.delta, b.direction)}</div>
        </div>

        <div class="fin-list">
          <div class="fin-row"><span class="label">Trọng số · đóng góp vào điểm sức khỏe</span>
            <span class="value">Trọng số ${formatPct(b.weight, 0)} · Đóng góp ${contrib[index] == null ? '—' : formatNumber(contrib[index], 1)} / ${o.score == null ? '—' : formatNumber(o.score, 1)} điểm</span></div>
          ${split ? `<div class="fin-row"><span class="label">${parts.map(([p]) => PLATFORM_SHORT[p] ?? p).join(' · ')}</span><span class="value small">
            ${parts.map(([p, v]) => `<span class="platform-tag"><i style="background:${PLATFORM_COLORS[p] ?? 'var(--muted)'}"></i>${PLATFORM_SHORT[p] ?? p} ${formatMetric(v, b.unit)}${additive && total ? ` (${formatPct((v / total) * 100)})` : ''}</span>`).join(' · ')}</span>
            ${b.combinedNote && parts.some(([p]) => p === 'playables') ? `<span class="detail">${esc(b.combinedNote)}</span>` : ''}</div>` : ''}
        </div>

        <div>${chart(b)}</div>

        <p class="note" style="margin:0">${esc(formulaNote(b, o.thresholds))}</p>
        ${b.stale ? `<div class="alert warn">Chưa cập nhật: ${esc(b.manual.missing.label)} quá hạn nhập (${formatDate(b.manual.deadline)}). Baseline không được tính vào điểm.</div>` : ''}
        ${b.manual && !b.stale && b.manual.period ? `<p class="note" style="margin:0">Nhập thủ công · ${esc(b.manual.period.label)}${b.manual.enteredBy ? ` · ${esc(b.manual.enteredBy)} · ${formatDateTime(b.manual.enteredAt)}` : ''}
          ${b.manual.next ? ` · ${esc(b.manual.next.period.label)} chưa nhập (hạn ${formatDate(b.manual.next.deadline)})` : ''}</p>` : ''}
        <p class="note" style="margin:0">Nguồn: ${esc(b.sourceText)} · Cập nhật lần cuối: ${formatDateTime(o.range.lastUpdated)} · Kỳ ${formatDate(o.range.from)} – ${formatDate(o.range.to)}</p>
        ${o.isAdmin ? `<a class="btn sm" href="#/config/projects/${o.projectId}?tab=baselines" style="align-self:flex-start">Sửa mục tiêu &amp; trọng số</a>` : ''}
      </div>`;
    drawer.querySelector('[data-close]').addEventListener('click', close);
    drawer.querySelector('[data-prev]').addEventListener('click', () => go(-1));
    drawer.querySelector('[data-next]').addEventListener('click', () => go(1));
    drawer.querySelector('a[href]')?.addEventListener('click', () => root.remove());
    drawer.querySelector('[data-close]').focus();
  };

  draw();
  return { close };
}

/** "Đạt 113,6% = 2.272.400 ÷ 2.000.000 · Tốt > 80%, Cần chú ý 50–80%, Báo động < 50%" */
function formulaNote(b, thresholds) {
  if (b.pct == null) return `Chưa có dữ liệu trong kỳ · ${thresholdText(thresholds)}`;
  return achievementTip(b, thresholds).replace(' mục tiêu', '').replace('. Ngưỡng: ', ' · ').replace(/\.$/, '');
}

/**
 * Period chart: cumulative metrics show the running total against the period target;
 * others show daily values against the (unchanged) target. Short periods use 14 days of context.
 */
function chart(b) {
  const fmt = (v) => formatMetric(v, b.unit);
  let points;
  let caption;
  if (b.source === 'manual') {
    points = b.manualSeries ?? [];
    caption = `Giá trị nhập thủ công theo ${({ day: 'ngày', week: 'tuần', month: 'tháng' })[b.manualPeriod] ?? 'kỳ'} so với mục tiêu`;
  } else if (b.aggregation === 'sum') {
    let run = 0;
    points = b.series.map((d) => ({ date: d.date, value: (run += d.value ?? 0) }));
    caption = 'Lũy kế trong kỳ so với mục tiêu kỳ';
  } else {
    const useContext = b.series.length < 7;
    points = useContext ? b.sparkline : b.series;
    caption = useContext ? 'Giá trị theo ngày (14 ngày gần nhất) so với mục tiêu' : 'Giá trị theo ngày so với mục tiêu';
  }
  if (!points.length) return '<div class="empty">Chưa có dữ liệu trong kỳ.</div>';
  return `<div class="small muted" style="margin-bottom:6px">${caption}</div>
    <div class="legend" style="margin:0 0 6px"><span class="legend-item"><i class="key line" style="background:var(--accent)"></i>Thực tế</span>
      <span class="legend-item"><i class="key dashed"></i>Mục tiêu</span></div>
    ${lineChart([
      { name: 'Thực tế', color: 'var(--accent)', points },
      { name: 'Mục tiêu', color: 'var(--cost-line)', dashed: true, points: points.map((p) => ({ date: p.date, value: b.target })) },
    ], { format: fmt, width: 440, markers: b.sourceChanges ?? [], axisFormat: (v) => (b.unit === 'vnd' || v >= 10_000 ? formatVndCompact(v) : formatMetric(v, b.unit)) })}`;
}
