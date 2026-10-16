// Two wizards: "Thêm dự án" (#/config/projects/new, 4 steps, project-folder-wizard.js) and "Thêm sản phẩm"
// (#/config/products/new[?project=ID], 5 steps mirroring the edit tabs: 1 Thông tin (incl. "Thuộc dự án", required) ·
// 2 Kết nối dữ liệu · 3 Nhân sự & chi phí · 4 Baseline & trọng số · 5 Xem lại & kích hoạt).
// All panels stay mounted so moving between steps keeps what was typed.

import { get, post } from '../api.js';
import { createBaselineEditor } from '../components/baseline-editor.js';
import { createConnectionForms } from '../components/connection-forms.js';
import { renderFolderWizard } from './project-folder-wizard.js';
import { impactPreviewHtml } from '../components/impact-preview.js';
import { createInfoForm } from '../components/project-info-form.js';
import { createStaffingEditor } from '../components/staffing-editor.js';
import { debounce, esc, toast } from '../ui.js';
import { formatDate, formatNumber } from '/shared/format.js';
import { getMetricDef } from '/shared/metric-catalog.js';
import { SUGGESTED_CONNECTIONS } from '/shared/product-types.js';
import { connectionsFor, platformLabel, productTypeFor } from '/shared/release-platforms.js';
import { PHASES, suggestedBaselines } from '/shared/phases.js';

const STEPS = ['Thông tin', 'Kết nối dữ liệu', 'Nhân sự & chi phí', 'Baseline & trọng số', 'Xem lại & kích hoạt'];

export async function render(root, ctx) {
  if (location.hash.startsWith('#/config/products/new')) return renderProductWizard(root, ctx);
  return renderFolderWizard(root, ctx);
}

