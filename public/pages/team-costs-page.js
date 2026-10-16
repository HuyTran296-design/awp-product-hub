// Cấu hình → Chi phí team: team-wide settings (effective from a chosen month) + monthly allocation of
// every project, "Dự án đã xóa" and "Chưa phân bổ". Closed months are read-only history.

import { get, put } from '../api.js';
import { shareBar } from '../charts.js';
import { esc, lifecycleBadge, monthOptions, parseVnd, sampleTag, toast } from '../ui.js';
import { createStopLossEditor } from '../components/stoploss-editor.js';
import { formatDate, formatDateTime, formatNumber, formatPct, formatVnd } from '/shared/format.js';

export async function render(root, ctx) {
  let month = ctx.query.month;
  let data = await get(`/api/team-costs${month ? `?month=${month}` : ''}`);
  let slDefault = await get('/api/stoploss-default');
  if (!ctx.isCurrent()) return;
  let slEditor = null;
  let draft;
  let initial;
  const resetDraft = () => {
    const s = data.settings;
    draft = { effectiveDate: data.firstOpenDate, fixedMonthlyCost: s.fixedMonthlyCost, workingDays: s.workingDays,
      allocationMode: s.allocationMode, usdVndRate: s.usdVndRate, reason: '' };
    initial = JSON.stringify({ ...draft, effectiveDate: null, reason: null });
  };
  const isDirty = () => JSON.stringify({ ...draft, effectiveDate: null, reason: null }) !== initial;
  resetDraft();
  ctx.setGuard(() => isDirty() || Boolean(slEditor?.isDirty()));

  const errors = () => {
    const e = [];
    if (!(draft.fixedMonthlyCost > 0)) e.push('Chi phí cố định của team phải lớn hơn 0.');
    if (!(Number.isInteger(draft.workingDays) && draft.workingDays >= 1 && draft.workingDays <= 31)) e.push('Số ngày làm việc/tháng phải từ 1 đến 31.');
    if (!(draft.usdVndRate > 0)) e.push('Tỷ giá phải lớn hơn 0.');
    return e;
  };

  const draw = () => {
    const t = data.table;
    const wd = t.workingDays;
    root.innerHTML = `
      ${ctx.pageHeader({ title: 'Chi phí team', crumb: 'Cấu hình' })}
      <div class="stack">
      <section class="card">
        <div class="card-head"><div><h2>Thiết lập chung của team</h2><div class="sub">Áp dụng từ tháng được chọn; các tháng trước giữ nguyên số liệu</div></div></div>
        <div class="form-grid">
          <label class="field"><span>Hiệu lực từ tháng</span><select class="input" data-f="effectiveDate">${monthOptions(data.firstOpenDate, draft.effectiveDate)}</select></label>
          <label class="field"><span>Chi phí cố định của team AWP/tháng</span>
            <div class="input-suffix" data-suffix="₫"><input class="input right" data-f="fixedMonthlyCost" data-vnd inputmode="numeric" value="${formatNumber(draft.fixedMonthlyCost)}"></div>
            <span class="hint">TỔNG chi phí team: lương nhân sự, công cụ, vận hành…</span></label>
          <label class="field"><span>Số ngày làm việc/tháng</span><input class="input right" data-f="workingDays" type="number" min="1" max="31" value="${draft.workingDays}"></label>
          <label class="field"><span>Tỷ giá USD → VND</span>
            <div class="input-suffix" data-suffix="₫"><input class="input right" data-f="usdVndRate" data-vnd inputmode="numeric" value="${formatNumber(draft.usdVndRate)}"></div></label>
        </div>
        <div class="field" style="margin-top:14px"><span>Cách phân bổ chi phí chung</span>
          <div class="radio-row">
            <label class="radio-card"><input type="radio" name="mode" value="fte" ${draft.allocationMode === 'fte' ? 'checked' : ''}>
              <span><b>Theo tỷ lệ FTE</b> (mặc định)<br><span class="small muted">Quỹ chung × FTE sản phẩm ÷ Σ FTE các sản phẩm đang chạy</span></span></label>
            <label class="radio-card"><input type="radio" name="mode" value="manual" ${draft.allocationMode === 'manual' ? 'checked' : ''}>
              <span><b>Nhập % thủ công</b><br><span class="small muted">Nhập "% chi phí chung" ở tab Nhân sự & chi phí của từng sản phẩm</span></span></label>
          </div></div>
        <label class="field" style="margin-top:12px"><span>Ghi chú thay đổi <span class="muted">(không bắt buộc)</span></span><input class="input" data-f="reason" maxlength="200" value="${esc(draft.reason)}"></label>
        <div data-feedback style="margin-top:12px"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;align-items:center">
          <span class="note" data-dirty></span><button class="btn" data-reset>Hoàn tác</button><button class="btn primary" data-save>Lưu thiết lập</button></div>
        <details style="margin-top:12px"><summary class="small">Các phiên bản thiết lập (${data.settingsVersions.length})</summary>
          <div class="versions" style="margin-top:8px">${data.settingsVersions.map((v) => `<div class="version"><b>Hiệu lực từ ${v.effectiveDate <= '2000-01-01' ? 'ban đầu' : formatDate(v.effectiveDate)}</b>
            · ${formatVnd(v.fixedMonthlyCost)}/tháng · ${v.workingDays} ngày công · ${v.allocationMode === 'manual' ? 'thủ công' : 'theo FTE'} · ${formatNumber(v.usdVndRate)} ₫/USD
            <div class="note">${esc(v.createdBy)} · ${formatDateTime(v.createdAt)}</div></div>`).join('')}</div></details>
      </section>

      <section class="card">
        <div class="card-head"><div><h2>Chính sách cắt lỗ mặc định</h2>
          <div class="sub">Tự áp cho sản phẩm mới (theo dõi từ ngày bắt đầu tính chi phí); mỗi sản phẩm / dự án sửa riêng ở tab "Phương án cắt lỗ".</div></div></div>
        <div data-sl-default></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;align-items:center">
          <span class="note" data-sl-note></span><button class="btn" data-sl-reset>Hoàn tác</button><button class="btn primary" data-sl-save>Lưu chính sách mặc định</button></div>
      </section>

      <section class="card">
        <div class="card-head"><div><h2>Phân bổ chi phí theo tháng</h2>
          <div class="sub">Chi phí cố định/tháng trung bình theo ngày trong tháng${data.closed ? ' · <span class="pill-closed">đã chốt sổ</span>' : ''}</div></div>
          <div style="display:flex;gap:8px;align-items:center">${sampleTag()}<select class="input" data-month style="width:auto">${data.months.map((m) =>
            `<option value="${m}" ${m === data.month ? 'selected' : ''}>Tháng ${Number(m.slice(5))}/${m.slice(0, 4)}</option>`).join('')}</select></div></div>
        ${t.overheadNegative ? '<div class="alert error" style="margin-bottom:12px">⚠ Tổng lương đang vượt chi phí cố định của team.</div>' : ''}
        <div class="kpi-grid" style="margin-bottom:16px">
          ${mini('Tổng chi phí team/tháng', formatVnd(t.teamTotal))}
          ${mini('Tổng lương toàn team', formatVnd(t.payrollTotal))}
          ${mini('Quỹ chi phí chung', formatVnd(t.overheadFund))}
          ${mini('Chưa phân bổ', `${formatVnd(t.unallocated)} <span class="small muted">(${formatPct(t.unallocatedPct)})</span>`)}
        </div>
        ${shareBar(data.costShare)}
        <div class="table-wrap" style="margin-top:16px"><table>
          <thead><tr><th>Sản phẩm</th><th>Trạng thái</th><th class="r">FTE</th><th class="r">Nhân sự trực tiếp</th><th class="r">Chi phí chung</th>
            <th class="r">Tổng/tháng</th><th class="r">/ngày (÷ ${wd})</th><th class="r">% chi phí team</th></tr></thead>
          <tbody>${t.rows.map((r) => `<tr>
            <td>${r.deleted ? '<span class="muted">Sản phẩm đã xóa</span>' : `<a href="#/config/projects/${r.id}"><span class="dot" style="background:${esc(r.color)}"></span> ${esc(r.name)}</a>`}</td>
            <td>${r.deleted ? '<span class="badge lc-deleted">✕ Đã xóa</span>' : lifecycleBadge(r.status, r.statusLabel)}</td>
            <td class="r">${formatNumber(r.fte, 1)}</td><td class="r">${formatVnd(r.direct)}</td><td class="r">${formatVnd(r.overhead)}</td>
            <td class="r"><b>${formatVnd(r.total)}</b></td><td class="r">${formatVnd(r.total / wd)}</td><td class="r">${formatPct(r.teamPct)}</td></tr>`).join('')}
            <tr><td>Chưa phân bổ${t.unallocatedShared > 0.5 ? `<div class="note">Gồm ${formatVnd(t.unallocatedShared)} nhân sự chung của dự án chưa có sản phẩm để chia chi phí</div>` : ''}</td><td></td><td></td><td></td><td></td><td class="r"><b>${formatVnd(t.unallocated)}</b></td>
              <td class="r">${formatVnd(t.unallocated / wd)}</td><td class="r">${formatPct(t.unallocatedPct)}</td></tr></tbody>
          <tfoot><tr><td>Tổng</td><td></td><td></td><td></td><td></td><td class="r">${formatVnd(t.teamTotal)}</td><td class="r">${formatVnd(t.teamTotal / wd)}</td><td class="r">100,0%</td></tr></tfoot>
        </table></div>
      </section>
      </div>`;
    ctx.bindPageHeader(root);
    bind();
    refresh();
    drawStopLossDefault();
  };

  const drawStopLossDefault = () => {
    const host = root.querySelector('[data-sl-default]');
    const syncSl = () => {
      root.querySelector('[data-sl-save]').disabled = !slEditor.isDirty() || slEditor.errors().length > 0;
      root.querySelector('[data-sl-reset]').disabled = !slEditor.isDirty();
      root.querySelector('[data-sl-note]').textContent = slEditor.errors()[0] ?? (slEditor.isDirty() ? 'Có thay đổi chưa lưu' : '');
    };
    slEditor = createStopLossEditor(host, { policy: slDefault.policy, isDefault: true, onChange: () => syncSl() });
    syncSl();
    root.querySelector('[data-sl-reset]').addEventListener('click', () => drawStopLossDefault());
    root.querySelector('[data-sl-save]').addEventListener('click', async () => {
      try {
        const r = await put('/api/stoploss-default', slEditor.getValue());
        slDefault = { ...slDefault, policy: r.policy };
        toast('Đã lưu chính sách cắt lỗ mặc định (áp dụng cho sản phẩm mới).');
        drawStopLossDefault();
      } catch (err) { toast(err.message, 'error'); }
    });
  };

  const refresh = () => {
    const errs = errors();
    root.querySelector('[data-feedback]').innerHTML = errs.length ? `<div class="alert error"><ul>${errs.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
    root.querySelector('[data-save]').disabled = errs.length > 0 || !isDirty();
    root.querySelector('[data-reset]').disabled = !isDirty();
    root.querySelector('[data-dirty]').textContent = isDirty() ? `Có thay đổi chưa lưu · áp dụng từ ${formatDate(draft.effectiveDate)}` : '';
  };

  const bind = () => {
    root.querySelectorAll('[data-f]').forEach((i) => {
      const f = i.dataset.f;
      i.addEventListener(i.tagName === 'SELECT' ? 'change' : 'input', () => {
        draft[f] = i.hasAttribute('data-vnd') ? parseVnd(i.value) : f === 'workingDays' ? Number(i.value) : i.value;
        refresh();
      });
      if (i.hasAttribute('data-vnd')) i.addEventListener('blur', () => { if (Number.isFinite(draft[f])) i.value = formatNumber(draft[f]); });
    });
    root.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', () => { draft.allocationMode = r.value; refresh(); }));
    root.querySelector('[data-reset]').addEventListener('click', () => { resetDraft(); draw(); });
    root.querySelector('[data-save]').addEventListener('click', async () => {
      try {
        data = await put('/api/team-costs', draft);
        toast(`Đã lưu thiết lập, hiệu lực từ ${formatDate(draft.effectiveDate)}.`);
        resetDraft();
        draw();
      } catch (err) { toast(err.message, 'error'); }
    });
    root.querySelector('[data-month]').addEventListener('change', async (e) => {
      month = e.target.value;
      history.replaceState(null, '', `#/config/team-costs?month=${month}`);
      const keep = { ...draft };
      const keepInitial = initial;
      data = await get(`/api/team-costs?month=${month}`);
      draft = keep;
      initial = keepInitial;
      draw();
    });
  };

  draw();
}

function mini(label, value) {
  return `<div style="border:1px solid var(--border);border-radius:12px;padding:12px"><div class="kpi-label">${label}</div>
    <div class="kpi-value" style="font-size:18px">${value}</div></div>`;
}
