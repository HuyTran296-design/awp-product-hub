// "Đổi giai đoạn": effective date, optional reason, and the suggested baselines for the new phase
// (Admin chooses to apply them or keep the current ones). Recorded in the change history.

import { get, post } from '../api.js';
import { esc, openModal, toast } from '../ui.js';
import { formatDate } from '/shared/format.js';

export async function openPhaseDialog(projectId, onDone) {
  const data = await get(`/api/projects/${projectId}/phase`);
  const options = Object.entries(data.phases).filter(([k]) => k !== data.current.phase);
  const today = new Date().toISOString().slice(0, 10);
  const suggestion = (ph) => `<ul style="margin:6px 0 0;padding-left:18px">${data.suggestions[ph].map((b) =>
    `<li>${esc(b.name)} · trọng số ${b.weight}%${b.source === 'manual' ? ' · nhập thủ công' : ''}</li>`).join('')}</ul>`;
  const m = openModal('Đổi giai đoạn sản phẩm', `
    <p class="note" style="margin:0">Hiện tại: <b>${esc(data.current.label)}</b> từ ${formatDate(data.current.since)}.</p>
    <label class="field"><span>Giai đoạn mới</span><select class="input" name="phase">${options.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>
    <label class="field"><span>Ngày hiệu lực</span><input class="input" type="date" name="effectiveDate" min="${data.firstOpenDate}" value="${today > data.firstOpenDate ? today : data.firstOpenDate}" required></label>
    <div class="field"><span>Bộ baseline gợi ý cho giai đoạn này</span><div data-suggest class="note"></div>
      <div class="radio-row" style="margin-top:8px">
        <label class="radio-card"><input type="radio" name="apply" value="yes"><span><b>Áp dụng bộ gợi ý</b><br><span class="small muted">Thay baseline hiện tại</span></span></label>
        <label class="radio-card"><input type="radio" name="apply" value="no" checked><span><b>Giữ nguyên baseline</b></span></label></div></div>
    <label class="field"><span>Lý do <span class="muted">(không bắt buộc)</span></span><textarea class="input" name="reason" maxlength="300"></textarea></label>`, {
    submitLabel: 'Đổi giai đoạn',
    onSubmit: async (fd) => {
      await post(`/api/projects/${projectId}/phase`, { phase: fd.get('phase'), effectiveDate: fd.get('effectiveDate'),
        applyBaselines: fd.get('apply') === 'yes', reason: fd.get('reason') });
      toast('Đã đổi giai đoạn sản phẩm.');
      onDone?.();
    },
  });
  const sync = () => { m.el.querySelector('[data-suggest]').innerHTML = suggestion(m.el.querySelector('[name="phase"]').value); };
  m.el.querySelector('[name="phase"]').addEventListener('change', sync);
  sync();
}
