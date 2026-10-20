// "Cập nhật số liệu": quick entry of every manual baseline for the current period
// (and the previous period while it is missing). Every save keeps who/when; edits stay in the history.

import { get, post } from '../api.js';
import { esc, formatMetric, openModal, parseDecimal, parseVnd, toast } from '../ui.js';
import { formatDate, formatDateTime, formatNumber } from '/shared/format.js';

const UNIT = { vnd: '₫', count: '', pct: '%', minutes: 'phút', seconds: 'giây', rating: '★' };

export async function openManualEntry(projectId, onDone) {
  const { items } = await get(`/api/projects/${projectId}/manual`);
  if (!items.length) return toast('Sản phẩm chưa có baseline nhập thủ công.');
  const field = (it, p, i) => {
    const show = i === 1 || !p.value; // current period always; previous only while missing
    if (!show) return '';
    return `<label class="field"><span>${esc(p.label)} ${p.overdue ? '<b class="over">· quá hạn</b>' : `<span class="muted">· hạn ${formatDate(p.deadline)}</span>`}</span>
      <div class="input-suffix" data-suffix="${UNIT[it.unit] ?? ''}"><input class="input right" inputmode="decimal" style="padding-right:${(UNIT[it.unit] ?? '').length > 2 ? 52 : 30}px"
        data-entry="${esc(it.metricKey)}" data-platform="${esc(it.platform ?? 'all')}" data-type="${it.periodType}" data-start="${p.start}" data-unit="${it.unit}"
        value="${p.value ? esc(['vnd', 'count'].includes(it.unit) ? formatNumber(p.value.value) : String(p.value.value).replace('.', ',')) : ''}" placeholder="Chưa nhập"></div>
      ${p.value ? `<span class="hint">Đã nhập: ${esc(formatMetric(p.value.value, it.unit))} · ${esc(p.value.enteredBy)} · ${formatDateTime(p.value.enteredAt)}</span>` : ''}</label>`;
  };
  const body = `<p class="note" style="margin:0">Giá trị theo kỳ của từng baseline. Kỳ quá hạn (hết kỳ + 3 ngày) mà chưa nhập sẽ hiện "Chưa cập nhật" và không tính vào điểm.</p>
    ${items.map((it) => `<fieldset class="card" style="padding:12px;margin:0">
      <legend style="font-weight:600;padding:0 4px">${esc(it.name)} <span class="muted small">· nhập theo ${esc(it.periodLabel.toLowerCase())}</span></legend>
      <div class="form-grid">${it.periods.map((p, i) => field(it, p, i)).join('')}</div>
      ${it.history.length ? `<details style="margin-top:6px"><summary class="small">Lịch sử (${it.history.length})</summary><div class="note">${it.history.map((h) =>
        `${esc(formatDate(h.periodStart))} · ${esc(formatMetric(h.value, it.unit))} · ${esc(h.enteredBy)} · ${formatDateTime(h.enteredAt)}${h.replacedAt ? ' (đã thay)' : ''}`).join('<br>')}</div></details>` : ''}
    </fieldset>`).join('')}`;
  const m = openModal('Cập nhật số liệu', body, {
    submitLabel: 'Lưu số liệu',
    onSubmit: async (_fd, backdrop) => {
      const entries = [...backdrop.querySelectorAll('[data-entry]')].filter((i) => i.value.trim()).map((i) => ({
        metricKey: i.dataset.entry, platform: i.dataset.platform, periodType: i.dataset.type, periodStart: i.dataset.start,
        value: ['vnd', 'count'].includes(i.dataset.unit) ? parseVnd(i.value) : parseDecimal(i.value),
      }));
      const r = await post(`/api/projects/${projectId}/manual`, { entries });
      toast(`Đã lưu ${r.saved} giá trị.`);
      onDone?.();
    },
  });
  m.el.querySelector('.modal').classList.add('wide');
}
