// In-page lifecycle dialog: effective date, optional reason, live cost-impact preview.
// Actions: activate, pause, resume (re-assign effort), archive, restore, delete (draft / permanent).
// A Dự án asks "Áp dụng cho tất cả N sản phẩm?" for pause / resume / archive / restore.

import { get, post } from '../api.js';
import { debounce, esc, toast } from '../ui.js';
import { formatDate } from '/shared/format.js';
import { impactPreviewHtml } from './impact-preview.js';
import { createStaffingEditor } from './staffing-editor.js';

const EFFECTS = (n) => ({
  activate: `${cap(n)} bắt đầu nhận effort của nhân sự và Tools/AI từ ngày hiệu lực.`,
  pause: `Dừng phát triển: từ ngày hiệu lực effort của nhân sự về 0 (được giải phóng), ${n} không nhận Tools/AI. Dữ liệu vẫn đồng bộ, ${n} vẫn hiện trên Dashboard với nhãn "Tạm dừng" (doanh thu vẫn tính, chi phí = 0) và không được xếp hạng.`,
  resume: `${cap(n)} chạy lại từ ngày hiệu lực. Giao lại effort cho từng người — hệ thống kiểm tra phần còn trống của mỗi người.`,
  archive: 'Ẩn khỏi Dashboard, ngừng đồng bộ, giải phóng effort. Toàn bộ lịch sử được giữ và vẫn xem được ở tab "Lưu trữ".',
  restore: `Khôi phục ${n} về trạng thái "Tạm dừng" từ ngày hiệu lực.`,
});
const cap = (s) => s[0].toUpperCase() + s.slice(1);

/**
 * @param {{project:{id:number,name:string}, action:string, label:string, status:string, childCount?:number,
 *          latestDate?:string, firstOpenDate:string, today:string, onDone:Function}} o
 */
