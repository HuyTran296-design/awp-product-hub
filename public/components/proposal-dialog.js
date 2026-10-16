// "Đề xuất cắt lỗ" dialog: satisfied conditions (actual vs threshold), P&L of the last 6 months, proposed action,
// live cost-impact preview, and — for Admins on a pending proposal — the decision: Thực hiện / Gia hạn / Bỏ qua.
// A reason is mandatory. Nothing happens to the project unless "Thực hiện" is confirmed.

import { get, post } from '../api.js';
import { debounce, esc, parseVnd, profitBadge, toast } from '../ui.js';
import { formatDate, formatDateTime, formatNumber, formatVnd } from '/shared/format.js';
import { ACTION_LABELS, actionLabel } from '/shared/stop-loss.js';
import { impactPreviewHtml } from './impact-preview.js';

const STATUS_TEXT = { pending: 'Chờ quyết định', executed: 'Đã thực hiện', extended: 'Đã gia hạn', dismissed: 'Đã bỏ qua' };

export async function openProposalDialog(proposalId, { isAdmin, onDone } = {}) {
  const data = await get(`/api/proposals/${proposalId}`);
  const { proposal: p, project } = data;
  const snap = p.snapshot;
  const canDecide = isAdmin && p.status === 'pending';
  let action = { ...snap.action };
  let mode = 'execute';

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal wide" role="dialog" aria-modal="true" aria-label="Đề xuất cắt lỗ">
    <h2>Đề xuất cắt lỗ #${p.id} · ${esc(project?.name ?? 'Sản phẩm đã xóa')}</h2>
    <div class="note">Tạo ${formatDateTime(p.createdAt)} · đánh giá đến tháng đã chốt ${p.evaluatedThrough.slice(5)}/${p.evaluatedThrough.slice(0, 4)} ·
      <b>${STATUS_TEXT[p.status]}</b></div>
    <div><h3 style="margin-bottom:6px">Điều kiện đã thỏa</h3>
      ${snap.conditions.map((c) => `<div class="cond-status"><span>■ ${esc(c.label)}</span><b>${esc(c.detail)}</b></div>`).join('')}</div>
    <div><h3 style="margin-bottom:6px">Lãi/lỗ 6 tháng gần nhất</h3>
      <div class="table-wrap"><table><thead><tr><th>Tháng</th><th class="r">Doanh thu</th><th class="r">Chi phí</th><th class="r">Lãi/lỗ</th></tr></thead>
      <tbody>${snap.months.map((m) => `<tr><td>${m.month.slice(5)}/${m.month.slice(0, 4)}</td><td class="r">${formatVnd(m.revenue)}</td>
        <td class="r">${formatVnd(m.cost)}</td><td class="r">${profitBadge(m.profit)} ${formatVnd(m.profit)}</td></tr>`).join('')}</tbody></table></div></div>
    <div><b>Phương án đã chọn trước:</b> ${esc(actionLabel(snap.action))}</div>
    ${p.decision ? `<div class="alert info"><div><b>Quyết định:</b> ${esc(describe(p))}<br>
      <span class="note">${esc(p.decision.decidedBy)} · ${formatDateTime(p.decision.decidedAt)} · Lý do: ${esc(p.decision.reason)}</span></div></div>` : ''}
    ${canDecide ? `
      <div class="field"><span>Quyết định</span><div class="radio-row">
        <label class="radio-card"><input type="radio" name="decision" value="execute" checked><span><b>Thực hiện</b><br><span class="small muted">Chạy thao tác tương ứng với ngày hiệu lực</span></span></label>
        <label class="radio-card"><input type="radio" name="decision" value="extend"><span><b>Gia hạn</b><br><span class="small muted">Đánh giá lại vào ngày đã chọn</span></span></label>
        <label class="radio-card"><input type="radio" name="decision" value="dismiss"><span><b>Bỏ qua</b><br><span class="small muted">Đóng đề xuất</span></span></label>
      </div></div>
      <div data-mode="execute" class="stack" style="gap:10px">
        <div class="form-grid" style="align-items:end">
          <label class="field"><span>Phương án</span><select class="input" data-action>${Object.entries(ACTION_LABELS).map(([k, l]) =>
            `<option value="${k}" ${k === action.type ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="field" data-effort-wrap><span>Giảm effort xuống (% hiện tại)</span><input class="input right" type="number" min="1" max="99" data-effort value="${action.effortPct ?? 50}"></label>
          <label class="field"><span>Ngày hiệu lực</span><input class="input" type="date" data-date min="${data.firstOpenDate}" value="${data.defaultEffectiveDate}"></label>
        </div>
        <div><h3 style="margin-bottom:6px">Xem trước tác động chi phí</h3><div data-impact></div></div>
      </div>
      <div data-mode="extend" class="form-grid" hidden>
        <label class="field"><span>Ngày đánh giá lại</span><input class="input" type="date" data-review min="${data.minReviewDate}"></label>
        <label class="field"><span>Ngưỡng lỗ lũy kế mới <span class="muted">(tùy chọn)</span></span>
          <div class="input-suffix" data-suffix="₫"><input class="input right" inputmode="numeric" data-threshold placeholder="${formatNumber(snap.threshold)}"></div></label>
      </div>
      <p data-mode="dismiss" class="note" hidden>Đề xuất mới chỉ được tạo lại khi có thêm điều kiện thỏa hoặc sang kỳ chốt tháng sau.</p>
      <label class="field"><span>Lý do <b>(bắt buộc)</b></span><textarea class="input" data-reason maxlength="300"></textarea></label>
      <div data-errors></div>` : ''}
    <div class="modal-actions"><button type="button" class="btn" data-close>${canDecide ? 'Hủy' : 'Đóng'}</button>
      ${canDecide ? '<button type="button" class="btn primary" data-ok disabled>Xác nhận quyết định</button>' : ''}</div>
  </div>`;
  document.body.append(backdrop);
  const $ = (s) => backdrop.querySelector(s);
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop || e.target.closest('[data-close]')) close(); });
  backdrop.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  if (!canDecide) return;

  const setErrors = (list) => { $('[data-errors]').innerHTML = list.length ? `<div class="alert error"><ul>${list.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''; };
  const validate = () => {
    const reason = $('[data-reason]').value.trim();
    let ok = reason.length > 0;
    if (mode === 'extend') ok &&= Boolean($('[data-review]').value);
    $('[data-ok]').disabled = !ok;
  };
  const refreshImpact = debounce(async () => {
    $('[data-effort-wrap]').hidden = action.type !== 'reduce_effort';
    if (action.type === 'review') { $('[data-impact]').innerHTML = '<div class="note">Đánh giá lại: không kèm thao tác, không đổi chi phí.</div>'; return; }
    try {
      const { impact } = await post(`/api/proposals/${p.id}/impact`, { action, effectiveDate: $('[data-date]').value });
      $('[data-impact]').innerHTML = impact?.preview ? impactPreviewHtml(impact.preview, { focusId: p.projectId }) : '';
      setErrors(impact?.errors ?? []);
    } catch (err) { setErrors([err.message]); }
  }, 250);

  backdrop.querySelectorAll('input[name="decision"]').forEach((r) => r.addEventListener('change', () => {
    mode = r.value;
    backdrop.querySelectorAll('[data-mode]').forEach((el) => { el.hidden = el.dataset.mode !== mode; });
    setErrors([]);
    validate();
    if (mode === 'execute') refreshImpact();
  }));
  $('[data-action]').addEventListener('change', (e) => { action.type = e.target.value; refreshImpact(); });
  $('[data-effort]').addEventListener('input', (e) => { action.effortPct = Number(e.target.value); refreshImpact(); });
  $('[data-date]').addEventListener('change', refreshImpact);
  backdrop.querySelectorAll('[data-reason], [data-review]').forEach((i) => i.addEventListener('input', validate));
  $('[data-ok]').addEventListener('click', async () => {
    const body = { decision: mode, reason: $('[data-reason]').value };
    if (mode === 'execute') Object.assign(body, { action, effectiveDate: $('[data-date]').value });
    if (mode === 'extend') Object.assign(body, { reviewDate: $('[data-review]').value, newThreshold: parseVnd($('[data-threshold]').value) || null });
    try {
      const { proposal } = await post(`/api/proposals/${p.id}/decision`, body);
      close();
      toast(`Đã ghi quyết định: ${describe(proposal)}.`);
      onDone?.(proposal);
    } catch (err) { setErrors([err.message]); }
  });
  refreshImpact();
}

function describe(p) {
  const d = p.decision;
  if (!d) return '';
  if (d.type === 'extend') return `Gia hạn tới ${formatDate(d.reviewDate)}${d.newThreshold ? ` · ngưỡng mới ${formatVnd(d.newThreshold)}` : ''}`;
  if (d.type === 'dismiss') return 'Bỏ qua';
  return d.action.type === 'review' ? 'Thực hiện: Đánh giá lại' : `Thực hiện: ${actionLabel(d.action)} từ ${formatDate(d.effectiveDate)}`;
}
