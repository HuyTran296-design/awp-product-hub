// "Tải lên CSV": download the template, upload a file, preview with per-line errors,
// choose to overwrite or skip duplicate rows, then import the valid lines.

import { post } from '../api.js';
import { esc, toast } from '../ui.js';
import { formatNumber } from '/shared/format.js';

export function createCsvUpload(el, projectId) {
  let text = null;
  el.innerHTML = `<section class="card">
    <div class="card-head"><div><h2>Tải lên CSV</h2><div class="sub">Cột: date, metric_key, platform, value · dùng cho baseline có nguồn "Tải lên CSV" hoặc số liệu chưa có kết nối</div></div>
      <a class="btn sm" href="/api/csv-template" download>Tải file mẫu</a></div>
    <div class="form-grid" style="align-items:end">
      <label class="field"><span>File CSV</span><input class="input" type="file" accept=".csv,text/csv" data-file></label>
      <div class="field"><span>Dòng trùng (đã có số liệu)</span><div class="radio-row">
        <label class="radio-card"><input type="radio" name="csv-mode" value="skip" checked><span>Bỏ qua</span></label>
        <label class="radio-card"><input type="radio" name="csv-mode" value="overwrite"><span>Ghi đè</span></label></div></div>
    </div>
    <div data-preview style="margin-top:12px"></div>
  </section>`;
  const $ = (s) => el.querySelector(s);
  $('[data-file]').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2_000_000) return toast('File CSV tối đa 2 MB.', 'error');
    text = await file.text();
    try {
      const r = await post(`/api/projects/${projectId}/csv/preview`, { csv: text });
      $('[data-preview]').innerHTML = `
        <div class="alert ${r.errors.length ? 'warn' : 'info'}"><div><b>Xem trước:</b> ${formatNumber(r.total)} dòng · ${formatNumber(r.valid)} hợp lệ ·
          <b>${formatNumber(r.errors.length)} dòng lỗi</b> · ${formatNumber(r.duplicates)} dòng trùng với số liệu đã có</div></div>
        ${r.errors.length ? `<div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>Dòng</th><th>Nội dung</th><th>Lỗi</th></tr></thead>
          <tbody>${r.errors.slice(0, 50).map((x) => `<tr><td>${x.line}</td><td><code>${esc(x.raw)}</code></td><td class="wrap over">${esc(x.message)}</td></tr>`).join('')}</tbody></table></div>` : ''}
        ${r.sample.length ? `<div class="table-wrap" style="margin-top:8px"><table><thead><tr><th>Dòng</th><th>Ngày</th><th>Chỉ số</th><th>Nền tảng</th><th class="r">Giá trị</th><th>Trùng</th></tr></thead>
          <tbody>${r.sample.map((x) => `<tr><td>${x.line}</td><td>${esc(x.date)}</td><td>${esc(x.name)}</td><td>${esc(x.platform)}</td><td class="r">${formatNumber(x.value, 2)}</td>
            <td>${x.existing != null ? `đang có ${formatNumber(x.existing, 2)}` : '—'}</td></tr>`).join('')}</tbody></table></div>` : ''}
        <div style="display:flex;justify-content:flex-end;margin-top:10px"><button class="btn primary" data-import ${r.valid ? '' : 'disabled'}>Nhập ${formatNumber(r.valid)} dòng hợp lệ</button></div>`;
      $('[data-import]')?.addEventListener('click', async () => {
        try {
          const mode = el.querySelector('input[name="csv-mode"]:checked').value;
          const res = await post(`/api/projects/${projectId}/csv/import`, { csv: text, mode });
          toast(`Đã nhập ${res.written} dòng${res.skipped ? `, bỏ qua ${res.skipped} dòng trùng` : ''}${res.errors.length ? `, ${res.errors.length} dòng lỗi không nhập` : ''}.`);
          $('[data-preview]').innerHTML = '';
          $('[data-file]').value = '';
        } catch (err) { toast(err.message, 'error'); }
      });
    } catch (err) {
      $('[data-preview]').innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
    }
  });
}