/** "Thêm sản phẩm". */
async function renderProductWizard(root, ctx) {
  const meta = ctx.state.meta;
  const [sctx, parentList] = await Promise.all([get(`/api/staffing-context?date=${meta.firstOpenDate}`), get('/api/parent-options')]);
  const parents = parentList.options;
  let template = null; // "Mẫu cho sản phẩm mới" of the chosen Dự án
  if (!ctx.isCurrent()) return;
  let step = 0;
  let maxStep = 0;
  let created = false;
  let activate = true;
  let activationDate = meta.today >= meta.firstOpenDate ? meta.today : meta.firstOpenDate;
  let previewErrors = [];

  root.innerHTML = `
    ${ctx.pageHeader({ title: 'Thêm sản phẩm', crumb: '<a href="#/config/projects">Quản lý dự án & sản phẩm</a> · 5 bước' })}
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

  // Opened from a Dự án (?project=ID) → "Thuộc dự án" is pre-filled.
  const preParent = parents.some((p) => p.id === Number(ctx.query.project)) ? Number(ctx.query.project) : null;
  const info = createInfoForm(host(0), { info: { name: '', color: '#C2410C', platforms: ['ios', 'android', 'web', 'blog'], phase: 'growth', parentId: preParent },
    phases: PHASES, parentOptions: parents, onParentChange: (id) => pickParent(id) });
  host(1).innerHTML = '<div data-suggest></div><div data-conns></div>';
  // Connections follow the selected release platforms (re-created when they change, keeping nothing stale).
  let conns;
  let connKey = '';
  const ensureConns = () => {
    const key = info.getValue().platforms.join(',');
    if (conns && key === connKey) return;
    connKey = key;
    conns = createConnectionForms(host(1).querySelector('[data-conns]'), { mode: 'collect', sources: connectionsFor(info.getValue().platforms) });
  };
  ensureConns();

  /** Dự án chosen: pre-fill platforms, baselines, thresholds and stop-loss from its "Mẫu cho sản phẩm mới" (all still editable). */
  function pickParent(id) {
    const parent = parents.find((p) => p.id === id);
    template = parent?.template ?? null;
    if (template?.platforms?.length) info.setPlatforms(template.platforms);
    baselineKey = '';
    if (baselines && !baselines.isDirty()) baselines = null;
    ensureBaselines();
    toast(template?.baselines?.length ? `Đã điền sẵn theo mẫu của ${parent.name} (sửa được).` : `${parent?.name ?? 'Dự án'} chưa có mẫu cho sản phẩm mới.`);
  }
  host(2).innerHTML = `<p class="note" style="margin-top:0">Phân công áp dụng từ ngày kích hoạt (chọn ở bước 5). "Còn trống" tính theo phân bổ hiện tại của từng người.</p><div data-staff></div>`;
  const staffing = createStaffingEditor(host(2).querySelector('[data-staff]'), { context: sctx, rows: [], manualAllocPct: 0 });
  // Baselines follow the chosen product type and phase until the Admin edits them.
  let baselines;
  let baselineKey = '';
  const ensureBaselines = () => {
    const v = info.getValue();
    const key = `${v.platforms.join(',')}|${v.phase}|${v.parentId ?? ''}`;
    if (baselines && (key === baselineKey || baselines.isDirty())) return;
    baselineKey = key;
    const fromTemplate = template?.baselines?.length && v.phase !== 'build';
    baselines = createBaselineEditor(host(3), {
      baselines: fromTemplate ? template.baselines : suggestedBaselines(v.phase, productTypeFor(v.platforms)),
      thresholds: (fromTemplate && template.thresholds) || { green: 80, red: 50 },
      productType: v.platforms, sourceDateEditable: false,
      // New project: no own data → siblings under the chosen parent; "Hòa vốn" from the staffing of step 3.
      loadReferences: async (metrics) => (await post('/api/baseline-references', { parentId: info.getValue().parentId ?? null, metrics,
        staffing: staffing.getValue() })).references });
  };
  ensureBaselines();
  if (preParent) pickParent(preParent);

  ctx.setGuard(() => !created && (info.isDirty() || conns.isDirty() || staffing.isDirty() || Boolean(baselines?.isDirty())));

  const stepErrors = (i) => {
    if (i === 0) return info.errors();
    if (i === 2) {
      if (!staffing.hasLocalErrors()) return [];
      return staffing.localErrors().length ? staffing.localErrors() : ['Nhập đủ chi phí và % effort cho từng nhân sự.'];
    }
    if (i === 3) { ensureBaselines(); return baselines.errors(); }
    return [];
  };

  const showErrors = (list) => {
    $('[data-step-errors]').innerHTML = list.length ? `<div class="alert error"><ul>${list.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
  };

  const go = (i) => {
    if (i === 1) {
      ensureConns();
      const hint = info.getValue().platforms.includes('playables') ? SUGGESTED_CONNECTIONS.youtube_playables : null;
      host(1).querySelector('[data-suggest]').innerHTML = hint ? `<div class="alert info" style="margin-bottom:12px">Kết nối gợi ý: ${esc(hint)}. Các baseline không có kết nối có thể nhập thủ công hoặc tải CSV.</div>` : '';
    }
    if (i === 3) { ensureBaselines(); baselines.closeReferences(); baselines.reloadReferences(); }
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
    $('[data-next]').textContent = i === STEPS.length - 1 ? (activate ? 'Tạo & kích hoạt sản phẩm' : 'Tạo sản phẩm nháp') : 'Tiếp →';
    $('[data-draft]').hidden = i !== STEPS.length - 1 || !activate;
    showErrors([]);
    if (i === STEPS.length - 1) drawReview();
  };

  const drawReview = () => {
    const v = info.getValue();
    const s = staffing.getValue();
    const b = baselines.getValue();
    host(4).innerHTML = `
      <div class="two-col">
        <div class="stack">
          <div class="fin-list">
            <div class="fin-row"><span class="label">Sản phẩm</span><span class="value"><span class="dot" style="background:${esc(v.color)}"></span> ${esc(v.name || '—')}</span></div>
            <div class="fin-row"><span class="label">Thuộc dự án</span><span class="value">${esc(parents.find((p) => p.id === v.parentId)?.name ?? '—')}</span></div>
            <div class="fin-row"><span class="label">Nền tảng phát hành</span><span class="value">${v.platforms.map((p) => esc(platformLabel(p))).join(' · ')}</span></div>
            ${template?.stopLoss ? '<div class="fin-row"><span class="label">Phương án cắt lỗ</span><span class="value">Theo mẫu của dự án</span></div>' : ''}
            <div class="fin-row"><span class="label">Giai đoạn</span><span class="value">${esc(PHASES[v.phase] ?? '—')}</span></div>
            <div class="fin-row"><span class="label">Kết nối dữ liệu</span><span class="value">${conns.summary().map((c) => `${c.name}: ${c.configured ? 'có' : 'chưa'}`).join(' · ')}</span></div>
            <div class="fin-row"><span class="label">Nhân sự</span><span class="value">${s.rows.length} người · FTE ${formatNumber(s.rows.reduce((a, r) => a + r.effortPct, 0) / 100, 1)}</span></div>
            <div class="fin-row"><span class="label">Baseline</span><span class="value">${b.list.map((x) => esc(getMetricDef(x.metricKey).short)).join(' · ')}</span></div>
          </div>
          <div class="field"><span>Trạng thái khi tạo</span><div class="radio-row">
            <label class="radio-card"><input type="radio" name="mode" value="activate" ${activate ? 'checked' : ''}><span><b>Kích hoạt sản phẩm (Đang chạy)</b><br>
              <span class="small muted">Nhận effort và chi phí chung từ ngày hiệu lực</span></span></label>
            <label class="radio-card"><input type="radio" name="mode" value="draft" ${activate ? '' : 'checked'}><span><b>Lưu nháp</b><br>
              <span class="small muted">Chưa phát sinh chi phí, kích hoạt sau</span></span></label></div></div>
          ${activate ? `<label class="field" style="max-width:220px"><span>Ngày hiệu lực</span>
            <input class="input" type="date" data-activation min="${meta.firstOpenDate}" value="${activationDate}">
            <span class="hint">Không chọn được tháng đã chốt sổ (trước ${formatDate(meta.firstOpenDate)}).</span></label>` : ''}
        </div>
        <div>${activate ? '<h3 style="margin-bottom:8px">Xem trước tác động</h3><div data-preview class="note">Đang tính…</div>' : '<div class="alert info">Sản phẩm nháp không ảnh hưởng chi phí team.</div>'}</div>
      </div>`;
    host(4).querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', () => { activate = r.value === 'activate'; go(step); }));
    host(4).querySelector('[data-activation]')?.addEventListener('change', (e) => { activationDate = e.target.value; refreshPreview(); });
    if (activate) refreshPreview();
  };

  const payload = (act) => (ensureBaselines(), {
    info: info.getValue(), connections: conns.getValue(), staffing: staffing.getValue(),
    baselines: baselines.getValue(), activate: act, activationDate,
    ...(template?.stopLoss ? { stopLoss: template.stopLoss } : {}),
  });

  const refreshPreview = debounce(async () => {
    try {
      const r = await post('/api/projects/preview', payload(true));
      const el = host(4).querySelector('[data-preview]');
      if (el) el.innerHTML = impactPreviewHtml(r.preview, { focusId: -1 });
      previewErrors = r.errors;
    } catch (err) { previewErrors = [err.message]; }
    showErrors(previewErrors);
  }, 250);

  const submit = async (act) => {
    for (const i of [0, 3]) {
      const errs = stepErrors(i);
      if (errs.length) { go(i); showErrors(errs); return; }
    }
    if (act && previewErrors.length) return showErrors(previewErrors);
    try {
      const { project } = await post('/api/projects', payload(act));
      created = true;
      ctx.setGuard(null);
      await ctx.refreshMeta();
      toast(act ? `Đã tạo và kích hoạt ${project.name}.` : `Đã lưu nháp ${project.name}.`);
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
      // Jumping ahead requires the steps in between to be valid.
      for (let i = step; i < target; i++) { const errs = stepErrors(i); if (errs.length) { go(i); showErrors(errs); return; } }
    }
    go(target);
  }));
  go(0);
}
