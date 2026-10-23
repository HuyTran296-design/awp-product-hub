// Stop-loss policy form: general settings, conditions (each with its own switch), milestones,
// trigger rule and action. Used by the project tab and the team default policy.

import { esc, parseVnd } from '../ui.js';
import { formatNumber } from '/shared/format.js';
import { METRIC_CATALOG } from '/shared/metric-catalog.js';
import { ACTION_LABELS, MILESTONE_KINDS, monthsOfCost } from '/shared/stop-loss.js';

/**
 * @param {HTMLElement} el
 * @param {{policy:object, monthlyCost?:number, defaultStartText?:string, onChange?:Function}} o
 */
export function createStopLossEditor(el, o) {
  let p = structuredClone(o.policy);
  p.budgetOverrun ??= { on: false, pct: 100 };
  p.lateLaunch ??= { on: false, days: 30 };
  const initial = JSON.stringify(p);
  let seq = 0;

  const sw = (path, checked, label) => `<label class="switch"><input type="checkbox" data-bool="${path}" ${checked ? 'checked' : ''}><span>${label}</span></label>`;
  const num = (path, value, { suffix = '', vnd = false, min = 0, max = '', step = 1, width = 120 } = {}) =>
    `<span class="input-suffix" data-suffix="${suffix}" style="display:inline-block;width:${width}px;vertical-align:middle">
      <input class="input right" style="padding-right:${suffix.length > 2 ? 52 : 30}px" ${vnd ? 'inputmode="numeric" data-vnd' : `type="number" min="${min}" max="${max}" step="${step}"`}
        data-num="${path}" value="${vnd ? formatNumber(value) : value ?? ''}"></span>`;

  const milestoneRow = (m, i) => `<div class="ms-row" data-ms="${i}">
    ${sw(`milestones.${i}.on`, m.on !== false, '')}
    <label class="field"><span>Ngày mốc</span><input class="input" type="date" data-str="milestones.${i}.date" value="${esc(m.date)}"></label>
    <label class="field"><span>Chỉ tiêu phải đạt</span><select class="input" data-str="milestones.${i}.kind">${Object.entries(MILESTONE_KINDS).map(([k, l]) =>
      `<option value="${k}" ${k === m.kind ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    ${m.kind === 'baseline' ? `<label class="field"><span>Baseline</span><select class="input" data-str="milestones.${i}.metricKey">${METRIC_CATALOG.map((d) =>
      `<option value="${d.key}" ${d.key === m.metricKey ? 'selected' : ''}>${esc(d.short)}</option>`).join('')}</select></label>` : ''}
    ${m.kind === 'breakeven' ? '' : `<label class="field"><span>${m.kind === 'baseline' ? 'Giá trị ≥' : m.kind === 'revenue_ratio' ? 'Z (% chi phí)' : 'Y (%)'}</span>
      ${num(`milestones.${i}.value`, m.value, { suffix: m.kind === 'baseline' ? '' : '%', step: m.kind === 'baseline' ? 'any' : 1, width: 130 })}</label>`}
    <button type="button" class="icon-btn" data-ms-remove="${i}" aria-label="Xóa mốc">✕</button>
  </div>`;

  const draw = (notify = true) => {
    el.innerHTML = `<div class="stack" style="gap:18px">
      <section>
        <h3 style="margin-bottom:10px">A. Thiết lập chung</h3>
        <div class="form-grid" style="align-items:end">
          ${sw('enabled', p.enabled, '<b>Bật phương án cắt lỗ</b>')}
          <label class="field"><span>Ngày bắt đầu theo dõi</span><input class="input" type="date" data-str="startDate" value="${esc(p.startDate ?? '')}">
            <span class="hint">${p.startDate ? '' : `Để trống = ngày bắt đầu tính chi phí${o.defaultStartText ? ` (${esc(o.defaultStartText)})` : ''}`}</span></label>
          <label class="field"><span>Ngưỡng cảnh báo sớm</span>${num('warnPct', p.warnPct, { suffix: '%', min: 1, max: 99, width: 140 })}</label>
        </div>
      </section>
      <section>
        <h3 style="margin-bottom:10px">B. Điều kiện cắt lỗ</h3>
        <div class="cond-list">
          <div class="cond">${sw('cumulativeLoss.on', p.cumulativeLoss.on, '1. Lỗ lũy kế vượt')} ${num('cumulativeLoss.amount', p.cumulativeLoss.amount, { suffix: '₫', vnd: true, width: 180 })}
            <div class="note" data-months-of-cost></div></div>
          <div class="cond">${sw('consecutiveLoss.on', p.consecutiveLoss.on, '2. Lỗ liên tiếp')} ${num('consecutiveLoss.months', p.consecutiveLoss.months, { suffix: 'tháng', min: 1, width: 120 })}</div>
          <div class="cond">${sw('lowHealth.on', p.lowHealth.on, '3. Điểm sức khỏe <')} ${num('lowHealth.below', p.lowHealth.below, { suffix: '%', min: 1, max: 120, width: 100 })}
            trong ${num('lowHealth.months', p.lowHealth.months, { suffix: 'tháng', min: 1, width: 120 })} liên tiếp</div>
          <div class="cond">${sw('budgetOverrun.on', p.budgetOverrun?.on, '5. Chi phí lũy kế vượt')} ${num('budgetOverrun.pct', p.budgetOverrun?.pct ?? 100, { suffix: '%', min: 1, width: 100 })} ngân sách giai đoạn Xây dựng
            <div class="note">Cảnh báo sớm khi đạt ${formatNumber(p.warnPct)}% mức này.</div></div>
          <div class="cond">${sw('lateLaunch.on', p.lateLaunch?.on, '6. Chưa ra mắt khi qua ngày ra mắt dự kiến +')} ${num('lateLaunch.days', p.lateLaunch?.days ?? 30, { suffix: 'ngày', min: 0, width: 120 })}</div>
          <div class="cond"><div style="font-weight:600;margin-bottom:6px">4. Mốc thời gian</div>
            <div class="stack" style="gap:8px">${p.milestones.map(milestoneRow).join('') || '<div class="note">Chưa có mốc nào.</div>'}</div>
            <button type="button" class="btn sm" data-ms-add style="margin-top:8px">＋ Thêm mốc</button></div>
        </div>
        <label class="field" style="margin-top:12px;max-width:420px"><span>Quy tắc kích hoạt</span>
          <span>Chạm ngưỡng khi có ít nhất <select class="input" data-num="triggerCount" style="width:auto;display:inline-block">${[1, 2, 3, 4, 5, 6].map((n) =>
            `<option ${n === p.triggerCount ? 'selected' : ''}>${n}</option>`).join('')}</select> điều kiện thỏa</span></label>
      </section>
      <section>
        <h3 style="margin-bottom:10px">C. Phương án xử lý khi chạm ngưỡng</h3>
        <div class="radio-row">${Object.entries(ACTION_LABELS).map(([k, l]) => `<label class="radio-card" style="flex:1 1 180px">
          <input type="radio" name="sl-action" value="${k}" ${p.action.type === k ? 'checked' : ''}><span><b>${l}</b>
          ${k === 'reduce_effort' ? `<br><span class="small">xuống ${num('action.effortPct', p.action.effortPct, { suffix: '%', min: 1, max: 99, width: 96 })} so với hiện tại</span>` : ''}
          ${k === 'review' ? '<br><span class="small muted">Chỉ tạo đề xuất, không kèm thao tác</span>' : ''}</span></label>`).join('')}</div>
        <p class="note">Chọn trước, có thể chọn lại khi ra quyết định. Hệ thống không bao giờ tự động dừng dự án.</p>
      </section>
    </div>`;
    bind();
    refresh(notify);
  };

  const set = (path, value) => {
    const keys = path.split('.');
    let t = p;
    for (const k of keys.slice(0, -1)) t = t[k];
    t[keys.at(-1)] = value;
  };

  const refresh = (notify = true) => {
    const mc = monthsOfCost(p.cumulativeLoss.amount, o.monthlyCost);
    const note = el.querySelector('[data-months-of-cost]');
    if (note) note.textContent = mc == null ? 'Chưa có chi phí tháng để quy đổi.' : `≈ ${formatNumber(mc, 1)} tháng chi phí của dự án`;
    el.querySelectorAll('.cond').forEach((c) => c.classList.toggle('off', !c.querySelector('[data-bool]')?.checked && !c.querySelector('[data-ms-add]')));
    if (notify) o.onChange?.();
  };

  const bind = () => {
    el.querySelectorAll('[data-bool]').forEach((i) => i.addEventListener('change', () => { set(i.dataset.bool, i.checked); refresh(); }));
    el.querySelectorAll('[data-num]').forEach((i) => {
      const read = () => (i.hasAttribute('data-vnd') ? parseVnd(i.value) : i.value === '' ? NaN : Number(i.value));
      i.addEventListener(i.tagName === 'SELECT' ? 'change' : 'input', () => { set(i.dataset.num, read()); refresh(); });
      if (i.hasAttribute('data-vnd')) i.addEventListener('blur', () => { const v = read(); if (Number.isFinite(v)) i.value = formatNumber(v); });
    });
    el.querySelectorAll('[data-str]').forEach((i) => i.addEventListener(i.tagName === 'SELECT' ? 'change' : 'input', () => {
      set(i.dataset.str, i.value || null);
      if (i.dataset.str.endsWith('.kind')) {
        const m = p.milestones[Number(i.dataset.str.split('.')[1])];
        if (m.kind === 'baseline' && !m.metricKey) m.metricKey = 'dau';
        draw();
      } else refresh();
    }));
    el.querySelectorAll('input[name="sl-action"]').forEach((r) => r.addEventListener('change', () => { p.action.type = r.value; refresh(); }));
    el.querySelector('[data-ms-add]').addEventListener('click', () => {
      p.milestones.push({ id: `new${Date.now().toString(36)}${seq++}`, on: true, date: '', kind: 'revenue_ratio', value: 80 });
      draw();
    });
    el.querySelectorAll('[data-ms-remove]').forEach((b) => b.addEventListener('click', () => { p.milestones.splice(Number(b.dataset.msRemove), 1); draw(); }));
  };

  draw(false); // initial render: the caller is not wired up yet
  return {
    getValue: () => structuredClone(p),
    isDirty: () => JSON.stringify(p) !== initial,
    errors: () => {
      const e = [];
      if (!(p.warnPct > 0 && p.warnPct < 100)) e.push('Ngưỡng cảnh báo sớm phải trong khoảng 1–99%.');
      if (p.cumulativeLoss.on && !(p.cumulativeLoss.amount > 0)) e.push('Ngưỡng lỗ lũy kế phải lớn hơn 0.');
      for (const m of p.milestones) {
        if (!m.date) e.push('Mỗi mốc cần có ngày.');
        if (m.kind !== 'breakeven' && !(m.value > 0)) e.push(`Mốc ${m.date || '(chưa có ngày)'}: nhập giá trị chỉ tiêu.`);
      }
      if (p.action.type === 'reduce_effort' && !(p.action.effortPct > 0 && p.action.effortPct < 100)) e.push('Mức giảm effort phải trong khoảng 1–99%.');
      return e;
    },
  };
}

