// Baseline & weight editor: 1–5 baselines (no duplicates, drag or ↑↓ to reorder),
// weight 1–100% + monthly target each, per-project thresholds. Used by the edit tab and the wizard.
// With `loadReferences`, each target gets a "Tham chiếu" block (closed months, suggestions, back-test, difficulty).

import { esc, parseDecimal, parseVnd } from '../ui.js';
import { formatNumber } from '/shared/format.js';
import { AGGREGATION_LABELS, catalogFor, getMetricDef, MANUAL_PERIODS, sourceLabel } from '/shared/metric-catalog.js';
import { formatDate } from '/shared/format.js';
import { referenceHtml, referenceLive } from './target-reference.js';

export const MIN = 1;
export const MAX = 5;
const UNIT_SUFFIX = { vnd: '₫', count: '', pct: '%', seconds: 'giây', minutes: 'phút', rating: '★' };

/**
 * @param {{baselines:object[], thresholds:object, onChange?:Function, productType?:string, firstOpenDate?:string, sourceDateEditable?:boolean,
 *          loadReferences?:(metrics:{metricKey:string, source:string}[])=>Promise<object>}} o
 * Each baseline: { metricKey, weight, targetMonthly, source: 'auto'|'manual'|'csv', period: 'day'|'week'|'month' }.
 */
