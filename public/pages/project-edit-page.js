// Quản lý dự án → chỉnh sửa: Thông tin · Kết nối dữ liệu · Nhân sự & chi phí · Baseline & trọng số ·
// Phương án cắt lỗ · Lịch sử thay đổi.
// Unsaved changes are guarded (in-page dialog) when switching tabs or leaving the page.

import { get, post, put } from '../api.js';
import { createBaselineEditor } from '../components/baseline-editor.js';
import { createConnectionForms } from '../components/connection-forms.js';
import { impactPreviewHtml } from '../components/impact-preview.js';
import { openLifecycleDialog } from '../components/lifecycle-dialog.js';
import { createInfoForm } from '../components/project-info-form.js';
import { createStaffingEditor } from '../components/staffing-editor.js';
import { createStopLossEditor } from '../components/stoploss-editor.js';
import { openProposalDialog } from '../components/proposal-dialog.js';
import { openPhaseDialog } from '../components/phase-dialog.js';
import { createCsvUpload } from '../components/csv-upload.js';
import { confirmDialog, debounce, esc, lifecycleBadge, monthOptions, stopLossBadge, toast } from '../ui.js';
import { connectionsFor } from '/shared/release-platforms.js';
import { createPromoSourcesEditor } from '../components/promo-sources-editor.js';
import { formatDate, formatDateTime, formatNumber } from '/shared/format.js';

const TABS = [['info', 'Thông tin'], ['connections', 'Kết nối dữ liệu'], ['staffing', 'Nhân sự & chi phí'],
  ['baselines', 'Baseline & trọng số'], ['stoploss', 'Phương án cắt lỗ'], ['history', 'Lịch sử thay đổi']];

