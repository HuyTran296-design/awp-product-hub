// "Thêm dự án" — 4 steps: 1 Thông tin (tên, mô tả, màu, icon, ngưỡng màu) · 2 Nhân sự chung (không bắt buộc, cách chia) ·
// 3 Mẫu cho sản phẩm mới (không bắt buộc) · 4 Xem lại & kích hoạt. Activation needs neither staff nor baselines.

import { get, post } from '../api.js';
import { createBaselineEditor } from '../components/baseline-editor.js';
import { createFolderInfoForm } from '../components/folder-info-form.js';
import { impactPreviewHtml } from '../components/impact-preview.js';
import { PLATFORM_OPTIONS } from '../components/project-info-form.js';
import { createStaffingEditor } from '../components/staffing-editor.js';
import { createStopLossEditor } from '../components/stoploss-editor.js';
import { debounce, esc, toast } from '../ui.js';
import { PARENT_SPLIT_METHODS } from '/shared/cost-calculator.js';
import { formatDate, formatNumber } from '/shared/format.js';
import { getMetricDef } from '/shared/metric-catalog.js';
import { DEFAULT_POLICY } from '/shared/stop-loss.js';

const STEPS = ['Thông tin', 'Nhân sự chung', 'Mẫu cho sản phẩm mới', 'Xem lại & kích hoạt'];