export function openLifecycleDialog(o) {
  const { project, action } = o;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const isDelete = action === 'delete';
  // "dự án" (upper level) or "sản phẩm"; a Dự án without products may be deleted from any status (with name check).
  const n = project.isFolder || project.kind === 'folder' ? 'dự án' : 'sản phẩm';
  const permanent = isDelete && (o.status === 'archived' || (n === 'dự án' && o.status !== 'draft'));
  const minDate = o.latestDate && o.latestDate > o.firstOpenDate ? o.latestDate : o.firstOpenDate;
  const defaultDate = o.today > minDate ? o.today : minDate;
  const title = permanent ? `Xóa vĩnh viễn ${n} "${project.name}"` : `${o.label.startsWith('Kích hoạt') ? o.label : `${o.label} ${n}`} "${project.name}"`;

  backdrop.innerHTML = `<div class="modal wide" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <h2>${esc(title)}</h2>
    ${isDelete ? (permanent
      ? `<div class="alert error"><div>${n === 'dự án' ? 'Xóa dự án (không còn sản phẩm đang dùng). Lịch sử nhân sự chung ở các kỳ trước được giữ.'
          : `Xóa dữ liệu chỉ số, kết nối và baseline của sản phẩm. Phần chi phí đã phân bổ ở các kỳ trước được giữ lại dưới tên
          <b>"Sản phẩm đã xóa"</b>, để chi phí và lời/lỗ của các sản phẩm khác ở kỳ cũ không thay đổi.`} Không thể hoàn tác.</div></div>
         <label class="field"><span>Gõ đúng tên ${n} để xác nhận: <b>${esc(project.name)}</b></span>
           <input class="input" data-confirm-name autocomplete="off" spellcheck="false"></label>`
      : `<div class="alert warn">${cap(n)} nháp chưa phát sinh chi phí nên sẽ bị xóa ngay. Không thể hoàn tác.</div>`)
    : `<p class="note" style="margin:0;font-size:13px">${EFFECTS(n)[action]}</p>
       <label class="field" style="max-width:220px"><span>Ngày hiệu lực</span>
         <input class="input" type="date" data-date min="${minDate}" value="${defaultDate}">
         <span class="hint">Không chọn được tháng đã chốt sổ (trước ${formatDate(o.firstOpenDate)}).</span></label>`}
    ${o.childCount && ['pause', 'resume', 'archive', 'restore'].includes(action) ? `<div class="field"><span data-question>Áp dụng cho tất cả sản phẩm?</span><div class="radio-row">
      <label class="radio-card"><input type="radio" name="apply" value="yes" checked><span><b>Có</b> — áp dụng cho các sản phẩm phù hợp</span></label>
      <label class="radio-card"><input type="radio" name="apply" value="no"><span><b>Không</b> — chỉ đổi trạng thái dự án${action === 'pause' || action === 'archive' ? ' (nhân sự chung của dự án được giải phóng)' : ''}</span></label></div></div>` : ''}
    ${action === 'resume' || action === 'activate' ? '<div data-staffing></div>' : ''}
    <label class="field"><span>Lý do <span class="muted">(không bắt buộc)</span></span><textarea class="input" data-reason maxlength="300"></textarea></label>
    ${isDelete ? '' : '<div><h3 style="margin-bottom:8px">Xem trước tác động chi phí</h3><div data-preview class="note">Đang tính…</div></div>'}
    <div data-errors></div>
    <div class="modal-actions"><button type="button" class="btn" data-cancel>Hủy</button>
      <button type="button" class="btn ${isDelete || action === 'archive' ? 'danger-solid' : 'primary'}" data-ok ${permanent ? 'disabled' : ''}>${esc(permanent ? 'Xóa vĩnh viễn' : o.label)}</button></div>
  </div>`;
  document.body.append(backdrop);

  const $ = (sel) => backdrop.querySelector(sel);
  const close = () => backdrop.remove();
  let editor = null;
  let errors = [];

  const body = () => ({
    action,
    effectiveDate: $('[data-date]')?.value,
    reason: $('[data-reason]').value,
    confirmName: $('[data-confirm-name]')?.value,
    applyToChildren: backdrop.querySelector('input[name="apply"]:checked')?.value === 'yes',
    ...(editor ? editor.getValue() : {}),
  });

  const setErrors = (list) => {
    errors = list;
    $('[data-errors]').innerHTML = list.length ? `<div class="alert error"><ul>${list.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
    if (!permanent) $('[data-ok]').disabled = list.length > 0;
  };

  const refreshPreview = debounce(async () => {
    if (isDelete) return;
    try {
      const r = await post(`/api/projects/${project.id}/lifecycle/preview`, body());
      $('[data-preview]').innerHTML = impactPreviewHtml(r.preview, { focusId: project.id, revenueMonthly: r.revenueMonthly });
      if ($('[data-question]')) {
        $('[data-question]').textContent = `Áp dụng cho tất cả ${r.eligible.length} sản phẩm${r.eligible.length ? ` (${r.eligible.map((p) => p.name).join(', ')})` : ''}?`;
      }
      setErrors(r.errors);
    } catch (err) {
      $('[data-preview]').innerHTML = '';
      setErrors([err.message]);
    }
  }, 250);

  const loadStaffing = async () => {
    const host = $('[data-staffing]');
    if (!host) return;
    const ctx = await get(`/api/projects/${project.id}/staffing?date=${$('[data-date]').value}`);
    if (!editor) editor = createStaffingEditor(host, { context: ctx, rows: ctx.rows, compact: true, onChange: refreshPreview });
    else { const keep = editor.getValue(); editor.reset(ctx, ctx.rows); editor.setRows(keep.rows); }
  };

  $('[data-date]')?.addEventListener('change', async () => { await loadStaffing(); refreshPreview(); });
  backdrop.querySelectorAll('input[name="apply"]').forEach((r) => r.addEventListener('change', refreshPreview));
  $('[data-confirm-name]')?.addEventListener('input', (e) => { $('[data-ok]').disabled = e.target.value.trim() !== project.name; });
  backdrop.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop || e.target.closest('[data-cancel]')) close(); });
  $('[data-ok]').addEventListener('click', async () => {
    if (errors.length) return;
    try {
      const r = await post(`/api/projects/${project.id}/lifecycle`, body());
      close();
      toast(isDelete ? `Đã xóa ${project.name}.` : `${o.label}: ${project.name} (hiệu lực ${formatDate(body().effectiveDate)})${r.applied ? ` · áp dụng cho ${r.applied} sản phẩm` : ''}.`);
      o.onDone?.(action);
    } catch (err) { setErrors([err.message]); }
  });

  (async () => {
    try { await loadStaffing(); } catch (err) { setErrors([err.message]); }
    refreshPreview();
    ($('[data-confirm-name]') ?? $('[data-date]') ?? $('[data-ok]'))?.focus();
  })();
}
