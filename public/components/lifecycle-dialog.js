// In-page lifecycle dialog: effective date, optional reason, live cost-impact preview.
// Actions: activate, pause, resume (re-assign effort), archive, restore, delete (draft / permanent).

import { get, post } from '../api.js';
import { debounce, esc, toast } from '../ui.js';
import { formatDate } from '/shared/format.js';
import { impactPreviewHtml } from './impact-preview.js';
import { createStaffingEditor } from './staffing-editor.js';

const EFFECTS = {
  activate: 'Dự án bắt đầu nhận effort của nhân sự và Tools/AI từ ngày hiệu lực.',
  pause: 'Dừng phát triển: từ ngày hiệu lực effort của nhân sự về 0 (được giải phóng), dự án không nhận Tools/AI. Dữ liệu vẫn đồng bộ, dự án vẫn hiện trên Dashboard với nhãn "Tạm dừng" (doanh thu vẫn tính, chi phí = 0) và không được xếp hạng.',
  resume: 'Dự án chạy lại từ ngày hiệu lực. Giao lại effort cho từng người — hệ thống kiểm tra phần còn trống của mỗi người.',
  archive: 'Ẩn khỏi Dashboard, ngừng đồng bộ, giải phóng effort. Toàn bộ lịch sử được giữ và vẫn xem được ở tab "Lưu trữ".',
  restore: 'Khôi phục dự án về trạng thái "Tạm dừng" từ ngày hiệu lực.',
};

/**
 * @param {{project:{id:number,name:string}, action:string, label:string, status:string,
 *          latestDate?:string, firstOpenDate:string, today:string, onDone:Function}} o
 */
export function openLifecycleDialog(o) {
  const { project, action } = o;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const isDelete = action === 'delete';
  const permanent = isDelete && o.status === 'archived';
  const minDate = o.latestDate && o.latestDate > o.firstOpenDate ? o.latestDate : o.firstOpenDate;
  const defaultDate = o.today > minDate ? o.today : minDate;
  const title = permanent ? `Xóa vĩnh viễn dự án "${project.name}"` : `${o.label.startsWith('Kích hoạt') ? o.label : `${o.label} dự án`} "${project.name}"`;

  backdrop.innerHTML = `<div class="modal wide" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <h2>${esc(title)}</h2>
    ${isDelete ? (permanent
      ? `<div class="alert error"><div>Xóa dữ liệu chỉ số, kết nối và baseline của dự án. Phần chi phí đã phân bổ ở các kỳ trước được giữ lại dưới tên
          <b>"Dự án đã xóa"</b>, để chi phí và lời/lỗ của các dự án khác ở kỳ cũ không thay đổi. Không thể hoàn tác.</div></div>
         <label class="field"><span>Gõ đúng tên dự án để xác nhận: <b>${esc(project.name)}</b></span>
           <input class="input" data-confirm-name autocomplete="off" spellcheck="false"></label>`
      : '<div class="alert warn">Dự án nháp chưa phát sinh chi phí nên sẽ bị xóa ngay. Không thể hoàn tác.</div>')
    : `<p class="note" style="margin:0;font-size:13px">${EFFECTS[action]}</p>
       <label class="field" style="max-width:220px"><span>Ngày hiệu lực</span>
         <input class="input" type="date" data-date min="${minDate}" value="${defaultDate}">
         <span class="hint">Không chọn được tháng đã chốt sổ (trước ${formatDate(o.firstOpenDate)}).</span></label>`}
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
  $('[data-confirm-name]')?.addEventListener('input', (e) => { $('[data-ok]').disabled = e.target.value.trim() !== project.name; });
  backdrop.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop || e.target.closest('[data-cancel]')) close(); });
  $('[data-ok]').addEventListener('click', async () => {
    if (errors.length) return;
    try {
      await post(`/api/projects/${project.id}/lifecycle`, body());
      close();
      toast(isDelete ? `Đã xóa ${project.name}.` : `${o.label}: ${project.name} (hiệu lực ${formatDate(body().effectiveDate)}).`);
      o.onDone?.(action);
    } catch (err) { setErrors([err.message]); }
  });

  (async () => {
    try { await loadStaffing(); } catch (err) { setErrors([err.message]); }
    refreshPreview();
    ($('[data-confirm-name]') ?? $('[data-date]') ?? $('[data-ok]'))?.focus();
  })();
}