export async function renderFolderWizard(root, ctx) {
  const meta = ctx.state.meta;
  const sctx = await get(`/api/staffing-context?date=${meta.firstOpenDate}`);
  if (!ctx.isCurrent()) return;
  let step = 0;
  let maxStep = 0;
  let created = false;
  let activate = true;
  let activationDate = meta.today >= meta.firstOpenDate ? meta.today : meta.firstOpenDate;
  let method = 'even';
  let useTemplate = false;
  let previewErrors = [];

  root.innerHTML = `
    ${ctx.pageHeader({ title: 'Thêm dự án', crumb: '<a href="#/config/projects">Quản lý dự án & sản phẩm</a> · 4 bước' })}
    <nav class="stepper" aria-label="Các bước">${STEPS.map((s, i) => `<button type="button" class="step" data-step="${i}"><span class="n">${i + 1}</span>${s}</button>`).join('')}</nav>
    <section class="card">
      ${STEPS.map((s, i) => `<div data-panel="${i}" hidden><h2 style="margin-bottom:14px">${i + 1}. ${s}</h2><div data-host="${i}"></div></div>`).join('')}
      <div data-step-errors style="margin-top:12px"></div>
      <div class="wizard-actions"><button type="button" class="btn" data-back>← Quay lại</button>
        <div style="display:flex;gap:8px"><button type="button" class="btn" data-draft hidden>Lưu nháp</button>
        <button type="button" class="btn primary" data-next>Tiếp →</button></div></div>
    </section>`;
  ctx.bindPageHeader(root);
  const $ = (s) => root.querySelector(s);
  const host = (i) => root.querySelector(`[data-host="${i}"]`);

  const info = createFolderInfoForm(host(0), { info: { name: '', color: '#C2410C', icon: '📁', description: '' } });

  host(1).innerHTML = `<p class="note" style="margin-top:0">Không bắt buộc. Nhân sự chung của dự án làm cho các sản phẩm; chi phí luôn được chia xuống các sản phẩm đang chạy.
      Khi dự án chưa có sản phẩm đang chạy, phần chi phí này nằm ở "Chưa phân bổ" của Chi phí team.</p>
    <div data-staff></div>
    <label class="field" style="margin-top:12px;max-width:380px"><span>Cách chia cho sản phẩm</span><select class="input" data-method>${Object.entries(PARENT_SPLIT_METHODS).map(([k, l]) =>
      `<option value="${k}" ${k === method ? 'selected' : ''}>${esc(l)}${k === 'even' ? ' (mặc định)' : ''}</option>`).join('')}</select>
      <span class="hint">"Thủ công %" nhập % cho từng sản phẩm ở tab Nhân sự chung sau khi dự án đã có sản phẩm.</span></label>`;
  const staffing = createStaffingEditor(host(1).querySelector('[data-staff]'), { context: { ...sctx, allocationMode: 'fte' }, rows: [], manualAllocPct: 0, optional: true });
  host(1).querySelector('[data-method]').addEventListener('change', (e) => { method = e.target.value; });

  host(2).innerHTML = `<label class="check-chip" style="align-self:flex-start"><input type="checkbox" data-use-template>Thiết lập mẫu cho sản phẩm mới <span class="muted">(không bắt buộc)</span></label>
    <div data-template hidden style="margin-top:12px">
      <p class="note" style="margin-top:0">Thêm sản phẩm vào dự án này → wizard tự điền theo mẫu (sửa được).</p>
      <div class="field"><span>Nền tảng phát hành mặc định</span><div class="chips" data-plat>${PLATFORM_OPTIONS.map(([v, l]) =>
        `<label class="check-chip"><input type="checkbox" value="${v}" ${['ios', 'android'].includes(v) ? 'checked' : ''}>${l}</label>`).join('')}</div></div>
      <h3 style="margin:16px 0 8px">Baseline, trọng số, mục tiêu & ngưỡng mặc định</h3><div data-baselines></div>
      <h3 style="margin:16px 0 8px">Phương án cắt lỗ mặc định</h3><div data-sl></div>
    </div>`;
  const platforms = () => [...host(2).querySelectorAll('[data-plat] input:checked')].map((i) => i.value);
  const bl = createBaselineEditor(host(2).querySelector('[data-baselines]'), {
    baselines: [{ metricKey: 'revenue', weight: 100, targetMonthly: 20_000_000, source: 'auto', period: 'month' }],
    thresholds: { green: 80, red: 50 }, productType: platforms(), sourceDateEditable: false });
  const sl = createStopLossEditor(host(2).querySelector('[data-sl]'), { policy: { ...DEFAULT_POLICY }, isDefault: true });
  host(2).querySelector('[data-use-template]').addEventListener('change', (e) => {
    useTemplate = e.target.checked;
    host(2).querySelector('[data-template]').hidden = !useTemplate;
  });

  ctx.setGuard(() => !created && (info.isDirty() || staffing.isDirty() || useTemplate));

  const stepErrors = (i) => {
    if (i === 0) return info.errors();
    if (i === 1 && staffing.hasLocalErrors()) return staffing.localErrors().length ? staffing.localErrors() : ['Nhập đủ chi phí và % effort cho từng nhân sự.'];
    if (i === 2 && useTemplate) return [...bl.errors(), ...sl.errors()];
    return [];
  };
  const showErrors = (list) => {
    $('[data-step-errors]').innerHTML = list.length ? `<div class="alert error"><ul>${list.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
  };

  const payload = (act) => ({
    info: { ...info.getValue(), kind: 'folder' }, staffing: staffing.getValue(), parentSplit: { method }, activate: act, activationDate,
    ...(useTemplate ? { childTemplate: { platforms: platforms(), baselines: bl.getValue().list, thresholds: bl.getValue().thresholds, stopLoss: sl.getValue() } } : {}),
  });

  const go = (i) => {
    step = i;
    maxStep = Math.max(maxStep, i);
    root.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = Number(p.dataset.panel) !== i; });
    root.querySelectorAll('[data-step]').forEach((b) => {
      const n = Number(b.dataset.step);
      b.toggleAttribute('aria-current', n === i);
      if (n === i) b.setAttribute('aria-current', 'step');
      b.classList.toggle('done', n < maxStep && n !== i);
    });
    $('[data-back]').disabled = i === 0;
    $('[data-next]').textContent = i === STEPS.length - 1 ? (activate ? 'Tạo & kích hoạt dự án' : 'Tạo dự án nháp') : 'Tiếp →';
    $('[data-draft]').hidden = i !== STEPS.length - 1 || !activate;
    showErrors([]);
    if (i === STEPS.length - 1) drawReview();
  };

  const drawReview = () => {
    const v = info.getValue();
    const s = staffing.getValue();
    host(3).innerHTML = `<div class="two-col"><div class="stack">
        <div class="fin-list">
          <div class="fin-row"><span class="label">Dự án</span><span class="value">${v.icon ? `${esc(v.icon)} ` : ''}<span class="dot" style="background:${esc(v.color)}"></span> ${esc(v.name || '—')}</span></div>
          ${v.description ? `<div class="fin-row"><span class="label">Mô tả</span><span class="value small">${esc(v.description)}</span></div>` : ''}
          <div class="fin-row"><span class="label">Ngưỡng màu điểm tổng hợp</span><span class="value">Tốt &gt; ${formatNumber(v.thresholds.green)}% · Báo động &lt; ${formatNumber(v.thresholds.red)}%</span></div>
          <div class="fin-row"><span class="label">Nhân sự chung</span><span class="value">${s.rows.length ? `${s.rows.length} người · FTE ${formatNumber(s.rows.reduce((a, r) => a + r.effortPct, 0) / 100, 1)} · ${esc(PARENT_SPLIT_METHODS[method])}` : 'Không có'}</span></div>
          <div class="fin-row"><span class="label">Mẫu cho sản phẩm mới</span><span class="value">${useTemplate ? bl.getValue().list.map((x) => esc(getMetricDef(x.metricKey).short)).join(' · ') : 'Không dùng'}</span></div>
        </div>
        ${s.rows.length ? '<div class="alert warn">Dự án chưa có sản phẩm để chia chi phí — chi phí nhân sự chung sẽ nằm ở "Chưa phân bổ" cho đến khi có sản phẩm đang chạy.</div>' : ''}
        <div class="field"><span>Trạng thái khi tạo</span><div class="radio-row">
          <label class="radio-card"><input type="radio" name="mode" value="activate" ${activate ? 'checked' : ''}><span><b>Kích hoạt dự án (Đang chạy)</b><br>
            <span class="small muted">Không cần nhân sự hay baseline</span></span></label>
          <label class="radio-card"><input type="radio" name="mode" value="draft" ${activate ? '' : 'checked'}><span><b>Lưu nháp</b><br>
            <span class="small muted">Kích hoạt sau</span></span></label></div></div>
        ${activate ? `<label class="field" style="max-width:220px"><span>Ngày hiệu lực</span>
          <input class="input" type="date" data-activation min="${meta.firstOpenDate}" value="${activationDate}">
          <span class="hint">Không chọn được tháng đã chốt sổ (trước ${formatDate(meta.firstOpenDate)}).</span></label>` : ''}
      </div>
      <div>${activate && s.rows.length ? '<h3 style="margin-bottom:8px">Xem trước tác động</h3><div data-preview class="note">Đang tính…</div>' : ''}</div></div>`;
    host(3).querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', () => { activate = r.value === 'activate'; go(step); }));
    host(3).querySelector('[data-activation]')?.addEventListener('change', (e) => { activationDate = e.target.value; refreshPreview(); });
    if (activate) refreshPreview();
  };

  const refreshPreview = debounce(async () => {
    try {
      const r = await post('/api/projects/preview', payload(true));
      const el = host(3).querySelector('[data-preview]');
      if (el) el.innerHTML = impactPreviewHtml(r.preview, { focusId: -1 });
      previewErrors = r.errors;
    } catch (err) { previewErrors = [err.message]; }
    showErrors(previewErrors);
  }, 250);

  const submit = async (act) => {
    for (const i of [0, 1, 2]) {
      const errs = stepErrors(i);
      if (errs.length) { go(i); showErrors(errs); return; }
    }
    if (act && previewErrors.length) return showErrors(previewErrors);
    try {
      const { project } = await post('/api/projects', payload(act));
      created = true;
      ctx.setGuard(null);
      await ctx.refreshMeta();
      toast(act ? `Đã tạo và kích hoạt dự án ${project.name}.` : `Đã lưu nháp dự án ${project.name}.`);
      ctx.navigate(`#/config/projects/${project.id}`);
    } catch (err) { showErrors([err.message]); }
  };

  $('[data-back]').addEventListener('click', () => go(Math.max(0, step - 1)));
  $('[data-next]').addEventListener('click', () => {
    if (step === STEPS.length - 1) return submit(activate);
    const errs = stepErrors(step);
    if (errs.length) return showErrors(errs);
    go(step + 1);
  });
  $('[data-draft]').addEventListener('click', () => submit(false));
  root.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
    const target = Number(b.dataset.step);
    if (target > maxStep) {
      for (let i = step; i < target; i++) { const errs = stepErrors(i); if (errs.length) { go(i); showErrors(errs); return; } }
    }
    go(target);
  }));
  go(0);
}