export async function render(root, ctx) {
  const [projectId] = ctx.params;
  let data = await get(`/api/projects/${projectId}/edit`);
  if (!ctx.isCurrent()) return;
  let tab = TABS.some(([k]) => k === ctx.query.tab) ? ctx.query.tab : 'info';
  let editor = null; // active tab's editor ({ isDirty })

  ctx.setGuard(() => Boolean(editor?.isDirty()));

  const draw = async () => {
    const p = data.project;
    const st = data.status;
    root.innerHTML = `
      ${ctx.pageHeader({
        title: `<span style="display:inline-flex;align-items:center;gap:10px"><span class="project-swatch" style="background:${esc(p.color)};height:24px"></span>${esc(p.name)}</span>`,
        crumb: '<a href="#/config/projects">Quản lý dự án</a> · Chỉnh sửa',
        extra: `<div class="chips" style="align-items:center">${lifecycleBadge(st.status, st.label)}
          ${st.pending ? `<span class="note">→ ${esc(st.latestLabel)} từ ${formatDate(st.pending.date)}</span>` : ''}
          <a class="btn sm" href="#/projects/${p.id}/overview">Mở dashboard</a>
          ${data.actions.map((a) => `<button class="btn sm${a.action === 'delete' || a.action === 'archive' ? ' danger' : ''}" data-action="${a.action}"
            ${a.locked ? `disabled data-tip="${esc(a.tip)}"` : ''}>${esc(a.label)}</button>`).join('')}</div>`,
      })}
      <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`).join('')}</div>
      <section class="card" id="tab-body"></section>`;
    ctx.bindPageHeader(root);
    root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.tab === tab || !(await confirmLeaveTab())) return;
      tab = b.dataset.tab;
      history.replaceState(null, '', `#/config/projects/${projectId}?tab=${tab}`);
      draw();
    }));
    root.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmLeaveTab())) return;
      const a = data.actions.find((x) => x.action === b.dataset.action);
      openLifecycleDialog({
        project: p, action: a.action, label: a.label, status: st.latest, latestDate: st.latestDate,
        firstOpenDate: data.firstOpenDate, today: data.today,
        onDone: async (action) => {
          await ctx.refreshMeta();
          if (action === 'delete') { ctx.setGuard(null); ctx.navigate('#/config/projects'); return; }
          data = await get(`/api/projects/${projectId}/edit`);
          draw();
        },
      });
    }));
    const body = root.querySelector('#tab-body');
    editor = null;
    await TAB_RENDERERS[tab](body);
  };

  const confirmLeaveTab = async () => {
    if (!editor?.isDirty()) return true;
    const ok = await confirmDialog({ title: 'Bỏ thay đổi chưa lưu?', body: '<p>Các thay đổi trong tab này chưa được lưu sẽ bị mất.</p>',
      confirmLabel: 'Bỏ thay đổi', cancelLabel: 'Ở lại', danger: true });
    if (ok) editor = null;
    return ok;
  };

  const saveBar = (label = 'Lưu thay đổi') => `<div style="display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-top:16px;flex-wrap:wrap">
    <span class="note" data-dirty-note></span><button type="button" class="btn" data-reset>Hoàn tác</button>
    <button type="button" class="btn primary" data-save>${label}</button></div>`;

  const TAB_RENDERERS = {
    async info(body) {
      body.innerHTML = '<div data-form></div>' + saveBar();
      const ph = data.phase;
      const phaseHtml = `<div class="field"><span>Giai đoạn</span><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span class="badge neutral lg">${esc(ph.label)}</span><span class="note">từ ${formatDate(ph.since)}</span>
        <button type="button" class="btn sm" data-phase>Đổi giai đoạn</button></div></div>`;
      const form = createInfoForm(body.querySelector('[data-form]'), { info: data.project, onChange: sync, phaseHtml });
      body.querySelector('[data-phase]').addEventListener('click', async () => {
        if (!(await confirmLeaveTab())) return;
        openPhaseDialog(projectId, async () => { data = await get(`/api/projects/${projectId}/edit`); draw(); });
      });
      editor = form;
      function sync() {
        body.querySelector('[data-save]').disabled = !form.isDirty();
        body.querySelector('[data-dirty-note]').textContent = form.isDirty() ? 'Có thay đổi chưa lưu' : '';
      }
      sync();
      body.querySelector('[data-reset]').addEventListener('click', () => { editor = null; draw(); });
      body.querySelector('[data-save]').addEventListener('click', async () => {
        const errs = form.errors();
        if (errs.length) return toast(errs[0], 'error');
        try {
          await put(`/api/projects/${projectId}/info`, form.getValue());
          editor = null;
          toast('Đã lưu thông tin dự án.');
          data = await get(`/api/projects/${projectId}/edit`);
          await ctx.refreshMeta();
          draw();
        } catch (err) { toast(err.message, 'error'); }
      });
    },

    async connections(body) {
      body.innerHTML = `${data.suggestedConnections ? `<div class="alert info" style="margin-bottom:14px">Kết nối gợi ý cho dự án này: ${esc(data.suggestedConnections)}</div>` : ''}
        <div data-conns></div>${data.project.platforms.some((x) => x === 'ios' || x === 'android') ? '<div data-promo style="margin-top:16px"></div>' : ''}<div data-csv style="margin-top:16px"></div>`;
      editor = createConnectionForms(body.querySelector('[data-conns]'), { mode: 'live', projectId, connections: data.connections,
        archived: data.status.status === 'archived', sources: connectionsFor(data.project.platforms) });
      if (body.querySelector('[data-promo]')) createPromoSourcesEditor(body.querySelector('[data-promo]'), projectId);
      createCsvUpload(body.querySelector('[data-csv]'), projectId);
    },

    async staffing(body) {
      let date = ctx.query.date && ctx.query.date >= data.firstOpenDate ? ctx.query.date : data.firstOpenDate;
      let sctx = await get(`/api/projects/${projectId}/staffing?date=${date}`);
      body.innerHTML = `
        <div class="config-layout">
          <div class="stack">
            <div class="form-grid effective-head">
              <label class="field"><span>Hiệu lực từ tháng</span><select class="input" data-month>${monthOptions(data.firstOpenDate, date)}</select></label>
              <span class="note">Các tháng trước ${formatDate(data.firstOpenDate)} đã chốt sổ. Mỗi lần lưu tạo một phiên bản mới; các kỳ trước ngày hiệu lực giữ nguyên số liệu.</span>
            </div>
            ${['active', 'draft'].includes(sctx.status) || !sctx.status ? '' : `<div class="alert warn">Dự án đang ${esc(data.status.label.toLowerCase())}: effort tính bằng 0 cho đến khi chạy lại. Phân công dưới đây sẽ áp dụng khi tiếp tục.</div>`}
            <h3 style="margin:0">Nhân sự</h3>
            <div data-editor></div>
            <label class="field"><span>Ghi chú thay đổi <span class="muted">(không bắt buộc)</span></span><input class="input" data-reason maxlength="200"></label>
            <div><h3 style="margin-bottom:8px">Các phiên bản trước</h3><div class="versions" data-versions></div></div>
          </div>
          <aside class="card sticky" style="background:var(--surface-2)">
            <h3 style="margin-bottom:8px">Xem trước tác động</h3>
            <div data-preview></div><div data-errors style="margin-top:10px"></div>
            ${saveBar('Lưu phiên bản')}
          </aside>
        </div>`;
      const $ = (s) => body.querySelector(s);
      let errors = [];
      const body2 = () => ({ effectiveDate: date, ...ed.getValue() });
      const preview = debounce(async () => {
        try {
          const r = await post(`/api/projects/${projectId}/staffing/preview`, body2());
          $('[data-preview]').innerHTML = impactPreviewHtml(r.preview, { focusId: projectId });
          errors = r.errors;
        } catch (err) { errors = [err.message]; }
        $('[data-errors]').innerHTML = errors.length ? `<div class="alert error"><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
        syncButtons();
      }, 250);
      const syncButtons = () => {
        const dirty = ed.isDirty();
        $('[data-save]').disabled = !dirty || errors.length > 0 || ed.hasLocalErrors();
        $('[data-reset]').disabled = !dirty;
        $('[data-dirty-note]').textContent = dirty ? 'Có thay đổi chưa lưu' : '';
      };
      const ed = createStaffingEditor($('[data-editor]'), { context: sctx, rows: sctx.rows,
        onChange: () => { syncButtons(); preview(); } });
      editor = ed;
      const drawVersions = () => {
        $('[data-versions]').innerHTML = sctx.versions.map((v) => `<div class="version">
          <b>Hiệu lực từ ${v.effectiveDate <= '2000-01-01' ? 'ban đầu' : formatDate(v.effectiveDate)}</b> · FTE ${formatNumber(v.fte, 1)}${data.firstOpenDate > v.effectiveDate ? ' <span class="pill-closed">đã chốt sổ</span>' : ''}
          <div>${v.rows.map((r) => `${esc(r.name)} ${formatNumber(r.effortPct)}%`).join(' · ') || 'Không có nhân sự'}</div>
          <div class="note">${esc(v.createdBy)} · ${formatDateTime(v.createdAt)}</div></div>`).join('') || '<div class="note">Chưa có phiên bản nào.</div>';
      };
      drawVersions();
      preview();
      $('[data-month]').addEventListener('change', async (e) => {
        if (ed.isDirty() && !(await confirmDialog({ title: 'Đổi tháng hiệu lực?', body: '<p>Thay đổi chưa lưu sẽ được giữ và áp dụng cho tháng mới chọn.</p>', confirmLabel: 'Đổi tháng' }))) {
          e.target.value = date;
          return;
        }
        const keep = ed.isDirty() ? ed.getValue() : null;
        date = e.target.value;
        sctx = await get(`/api/projects/${projectId}/staffing?date=${date}`);
        ed.reset(sctx, sctx.rows);
        if (keep) ed.setRows(keep.rows);
        drawVersions();
        syncButtons();
        preview();
      });
      $('[data-reset]').addEventListener('click', () => {
        ed.reset(sctx, sctx.rows);
        syncButtons(); preview();
      });
      $('[data-save]').addEventListener('click', async () => {
        try {
          sctx = await put(`/api/projects/${projectId}/staffing`, { ...body2(), reason: $('[data-reason]').value });
          toast(`Đã lưu phiên bản nhân sự, hiệu lực từ ${formatDate(date)}.`);
          $('[data-reason]').value = '';
          ed.reset(sctx, sctx.rows);
          drawVersions();
          syncButtons();
          preview();
        } catch (err) { toast(err.message, 'error'); }
      });
    },

    async baselines(body) {
      body.innerHTML = `
        <div class="form-grid effective-head" style="margin-bottom:14px">
          <label class="field"><span>Hiệu lực từ tháng</span><select class="input" data-month>${monthOptions(data.firstOpenDate, data.baselineEffective && data.baselineEffective > data.firstOpenDate ? data.baselineEffective : data.firstOpenDate)}</select></label>
          <span class="note">Mục tiêu, trọng số và ngưỡng màu lưu theo tháng hiệu lực: các tháng trước giữ mục tiêu đã áp dụng cho tháng đó (% đạt và màu không đổi).
            ${data.baselineEffective ? `Đang hiển thị phiên bản hiệu lực từ ${formatDate(data.baselineEffective)}.` : ''}</span>
        </div>
        <div data-editor></div>
        <label class="field" style="margin-top:14px"><span>Ghi chú thay đổi <span class="muted">(không bắt buộc)</span></span><input class="input" data-reason maxlength="200"></label>
        ${saveBar('Lưu phiên bản')}
        <div style="margin-top:16px"><h3 style="margin-bottom:8px">Các phiên bản mục tiêu</h3><div class="versions">${data.baselineVersions.map((v) => `<div class="version">
          <b>Hiệu lực từ ${v.effectiveDate ? formatDate(v.effectiveDate) : 'ban đầu'}</b>${v.effectiveDate && v.effectiveDate < data.firstOpenDate ? ' <span class="pill-closed">đã chốt sổ</span>' : ''}
          <div>${v.list.map((b) => `${esc(ctx.state.meta.catalog.find((m) => m.key === b.metricKey)?.short ?? b.metricKey)} ${formatNumber(b.targetMonthly)} (${formatNumber(b.weight)}%)`).join(' · ')} · Tốt &gt; ${formatNumber(v.thresholds.green)}% · Báo động &lt; ${formatNumber(v.thresholds.red)}%</div>
          ${v.createdBy ? `<div class="note">${esc(v.createdBy)} · ${formatDateTime(v.createdAt)}</div>` : ''}</div>`).join('')}</div></div>`;
      const ed = createBaselineEditor(body.querySelector('[data-editor]'), { baselines: data.baselines, thresholds: data.thresholds, onChange: sync,
        productType: data.project.platforms, firstOpenDate: data.firstOpenDate,
        loadReferences: async (metrics) => (await post('/api/baseline-references', { projectId: Number(projectId), metrics })).references });
      editor = ed;
      function sync() {
        body.querySelector('[data-save]').disabled = !ed.isDirty() || ed.errors().length > 0;
        body.querySelector('[data-dirty-note]').textContent = ed.isDirty() ? 'Có thay đổi chưa lưu' : '';
      }
      sync();
      body.querySelector('[data-reset]').addEventListener('click', () => { editor = null; draw(); });
      body.querySelector('[data-save]').addEventListener('click', async () => {
        try {
          const v = ed.getValue();
          const month = body.querySelector('[data-month]').value;
          await put(`/api/projects/${projectId}/baselines`, { baselines: v.list, thresholds: v.thresholds, sourceDate: v.sourceDate,
            effectiveMonth: month, reason: body.querySelector('[data-reason]').value });
          data = await get(`/api/projects/${projectId}/edit`);
          editor = null;
          toast(`Đã lưu baseline & trọng số, hiệu lực từ ${formatDate(month)}.`);
          draw();
        } catch (err) { toast(err.message, 'error'); }
      });
    },

    async stoploss(body) {
      const s = await get(`/api/projects/${projectId}/stoploss`);
      body.innerHTML = `<div class="config-layout">
          <div><div data-editor></div><label class="field" style="margin-top:14px"><span>Ghi chú thay đổi <span class="muted">(không bắt buộc)</span></span>
            <input class="input" data-reason maxlength="200"></label>${saveBar()}</div>
          <aside class="card sticky" style="background:var(--surface-2)" data-status></aside>
        </div>`;
      const drawStatus = (st) => {
        body.querySelector('[data-status]').innerHTML = `<h3 style="margin-bottom:8px">Trạng thái hiện tại</h3>
          <div style="margin-bottom:8px">${stopLossBadge(st.display.status, st.display.label)}</div>
          ${st.enabled ? `<div class="note">Theo dõi từ ${st.start ? formatDate(st.start) : '—'} · đánh giá đến tháng đã chốt ${st.evaluatedThrough ? `${st.evaluatedThrough.slice(5)}/${st.evaluatedThrough.slice(0, 4)}` : '— (chưa có tháng đủ dữ liệu)'}</div>
          <div class="fin-list" style="margin-top:8px">
            <div class="fin-row"><span class="label">Lỗ lũy kế</span><span class="value">${formatNumber(st.cumLoss)} / ${formatNumber(st.threshold)} ₫</span></div>
            <div class="fin-row"><span class="label">Thời gian còn lại</span><span class="value small">${esc(st.remaining?.text ?? '—')}</span></div>
          </div>
          ${st.conditions.map((c) => `<div class="cond-status"><span>${c.met ? '■' : c.warning ? '▲' : '○'} ${esc(c.label)}${c.enabled ? '' : ' (tắt)'}</span><span class="small">${esc(c.detail)}</span></div>`).join('')}
          ${st.proposal?.status === 'pending' ? `<button class="btn primary" data-open-proposal="${st.proposal.id}" style="margin-top:10px">Mở đề xuất cắt lỗ #${st.proposal.id}</button>` : ''}` : '<div class="note">Phương án cắt lỗ đang tắt cho dự án này.</div>'}
          <p class="note" style="margin-top:10px">Chỉ dùng các tháng đã chốt sổ (tháng N chốt ngày 3 tháng N+1). Đánh giá theo cấu hình đã lưu.</p>`;
        body.querySelector('[data-open-proposal]')?.addEventListener('click', (e) => openProposalDialog(Number(e.currentTarget.dataset.openProposal), {
          isAdmin: true, onDone: async () => drawStatus(await get(`/api/projects/${projectId}/stoploss`)) }));
      };
      const ed = createStopLossEditor(body.querySelector('[data-editor]'), { policy: s.policy, monthlyCost: s.monthlyCost,
        defaultStartText: s.start && !s.policy.startDate ? formatDate(s.start) : '', onChange: () => sync() });
      editor = ed;
      function sync() {
        body.querySelector('[data-save]').disabled = !ed.isDirty() || ed.errors().length > 0;
        body.querySelector('[data-dirty-note]').textContent = ed.errors()[0] ?? (ed.isDirty() ? 'Có thay đổi chưa lưu' : '');
      }
      sync();
      drawStatus(s);
      body.querySelector('[data-reset]').addEventListener('click', () => { editor = null; draw(); });
      body.querySelector('[data-save]').addEventListener('click', async () => {
        try {
          await put(`/api/projects/${projectId}/stoploss`, { ...ed.getValue(), reason: body.querySelector('[data-reason]').value });
          editor = null;
          toast('Đã lưu phương án cắt lỗ.');
          draw();
        } catch (err) { toast(err.message, 'error'); }
      });
    },

    async history(body) {
      const { history } = await get(`/api/projects/${projectId}/history`);
      body.innerHTML = `<div class="card-head"><div><h2>Lịch sử thay đổi</h2><div class="sub">${history.length} thay đổi · mới nhất trước</div></div></div>
        <div class="table-wrap"><table class="history-table">
          <thead><tr><th>Thời điểm</th><th>Người sửa</th><th>Hạng mục</th><th>Nội dung</th><th>Giá trị cũ → mới</th><th>Hiệu lực từ</th><th>Lý do</th></tr></thead>
          <tbody>${history.map((h) => `<tr>
            <td>${formatDateTime(h.at)}</td><td>${esc(h.actor)}</td><td>${esc(h.action)}</td><td class="wrap">${esc(h.field ?? '')}</td>
            <td class="wrap">${h.oldValue != null || h.newValue != null ? `${esc(h.oldValue ?? '—')} <span class="arrow-sep">→</span> <b>${esc(h.newValue ?? '—')}</b>` : ''}</td>
            <td>${h.effectiveDate ? formatDate(h.effectiveDate) : '<span class="muted">Ngay</span>'}</td>
            <td class="wrap">${esc(h.reason ?? '')}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Chưa có thay đổi nào.</td></tr>'}</tbody>
        </table></div>`;
    },
  };

  await draw();
}