export function createBaselineEditor(el, { baselines, thresholds, onChange, productType = 'mobile_app', firstOpenDate = null, sourceDateEditable = true, loadReferences = null }) {
  // "Tham chiếu" state: loaded references per metric, open/closed per metric (always closed when the editor is created —
  // not remembered), "Tăng/Giảm X%" per metric.
  let refs = {};
  let refKey = '';
  let refLoading = false;
  const refOpen = {};
  const refPct = {};
  const withSource = (b) => {
    const def = getMetricDef(b.metricKey);
    return { ...b, source: b.source ?? (def.nativeSource === 'manual' ? 'manual' : 'auto'), period: b.period ?? 'month' };
  };
  let list = baselines.map((b) => withSource({ metricKey: b.metricKey, weight: b.weight, targetMonthly: b.targetMonthly, source: b.source, period: b.period }));
  let th = { ...thresholds };
  let sourceDate = firstOpenDate;
  const initialSources = Object.fromEntries(list.map((b) => [b.metricKey, `${b.source}|${b.period}`]));
  const initial = JSON.stringify({ list, th });
  const sourceChanged = () => list.some((b) => initialSources[b.metricKey] && initialSources[b.metricKey] !== `${b.source}|${b.period}`);

  const errors = () => {
    const e = [];
    if (list.length < MIN) e.push('Cần chọn ít nhất 1 baseline.');
    for (const b of list) {
      const def = getMetricDef(b.metricKey);
      if (!(b.weight >= 1 && b.weight <= 100)) e.push(`Trọng số "${def.short}" phải từ 1% đến 100%.`);
      if (!def.budget && !(b.targetMonthly > 0)) e.push(`Mục tiêu "${def.short}" phải lớn hơn 0.`);
    }
    if (!(th.red >= 0 && th.green <= 120 && th.red < th.green)) e.push('Ngưỡng không hợp lệ: cần 0 ≤ Báo động < Tốt ≤ 120.');
    if (sourceChanged() && firstOpenDate && !(sourceDate >= firstOpenDate)) e.push(`Ngày áp dụng nguồn mới phải từ ${formatDate(firstOpenDate)} (tháng đã chốt sổ không đổi được).`);
    return e;
  };

  const targetText = (b) => {
    const def = getMetricDef(b.metricKey);
    if (!Number.isFinite(b.targetMonthly)) return '';
    return def.unit === 'vnd' || def.unit === 'count' ? formatNumber(b.targetMonthly) : String(b.targetMonthly).replace('.', ',');
  };

  const draw = () => {
    const selected = new Set(list.map((b) => b.metricKey));
    el.innerHTML = `
      <div class="config-layout">
        <div class="stack">
          <div>
            <h3 style="margin-bottom:4px">Baseline đã chọn <span class="muted small">(${list.length}/${MAX})</span></h3>
            <div class="note" style="margin-bottom:10px">Chọn 1–5 baseline. Kéo ⋮⋮ để đổi thứ tự hiển thị. Trọng số 1–100%, không cần cộng đủ 100%.</div>
            ${loadReferences && list.some((b) => !getMetricDef(b.metricKey).budget) ? '<div style="margin-bottom:6px"><button type="button" class="link-btn small" data-ref-all aria-expanded="false">Mở tất cả tham chiếu ▾</button></div>' : ''}
            ${list.length && list.length < 3 ? '<div class="alert info" style="margin-bottom:10px;padding:8px 12px">Nên chọn 3–5 baseline để đánh giá cân bằng hơn.</div>' : ''}
            <div class="stack" style="gap:10px">${list.map((b, i) => row(b, i)).join('') || '<div class="empty">Chưa chọn baseline nào.</div>'}</div>
            <p class="note" style="margin:10px 0 0">Mục tiêu nhập theo tháng. Chỉ số cộng dồn được quy đổi theo kỳ; chỉ số trung bình/tỷ lệ/giá trị mới nhất giữ nguyên mục tiêu.</p>
          </div>
          <div>
            <h3 style="margin-bottom:8px">Danh mục baseline ${list.length >= MAX ? '<span class="chip">Tối đa 5 baseline</span>' : ''}</h3>
            <div class="catalog-grid">${catalogFor(productType).map((m) => `<div class="catalog-item${selected.has(m.key) ? ' selected' : ''}">
              <b>${esc(m.name)}${m.phase === 'build' ? ' <span class="chip">Xây dựng</span>' : ''}</b><span class="small muted">${esc(m.source)}</span>
              <span class="small">${AGGREGATION_LABELS[m.aggregation]} · ${m.direction === 'lower' ? 'thấp tốt' : 'cao tốt'}</span>
              <button type="button" class="btn sm" data-add="${m.key}" ${selected.has(m.key) || list.length >= MAX ? 'disabled' : ''}
                ${!selected.has(m.key) && list.length >= MAX ? 'title="Tối đa 5 baseline"' : ''}>${selected.has(m.key) ? 'Đã chọn' : list.length >= MAX ? 'Tối đa 5 baseline' : '＋ Chọn'}</button>
            </div>`).join('')}</div>
          </div>
        </div>
        <aside class="stack sticky">
          <div class="card" style="background:var(--surface-2)">
            <h3 style="margin-bottom:10px">Ngưỡng trạng thái</h3>
            <div class="threshold-fields">
              <label class="field"><span>Tốt khi lớn hơn</span><div class="input-suffix" data-suffix="%">
                <input class="input right" type="number" data-th="green" min="0" max="120" step="1" value="${th.green}"></div></label>
              <label class="field"><span>Báo động khi nhỏ hơn</span><div class="input-suffix" data-suffix="%">
                <input class="input right" type="number" data-th="red" min="0" max="120" step="1" value="${th.red}"></div></label>
            </div>
            <div data-th-preview style="margin-top:12px"></div>
            <div data-weights style="margin-top:8px"></div>
            ${sourceDateEditable ? `<div data-source-date ${sourceChanged() ? '' : 'hidden'} style="margin-top:10px">
              <label class="field"><span>Ngày áp dụng nguồn mới</span><input class="input" type="date" data-sdate min="${firstOpenDate ?? ''}" value="${sourceDate ?? ''}">
              <span class="hint">Dữ liệu trước ngày này giữ nguồn cũ; từ ngày này tính theo nguồn mới (biểu đồ có vạch đánh dấu).</span></label></div>` : ''}
            <div data-errors></div>
          </div>
        </aside>
      </div>`;
    bind();
    refresh();
    ensureRefs();
  };

  const row = (b, i) => {
    const def = getMetricDef(b.metricKey);
    return `<div class="baseline-row" draggable="true" data-index="${i}">
      <span class="drag-handle" title="Kéo để đổi thứ tự" aria-hidden="true">⋮⋮</span>
      <div class="b-name"><b>${i + 1}. ${esc(def.name)}</b><div class="small muted">${AGGREGATION_LABELS[def.aggregation]} · ${def.direction === 'lower' ? 'thấp tốt' : 'cao tốt'} · ${esc(def.source)}</div></div>
      <label class="field w-field"><span>Trọng số</span><div class="input-suffix" data-suffix="%">
        <input class="input right" type="number" min="1" max="100" step="5" data-weight="${i}" value="${Number.isFinite(b.weight) ? b.weight : ''}"></div></label>
      ${def.budget
        ? '<div class="field t-field"><span>Mục tiêu</span><span class="note">Tự tính: ngân sách theo kế hoạch đến hôm nay (thấp là tốt)</span></div>'
        : `<div class="t-field"><label class="field"><span>Mục tiêu/tháng${def.direction === 'lower' ? ' (tối đa)' : ''}</span><div class="input-suffix" data-suffix="${UNIT_SUFFIX[def.unit]}">
        <input class="input right" inputmode="decimal" data-target="${i}" value="${targetText(b)}"></div></label>
        ${loadReferences ? `<button type="button" class="link-btn small" data-ref-toggle="${i}" aria-expanded="false" aria-controls="ref-${i}">Xem tham chiếu ▾</button>` : ''}</div>`}
      <label class="field s-field"><span>Nguồn</span><span class="s-inputs"><select class="input" data-source="${i}">
        ${def.nativeSource === 'manual' ? '' : `<option value="auto" ${b.source === 'auto' ? 'selected' : ''}>${esc(sourceLabel(b.metricKey, 'auto'))}</option>`}
        <option value="manual" ${b.source === 'manual' ? 'selected' : ''}>Nhập thủ công</option>
        <option value="csv" ${b.source === 'csv' ? 'selected' : ''}>Tải lên CSV</option></select>
        ${b.source === 'manual' ? `<select class="input" data-period="${i}" aria-label="Kỳ nhập">${Object.entries(MANUAL_PERIODS).map(([k, l]) =>
          `<option value="${k}" ${b.period === k ? 'selected' : ''}>Theo ${l.toLowerCase()}</option>`).join('')}</select>` : ''}</span></label>
      <div class="row-actions">
        <button type="button" class="icon-btn" data-move="${i}:-1" ${i === 0 ? 'disabled' : ''} aria-label="Lên">↑</button>
        <button type="button" class="icon-btn" data-move="${i}:1" ${i === list.length - 1 ? 'disabled' : ''} aria-label="Xuống">↓</button>
        <button type="button" class="icon-btn" data-remove="${i}" aria-label="Bỏ baseline" title="Bỏ">✕</button>
      </div>
      ${loadReferences && !def.budget ? `<div class="ref-wrap"><div class="ref-block" id="ref-${i}" data-ref="${i}" hidden></div></div>` : ''}
    </div>`;
  };

  /** Fetch references when the chosen metrics / sources change (blocks stay closed until opened). */
  const ensureRefs = async () => {
    if (!loadReferences) return;
    const metrics = list.filter((b) => !getMetricDef(b.metricKey).budget).map((b) => ({ metricKey: b.metricKey, source: b.source }));
    const key = JSON.stringify(metrics);
    if (key === refKey) { list.forEach((_, i) => fillRef(i)); return; }
    refKey = key;
    refLoading = true;
    list.forEach((_, i) => fillRef(i));
    try { refs = (await loadReferences(metrics)) ?? {}; } catch { refs = {}; }
    if (key !== refKey) return;
    refLoading = false;
    list.forEach((_, i) => fillRef(i));
  };

  const fillRef = (i) => {
    const host = el.querySelector(`[data-ref="${i}"]`);
    const btn = el.querySelector(`[data-ref-toggle="${i}"]`);
    if (!host || !btn) return;
    const b = list[i];
    const ref = refs[b.metricKey];
    const open = Boolean(refOpen[b.metricKey]);
    btn.textContent = open ? 'Ẩn tham chiếu ▴' : 'Xem tham chiếu ▾';
    btn.setAttribute('aria-expanded', String(open));
    drawAllToggle();
    slide(host, open);
    if (!open) return;
    if (refLoading || !ref || ref.source !== b.source) { host.innerHTML = '<p class="note">Đang tải tham chiếu…</p>'; return; }
    host.innerHTML = referenceHtml(ref, { target: b.targetMonthly, thresholds: th, pct: refPct[b.metricKey] ?? 10, index: i });
    host.querySelectorAll('[data-suggest]').forEach((s) => s.addEventListener('click', () => {
      b.targetMonthly = Number(s.dataset.value);
      const input = el.querySelector(`[data-target="${i}"]`);
      if (input) input.value = targetText(b);
      changed();
      updateLive(i);
    }));
    host.querySelector('[data-suggest-pct]')?.addEventListener('change', (e) => {
      refPct[b.metricKey] = Math.max(1, Math.min(200, Number(e.target.value) || 10));
      fillRef(i);
      el.querySelector(`[data-suggest-pct="${i}"]`)?.focus();
    });
  };

  /** Short slide open/closed (skipped when the user prefers reduced motion). */
  const slide = (host, open) => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (open) {
      host.classList.remove('ref-closing');
      if (host.hidden && !reduced) { host.classList.add('ref-opening'); setTimeout(() => host.classList.remove('ref-opening'), 200); }
      host.hidden = false;
    } else if (!host.hidden) {
      if (reduced) { host.hidden = true; return; }
      host.classList.add('ref-closing');
      setTimeout(() => { if (host.classList.contains('ref-closing')) { host.hidden = true; host.classList.remove('ref-closing'); } }, 160);
    }
  };

  /** "Mở tất cả tham chiếu / Ẩn tất cả" above the list. */
  const refItems = () => list.filter((b) => !getMetricDef(b.metricKey).budget);
  const drawAllToggle = () => {
    const btn = el.querySelector('[data-ref-all]');
    if (!btn) return;
    const allOpen = refItems().length > 0 && refItems().every((b) => refOpen[b.metricKey]);
    btn.textContent = allOpen ? 'Ẩn tất cả tham chiếu ▴' : 'Mở tất cả tham chiếu ▾';
    btn.setAttribute('aria-expanded', String(allOpen));
  };

  /** Re-draw the target line, back-test and difficulty while typing. */
  const updateLive = (i) => {
    const b = list[i];
    const ref = refs[b.metricKey];
    const live = el.querySelector(`[data-ref-live="${i}"]`);
    if (live && ref && ref.source === b.source) live.innerHTML = referenceLive(ref, b.targetMonthly, th);
  };

  const refresh = () => {
    const errs = errors();
    const totalW = list.reduce((s, b) => s + (Number.isFinite(b.weight) ? b.weight : 0), 0);
    el.querySelector('[data-weights]').innerHTML = `<div class="fin-row"><span class="label">Tổng trọng số</span><span class="value">${formatNumber(totalW)}%</span>
      <span class="detail">Điểm = Σ(trọng số × % đạt) ÷ Σ trọng số</span></div>`;
    el.querySelector('[data-errors]').innerHTML = errs.length
      ? `<div class="alert error"><ul>${errs.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
    const g = Math.min(120, Math.max(0, th.green || 0));
    const r = Math.min(g, Math.max(0, th.red || 0));
    el.querySelector('[data-th-preview]').innerHTML = `<div class="threshold-preview">
        <span style="flex:${r};background:var(--red-mark)"></span><span style="flex:${g - r};background:var(--yellow-mark)"></span>
        <span style="flex:${120 - g};background:var(--green-mark)"></span></div>
      <div class="legend"><span class="legend-item"><i class="shape red"></i>Báo động &lt; ${formatNumber(r)}%</span>
        <span class="legend-item"><i class="shape yellow"></i>Cần chú ý ${formatNumber(r)}–${formatNumber(g)}%</span>
        <span class="legend-item"><i class="shape green"></i>Tốt &gt; ${formatNumber(g)}%</span></div>`;
  };

  const changed = () => { refresh(); onChange?.(); };
  const redraw = () => { draw(); onChange?.(); };

  const move = (i, j) => {
    if (j < 0 || j >= list.length || i === j) return;
    const [item] = list.splice(i, 1);
    list.splice(j, 0, item);
    redraw();
  };

  const bind = () => {
    el.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
      list.push(withSource({ metricKey: b.dataset.add, weight: 50, targetMonthly: getMetricDef(b.dataset.add).budget ? 1 : NaN }));
      redraw();
      el.querySelector(`[data-target="${list.length - 1}"]`)?.focus();
    }));
    el.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => { list.splice(Number(b.dataset.remove), 1); redraw(); }));
    // Keep at least one baseline: the last one cannot be removed.
    if (list.length === MIN) el.querySelectorAll('[data-remove]').forEach((b) => { b.disabled = true; b.title = 'Cần ít nhất 1 baseline'; });
    el.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => {
      const [i, d] = b.dataset.move.split(':').map(Number);
      move(i, i + d);
    }));
    el.querySelectorAll('[data-weight]').forEach((i) => i.addEventListener('input', () => {
      list[Number(i.dataset.weight)].weight = i.value === '' ? NaN : Number(i.value); changed();
    }));
    el.querySelectorAll('[data-target]').forEach((i) => {
      const b = list[Number(i.dataset.target)];
      const unit = getMetricDef(b.metricKey).unit;
      i.addEventListener('input', () => {
        b.targetMonthly = unit === 'vnd' || unit === 'count' ? parseVnd(i.value) : parseDecimal(i.value);
        changed();
        updateLive(Number(i.dataset.target));
      });
      i.addEventListener('blur', () => { i.value = targetText(b); });
    });
    el.querySelectorAll('[data-th]').forEach((i) => i.addEventListener('input', () => { th[i.dataset.th] = Number(i.value); changed(); list.forEach((_, k) => updateLive(k)); }));
    el.querySelectorAll('[data-ref-toggle]').forEach((t) => t.addEventListener('click', () => {
      const k = list[Number(t.dataset.refToggle)].metricKey;
      refOpen[k] = !refOpen[k];
      fillRef(Number(t.dataset.refToggle));
    }));
    el.querySelector('[data-ref-all]')?.addEventListener('click', () => {
      const open = !refItems().every((b) => refOpen[b.metricKey]);
      for (const b of refItems()) refOpen[b.metricKey] = open;
      list.forEach((_, i) => fillRef(i));
    });
    el.querySelectorAll('[data-source]').forEach((sel) => sel.addEventListener('change', () => { list[Number(sel.dataset.source)].source = sel.value; redraw(); }));
    el.querySelectorAll('[data-period]').forEach((sel) => sel.addEventListener('change', () => { list[Number(sel.dataset.period)].period = sel.value; redraw(); }));
    el.querySelector('[data-sdate]')?.addEventListener('input', (e) => { sourceDate = e.target.value; changed(); });

    // HTML5 drag & drop reordering.
    let from = null;
    el.querySelectorAll('.baseline-row').forEach((rowEl) => {
      rowEl.addEventListener('dragstart', (e) => {
        if (e.target.closest('input, .ref-wrap')) { e.preventDefault(); return; }
        from = Number(rowEl.dataset.index);
        rowEl.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      rowEl.addEventListener('dragend', () => rowEl.classList.remove('dragging'));
      rowEl.addEventListener('dragover', (e) => { e.preventDefault(); rowEl.classList.add('drop-target'); });
      rowEl.addEventListener('dragleave', () => rowEl.classList.remove('drop-target'));
      rowEl.addEventListener('drop', (e) => {
        e.preventDefault();
        rowEl.classList.remove('drop-target');
        if (from != null) move(from, Number(rowEl.dataset.index));
        from = null;
      });
    });
  };

  draw();
  return {
    getValue: () => ({ list: list.map((b) => ({ ...b })), thresholds: { ...th }, sourceDate }),
    errors,
    isDirty: () => JSON.stringify({ list, th }) !== initial,
    /** Fetch the references again (e.g. the wizard's staffing changed the "Hòa vốn" cost). */
    reloadReferences: () => { refKey = ''; return ensureRefs(); },
    /** Close every "Tham chiếu" block (entering the wizard step again starts hidden). */
    closeReferences: () => { for (const k of Object.keys(refOpen)) refOpen[k] = false; list.forEach((_, i) => fillRef(i)); },
  };
}
