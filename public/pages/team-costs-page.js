// Cấu hình → Chi phí team: Thiết lập chung (lương nhân sự, chỉ xem + Chi phí Tools/AI with tabs "Cấu hình" | "Theo tháng")
// and "Phân bổ chi phí" of a calendar month per project, monthly or daily (÷ working days).
// Cấu hình: one row per tool (Tên · Kiểu chi phí · Số tiền · Tiền tệ · Áp dụng cho · xóa). Changes apply from the current
// month; "Xóa" stops the tool from the current month and keeps earlier months.
// Theo tháng: planned (grey italic) or actual per tool and month; click a cell to enter the invoice amount.

import { del, get, put } from '../api.js';
import { shareBar } from '../charts.js';
import { confirmDialog, esc, lifecycleBadge, parseDecimal, parseVnd, sampleTag, toast } from '../ui.js';
import { createToolScopePicker } from '../components/tool-scope-picker.js';
import { formatDate, formatDateTime, formatNumber, formatPct, formatVnd } from '/shared/format.js';
import { USD_VND_RATE } from '/shared/system-config.js';
import { AMOUNT_SUFFIX, monthLabel, TOOL_KINDS, toVnd } from '/shared/tool-costs.js';

const SORT_COLS = [['salary', 'Lương'], ['tools', 'Tools/AI'], ['total', 'Tổng chi phí'], ['teamPct', '% chi phí team'], ['revenue', 'Doanh thu'], ['profit', 'Lãi/Lỗ']];
const AMOUNT_TIP = 'Thay đổi áp dụng từ tháng này, không ảnh hưởng các tháng trước';
const FIELDS = ['id', 'name', 'kind', 'currency', 'amount', 'appliesTo'];
const parseMoney = (text, currency) => (currency === 'USD' ? parseDecimal(text) : parseVnd(text));
const inputMoney = (v, currency) => (Number.isFinite(v) ? formatNumber(v, currency === 'USD' && !Number.isInteger(v) ? 2 : 0) : '');
const snapshot = (tools) => JSON.stringify(tools.map((t) => FIELDS.map((f) => t[f])));

export async function render(root, ctx) {
  let month = ctx.query.month;
  let unit = ctx.query.unit === 'day' ? 'day' : 'month';
  let tab = ctx.query.tab === 'monthly' ? 'monthly' : 'config';
  let data = await get(`/api/team-costs${month ? `?month=${month}` : ''}`);
  if (!ctx.isCurrent()) return;
  month = data.month;
  let draft;
  let initial;
  let editing = null; // { toolId, month } of the cell being edited in "Theo tháng"
  const expanded = new Set();
  let sort = { key: null, dir: 1 }; // "Phân bổ chi phí" column sort; dir 1 = ascending
  const savedTools = () => data.settings.tools.map((t) => ({ ...t, appliesTo: [...t.appliesTo] }));
  const resetDraft = () => {
    draft = { tools: savedTools(), reason: '' };
    initial = snapshot(draft.tools);
  };
  const isDirty = () => snapshot(draft.tools) !== initial;
  resetDraft();
  ctx.setGuard(() => isDirty());
  const nowMonth = data.today.slice(0, 7);

  /**
   * Tools/AI of the current month with the unsaved edits: an unchanged tool keeps its figure of "Theo tháng" (incl. the
   * actual); an edited or new one counts from this month (an entered actual still wins).
   */
  const toolsThisMonth = () => draft.tools.reduce((sum, t) => {
    const saved = t.id && data.settings.tools.find((x) => x.id === t.id);
    const cell = saved && data.monthly.rows.find((r) => r.id === t.id)?.cells.find((c) => c.month === nowMonth);
    if (saved && snapshot([saved]) === snapshot([t])) return sum + (cell?.value ?? 0);
    if (saved && saved.fromMonth && saved.fromMonth > nowMonth) return sum; // still starts later
    if (cell?.actual != null) return sum + cell.actual;
    const amount = Number.isFinite(t.amount) ? t.amount : 0;
    return sum + toVnd(t.kind === 'annual' ? amount / 12 : amount, t.currency);
  }, 0);

  const errors = () => {
    const e = [];
    draft.tools.forEach((t, i) => {
      if (!t.name.trim()) e.push(`Tool dòng ${i + 1}: vui lòng nhập tên.`);
      if (!(Number.isFinite(t.amount) && t.amount >= 0)) e.push(`${t.name.trim() || `Tool dòng ${i + 1}`}: số tiền phải ≥ 0.`);
    });
    return e;
  };

  const toolRow = (t, i) => {
    const name = t.name || `tool dòng ${i + 1}`;
    const vnd = t.currency === 'USD' && Number.isFinite(t.amount) ? `≈ ${formatVnd(toVnd(t.amount, 'USD'))}` : '';
    return `<div class="tool-row" role="row" data-row="${i}">
      <div class="tool-name" role="cell"><input class="input" data-t="name" maxlength="80" value="${esc(t.name)}" placeholder="Tên tool" aria-label="Tên tool dòng ${i + 1}"></div>
      <div class="tool-kind" role="cell"><select class="input" data-t="kind" aria-label="Kiểu chi phí ${esc(name)}">${Object.entries(TOOL_KINDS).map(([k, l]) =>
        `<option value="${k}" ${k === t.kind ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="tool-cost" role="cell"><div class="input-suffix tool-amount" data-suffix="${AMOUNT_SUFFIX[t.kind]}">
        <input class="input right" data-t="amount" inputmode="decimal" value="${inputMoney(t.amount, t.currency)}" aria-label="Số tiền ${esc(name)}"></div>
        <div class="note tool-vnd" data-vnd>${vnd}</div></div>
      <div class="tool-currency" role="cell"><select class="input" data-t="currency" aria-label="Tiền tệ ${esc(name)}">${['VND', 'USD'].map((c) =>
        `<option ${c === t.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="tool-scope-field" role="cell" data-scope="${i}"></div>
      <div class="tool-del" role="cell"><button type="button" class="icon-btn tool-remove" data-remove="${i}" aria-label="Xóa ${esc(name)}" title="Xóa">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg></button></div>
    </div>`;
  };

  const configTab = () => `
    <div class="tool-table" role="table" aria-label="Danh sách Tools/AI">
      <div class="tool-row tool-head" role="row"><span role="columnheader">Tên</span><span role="columnheader">Kiểu chi phí</span>
        <span role="columnheader"><span class="tip-label" tabindex="0" data-tip="${esc(AMOUNT_TIP)}">Số tiền</span></span>
        <span role="columnheader">Tiền tệ</span><span role="columnheader">Áp dụng cho</span><span role="columnheader"><span class="sr-only">Xóa</span></span></div>
      ${draft.tools.map(toolRow).join('') || '<p class="muted small tool-empty">Chưa có tool nào.</p>'}
      <div class="tool-foot"><button type="button" class="btn" data-add>+ Thêm tool</button>
        <span>Tổng Tools/AI tháng ${monthLabel(nowMonth)}: <b data-tools-sum>${formatVnd(toolsThisMonth())}</b></span></div>
    </div>
    <p class="note">USD quy đổi theo tỷ giá hệ thống ${formatNumber(USD_VND_RATE)} ₫/USD. Thay đổi và tool mới tính từ tháng ${monthLabel(nowMonth)}; các tháng trước giữ nguyên.</p>
    <div class="team-total"><span>Tổng chi phí team tháng ${monthLabel(nowMonth)} = Lương nhân sự + Tools/AI</span><b data-team-sum>${formatVnd(data.payroll.total + toolsThisMonth())}</b></div>
    <label class="field" style="margin-top:12px"><span>Ghi chú thay đổi <span class="muted">(không bắt buộc)</span></span><input class="input" data-f="reason" maxlength="200" value="${esc(draft.reason)}"></label>
    <div data-feedback style="margin-top:12px"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;align-items:center;flex-wrap:wrap">
      <span class="note" data-dirty></span><button class="btn" data-reset>Hoàn tác</button><button class="btn primary" data-save>Lưu Tools/AI</button></div>`;

  const cellHtml = (r, c) => {
    if (!c.active) return '<td class="r tm-off"></td>';
    const key = `${r.id}|${c.month}`;
    if (editing && editing.toolId === r.id && editing.month === c.month) {
      return `<td class="r tm-editing"><div class="money-input tm-input"><input class="input right" data-cell-input inputmode="decimal"
          value="${c.actualAmount != null ? inputMoney(c.actualAmount, c.currency) : ''}" placeholder="${esc(inputMoney(c.actual ?? (c.currency === 'USD' ? c.planned / USD_VND_RATE : c.planned), c.currency))}"
          aria-label="Số thực tế ${esc(r.name)} tháng ${monthLabel(c.month)} (${c.currency})"><span class="tm-cur">${c.currency}</span></div>
        <div class="tm-actions"><button type="button" class="btn small primary" data-cell-save>Lưu</button>
          ${c.actual != null ? '<button type="button" class="btn small" data-cell-clear>Xóa số thực tế</button>' : ''}</div></td>`;
    }
    const state = c.actual != null ? 'actual' : c.missing ? 'missing' : 'planned';
    const tip = state === 'actual' ? `Thực tế${c.enteredBy ? ` · ${c.enteredBy} · ${formatDateTime(c.enteredAt)}` : ''}`
      : state === 'missing' ? 'Ước tính — chưa nhập số thực tế' : 'Dự kiến (từ cấu hình)';
    return `<td class="r"><button type="button" class="tm-cell ${state}" data-cell="${esc(key)}" title="${esc(tip)}"
        aria-label="${esc(r.name)} tháng ${monthLabel(c.month)}: ${formatVnd(c.value)} · ${esc(tip)}">${state === 'missing' ? '<span class="tm-dot" aria-hidden="true"></span>' : ''}${formatVnd(c.value)}${state === 'missing' ? '<span class="tm-tag">Ước tính</span>' : ''}</button></td>`;
  };

  const monthlyTab = () => {
    const mt = data.monthly;
    return `<div class="table-wrap"><table class="tm-table">
        <thead><tr><th>Tool</th>${mt.months.map((m) => `<th class="r">${monthLabel(m)}${m === mt.currentMonth ? '<div class="note">hiện tại</div>' : ''}</th>`).join('')}</tr></thead>
        <tbody>${mt.rows.map((r) => `<tr class="${r.removedFrom ? 'tm-stopped' : ''}"><td>${esc(r.name)}<div class="note">${r.removedFrom
          ? `Đã ngừng từ tháng ${monthLabel(r.removedFrom)}` : `${TOOL_KINDS[r.kind]}${r.cells.at(-1).currency === 'USD' ? ' · USD' : ''}`}</div></td>
          ${r.cells.map((c) => cellHtml(r, c)).join('')}</tr>`).join('') || `<tr><td colspan="${mt.months.length + 1}" class="muted">Chưa có tool nào.</td></tr>`}</tbody>
        <tfoot><tr><td>Tổng Tools/AI</td>${mt.totals.map((x) => `<td class="r">${formatVnd(x.value)}</td>`).join('')}</tr></tfoot>
      </table></div>
      <div class="tm-legend note"><span class="tm-cell planned">Dự kiến</span> từ cấu hình · <span class="tm-cell actual">Thực tế</span> theo hóa đơn ·
        <span class="tm-dot" aria-hidden="true"></span> Ước tính: tool Theo mức dùng chưa nhập số thực tế. Bấm một ô để nhập số thực tế (Enter lưu, Esc hủy).</div>`;
  };

  const reminder = () => {
    const miss = data.monthly.missing;
    if (!miss.length) return '';
    const months = [...new Set(miss.map((x) => x.month))].sort().map(monthLabel).join(', ');
    return `<div class="tm-reminder"><span class="tm-dot" aria-hidden="true"></span>${miss.length} khoản chưa nhập số thực tế tháng ${months} –
      <button type="button" class="link-btn" data-goto-monthly>Nhập ngay</button></div>`;
  };

  const historyBlock = () => (data.history.length ? `<details style="margin-top:16px"><summary class="small">Lịch sử thay đổi Tools/AI (${data.history.length})</summary>
      <div class="table-wrap" style="margin-top:8px"><table class="history-table"><thead><tr><th>Thời điểm</th><th>Người thực hiện</th><th>Nội dung</th><th>Cũ → mới</th></tr></thead>
      <tbody>${data.history.map((h) => `<tr><td>${formatDateTime(h.at)}</td><td>${esc(h.actor)}</td><td>${esc(h.field)}${h.reason ? `<div class="note">${esc(h.reason)}</div>` : ''}</td>
        <td>${esc(h.oldValue)} → ${esc(h.newValue)}</td></tr>`).join('')}</tbody></table></div></details>` : '');

  const draw = () => {
    const t = data.table;
    const div = unit === 'day' ? t.workingDays : 1;
    const money = (v) => formatVnd(v / div);
    const per = unit === 'day' ? '/ngày' : '/tháng';
    const payroll = data.payroll;
    root.innerHTML = `
      ${ctx.pageHeader({ title: 'Chi phí team', crumb: 'Cấu hình' })}
      ${reminder()}
      <div class="stack">
      <section class="card">
        <div class="card-head"><div><h2>Thiết lập chung</h2><div class="sub">Tổng chi phí team của một tháng = lương nhân sự + Tools/AI của tháng đó</div></div></div>

        <h3 class="setting-title">Chi phí lương nhân sự</h3>
        <div class="fin-row"><span class="label">Lương nhân sự: <b class="value">${formatVnd(payroll.total)}</b>/tháng · ${payroll.count} người</span>
          <a href="#/config/members">Quản lý nhân sự</a></div>

        <h3 class="setting-title">Chi phí Tools/AI</h3>
        <div class="tabs" role="tablist">${[['config', 'Cấu hình'], ['monthly', 'Theo tháng']].map(([k, l]) =>
          `<button type="button" class="tab" role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`).join('')}</div>
        <div data-tab-body>${tab === 'config' ? configTab() : monthlyTab()}</div>
        ${historyBlock()}
      </section>

      <section class="card">
        <div class="card-head"><div><h2>Phân bổ chi phí</h2>
          <div class="sub">${unit === 'day' ? `Trung bình mỗi ngày làm việc (÷ ${t.workingDays})` : 'Theo tháng'} · tháng ${monthLabel(data.month)}</div></div>
          <div class="alloc-controls">${sampleTag()}
            <div class="seg" role="group" aria-label="Đơn vị">
              <button type="button" data-unit="month" aria-pressed="${unit === 'month'}">Theo tháng</button>
              <button type="button" data-unit="day" aria-pressed="${unit === 'day'}">Theo ngày</button></div>
            <select class="input" data-month style="width:auto" aria-label="Tháng">${data.months.map((m) =>
              `<option value="${m}" ${m === data.month ? 'selected' : ''}>Tháng ${monthLabel(m)}</option>`).join('')}</select>${monthBadge()}</div></div>
        <div class="alloc-summary">
          <div><div class="kpi-label">Tổng chi phí</div><b>${money(t.teamTotal)}</b></div>
          <div><div class="kpi-label">Tổng doanh thu</div><b>${t.revenueTotal == null ? '—' : money(t.revenueTotal)}</b></div>
          <div><div class="kpi-label">Lãi/Lỗ team</div>${profitHtml(t.profitTotal, money, { big: true })}</div>
        </div>
        ${shareBar(data.costShare)}
        <div class="table-wrap" style="margin-top:16px"><table class="alloc-table">
          <thead><tr><th>Dự án</th>${SORT_COLS.map(([key, label], i) => `<th class="r${key === 'revenue' ? ' alloc-split' : ''}"
            aria-sort="${sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}"><button type="button" class="sort-btn" data-sort="${key}">${label}${key === 'tools' && t.toolsIncludePlanned ? '<span class="note"> gồm số dự kiến</span>' : ''}
            <span class="sort-ind" aria-hidden="true">${sort.key === key ? (sort.dir === 1 ? '▲' : '▼') : ''}</span></button></th>`).join('')}</tr></thead>
          <tbody>${sortedRows(t.rows).map((r) => projectRows(r, money)).join('')}
            <tr class="alloc-unallocated"><td>Lương chưa phân bổ<div class="note">Năng lực nhân sự chưa giao việc</div></td>
              <td class="r">${money(t.unallocatedSalary)}</td><td class="r muted">—</td><td class="r"><b>${money(t.unallocatedSalary)}</b></td><td class="r">${formatPct(t.unallocatedSalaryPct)}</td>
              <td class="r muted alloc-split">—</td><td class="r">${profitHtml(-t.unallocatedSalary, money, { muted: true })}</td></tr>
            ${t.unallocatedTools > 0.5 ? `<tr class="alloc-unallocated"><td>Tools/AI chưa phân bổ<div class="note">Không có dự án đang chạy trong nhóm "Áp dụng cho"</div></td>
              <td class="r muted">—</td><td class="r">${money(t.unallocatedTools)}</td><td class="r"><b>${money(t.unallocatedTools)}</b></td><td class="r">${formatPct(t.unallocatedToolsPct)}</td>
              <td class="r muted alloc-split">—</td><td class="r">${profitHtml(-t.unallocatedTools, money, { muted: true })}</td></tr>` : ''}
          </tbody>
          <tfoot><tr><td>Tổng chi phí team</td><td class="r">${money(t.payrollTotal)}</td><td class="r">${money(t.toolsTotal)}</td>
            <td class="r">${money(t.teamTotal)}</td><td class="r">100,0%</td>
            <td class="r alloc-split">${t.revenueTotal == null ? '—' : money(t.revenueTotal)}</td><td class="r">${profitHtml(t.profitTotal, money)}</td></tr></tfoot>
        </table></div>
      </section>
      </div>`;
    ctx.bindPageHeader(root);
    bind();
    if (tab === 'config') refresh();
  };

  /** Badge next to the month: Tạm tính đến … (current month) · Chưa chốt · Đã chốt sổ. */
  const monthBadge = () => {
    const st = data.monthState;
    if (st.status === 'provisional') return `<span class="pill-provisional">Tạm tính đến ${formatDate(st.through)}</span>`;
    if (st.status === 'open') return '<span class="pill-provisional">Chưa chốt</span>';
    if (st.status === 'closed') return '<span class="pill-closed">Đã chốt sổ</span>';
    return '';
  };

  /** Lãi/Lỗ: green "+… Lời", red "−… Lỗ", grey "Đang đầu tư" for a build-phase loss, grey without label when muted. */
  const profitHtml = (v, money, { investing = false, muted = false, big = false } = {}) => {
    if (v == null) return '<span class="muted">—</span>';
    const text = `${v < 0 ? '−' : '+'}${money(Math.abs(v))}`;
    if (muted) return `<span class="pl muted">${text}</span>`;
    const [cls, label] = v < 0 ? (investing ? ['pl muted', 'Đang đầu tư'] : ['pl neg', 'Lỗ']) : ['pl pos', 'Lời'];
    return `<span class="${cls}${big ? ' big' : ''}">${text}</span> <span class="pl-tag ${cls}">${label}</span>`;
  };

  /** Project rows sorted by the chosen column (empty values last); unallocated and total rows stay below. */
  const sortedRows = (rows) => (sort.key ? [...rows].sort((a, b) => {
    const x = a[sort.key];
    const y = b[sort.key];
    if (x == null || y == null) return (x == null) - (y == null);
    return (x - y) * sort.dir;
  }) : rows);

  const projectRows = (r, money) => {
    const cells = `<td class="r">${money(r.salary)}</td><td class="r">${money(r.tools)}</td><td class="r"><b>${money(r.total)}</b></td><td class="r">${formatPct(r.teamPct)}</td>
      <td class="r alloc-split">${r.revenue == null ? '<span class="muted">—</span>' : money(r.revenue)}</td><td class="r">${profitHtml(r.profit, money, { investing: r.investing })}</td>`;
    if (r.deleted) return `<tr><td class="muted">Dự án đã xóa</td>${cells}</tr>`;
    const open = expanded.has(r.id);
    const badge = r.status && r.status !== 'active' ? ` ${lifecycleBadge(r.status, r.statusLabel)}` : '';
    const detail = open ? `<tr class="alloc-detail"><td colspan="7"><div class="alloc-detail-grid">
        <div><div class="kpi-label">Nhân sự</div>${r.detail.members.map((m) => `<div class="fin-row"><span class="label">${esc(m.name)}
          <span class="note">· ${formatNumber(m.effortPct, 1)}%</span></span>
          <span class="value">${money(m.monthly)}</span></div>`).join('') || '<p class="muted small">Không có nhân sự.</p>'}</div>
        <div><div class="kpi-label">Tools/AI được chia</div>${r.detail.tools.map((x) => `<div class="fin-row"><span class="label">${esc(x.name)}</span>
          <span class="value">${money(x.amount)}</span></div>`).join('') || '<p class="muted small">Không nhận tool nào.</p>'}</div>
      </div></td></tr>` : '';
    return `<tr><td><button type="button" class="tree-toggle alloc-toggle" data-expand="${r.id}" aria-expanded="${open}"
        aria-label="${open ? 'Thu gọn' : 'Xem'} chi tiết chi phí của ${esc(r.name)}"><span aria-hidden="true">${open ? '▾' : '▸'}</span></button>
        <span class="dot" style="background:${esc(r.color)}"></span> ${esc(r.name)}${badge}
        <span class="note">· FTE ${formatNumber(r.fte, 1)}</span></td>${cells}</tr>${detail}`;
  };

  const refresh = () => {
    const errs = errors();
    root.querySelector('[data-feedback]').innerHTML = errs.length ? `<div class="alert error"><ul>${errs.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '';
    root.querySelector('[data-save]').disabled = errs.length > 0 || !isDirty();
    root.querySelector('[data-reset]').disabled = !isDirty();
    root.querySelector('[data-dirty]').textContent = isDirty() ? 'Có thay đổi chưa lưu' : '';
    root.querySelector('[data-tools-sum]').textContent = formatVnd(toolsThisMonth());
    root.querySelector('[data-team-sum]').textContent = formatVnd(data.payroll.total + toolsThisMonth());
  };

  const url = () => `#/config/team-costs?month=${month}${unit === 'day' ? '&unit=day' : ''}${tab === 'monthly' ? '&tab=monthly' : ''}`;
  const reload = async () => {
    const keep = { draft, initial };
    data = await get(`/api/team-costs?month=${month}`);
    ({ draft, initial } = keep);
    history.replaceState(null, '', url());
    draw();
  };
  /** Server data changed (an actual): keep unsaved Cấu hình edits only when there are none. */
  const applyData = (next) => {
    const dirty = isDirty();
    data = next;
    if (!dirty) resetDraft();
  };

  /** "Xóa": confirm, stop the tool from this month on the server; other unsaved edits of the list are kept. */
  const removeTool = async (i) => {
    const tool = draft.tools[i];
    if (!tool.id) { draft.tools.splice(i, 1); draw(); return; }
    const name = tool.name || data.settings.tools.find((x) => x.id === tool.id)?.name || 'tool';
    const ok = await confirmDialog({ title: `Xóa ${name}`, confirmLabel: 'Xóa', danger: true,
      body: `<p>Ngừng tính ${esc(name)} từ tháng ${monthLabel(nowMonth)}? Chi phí các tháng trước vẫn được giữ.</p>` });
    if (!ok) { root.querySelector(`[data-remove="${i}"]`)?.focus(); return; }
    try {
      data = await del(`/api/team-costs/tools/${encodeURIComponent(tool.id)}?month=${month}`);
      draft.tools.splice(i, 1);
      initial = snapshot(savedTools());
      toast(`Đã ngừng tính ${name} từ tháng ${monthLabel(nowMonth)}.`);
      draw();
    } catch (err) { toast(err.message, 'error'); }
  };

  const saveCell = async (amount) => {
    const { toolId, month: m } = editing;
    try {
      applyData(await put('/api/team-costs/actuals', { toolId, month: m, amount, viewMonth: month }));
      editing = null;
      toast(amount == null ? `Đã xóa số thực tế tháng ${monthLabel(m)}.` : `Đã lưu số thực tế tháng ${monthLabel(m)}.`);
      draw();
      root.querySelector(`[data-cell="${CSS.escape(`${toolId}|${m}`)}"]`)?.focus();
    } catch (err) { toast(err.message, 'error'); }
  };

  const bindMonthly = () => {
    root.querySelectorAll('[data-cell]').forEach((b) => b.addEventListener('click', () => {
      const [toolId, m] = b.dataset.cell.split('|');
      editing = { toolId, month: m };
      draw();
      root.querySelector('[data-cell-input]')?.focus();
    }));
    const input = root.querySelector('[data-cell-input]');
    if (!input) return;
    const currency = data.monthly.rows.find((r) => r.id === editing.toolId)?.cells.find((c) => c.month === editing.month)?.currency;
    const cancel = () => {
      const key = `${editing.toolId}|${editing.month}`;
      editing = null;
      draw();
      root.querySelector(`[data-cell="${CSS.escape(key)}"]`)?.focus();
    };
    const submit = () => {
      if (input.value.trim() === '') { toast('Nhập số thực tế, hoặc dùng "Xóa số thực tế" để quay về số dự kiến.', 'error'); return; }
      const v = parseMoney(input.value, currency);
      if (!(Number.isFinite(v) && v >= 0)) { toast('Số thực tế phải ≥ 0.', 'error'); return; }
      saveCell(v);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    root.querySelector('[data-cell-save]').addEventListener('click', submit);
    root.querySelector('[data-cell-clear]')?.addEventListener('click', () => saveCell(null));
  };

  const bindConfig = () => {
    root.querySelector('[data-f="reason"]').addEventListener('input', (e) => { draft.reason = e.target.value; refresh(); });
    root.querySelectorAll('[data-row]').forEach((rowEl) => {
      const i = Number(rowEl.dataset.row);
      const tool = draft.tools[i];
      rowEl.querySelectorAll('[data-t]').forEach((el) => {
        const f = el.dataset.t;
        if (el.tagName === 'SELECT') {
          el.addEventListener('change', () => {
            tool[f] = el.value;
            draw();
            root.querySelector(`[data-row="${i}"] [data-t="${f}"]`)?.focus();
          });
          return;
        }
        el.addEventListener('input', () => {
          if (f === 'amount') {
            tool.amount = parseMoney(el.value, tool.currency);
            rowEl.querySelector('[data-vnd]').textContent = tool.currency === 'USD' && Number.isFinite(tool.amount)
              ? `≈ ${formatVnd(toVnd(tool.amount, 'USD'))}` : '';
          } else tool[f] = el.value;
          refresh();
        });
        if (f === 'amount') el.addEventListener('blur', () => { if (Number.isFinite(tool.amount)) el.value = inputMoney(tool.amount, tool.currency); });
      });
      createToolScopePicker(rowEl.querySelector('[data-scope]'), { options: data.scopeOptions, value: tool.appliesTo,
        onChange: (ids) => { tool.appliesTo = ids; refresh(); } });
    });
    root.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => removeTool(Number(b.dataset.remove))));
    root.querySelector('[data-add]').addEventListener('click', () => {
      draft.tools.push({ id: null, name: '', kind: 'monthly', currency: 'VND', amount: 0, appliesTo: [] });
      draw();
      root.querySelector(`[data-row="${draft.tools.length - 1}"] [data-t="name"]`)?.focus();
    });
    root.querySelector('[data-reset]').addEventListener('click', () => { resetDraft(); draw(); });
    root.querySelector('[data-save]').addEventListener('click', async () => {
      try {
        const tools = draft.tools.map(({ id, name, kind, currency, amount, appliesTo }) => ({ id, name, kind, currency, amount, appliesTo }));
        data = await put('/api/team-costs', { tools, reason: draft.reason, month });
        toast('Đã lưu Chi phí Tools/AI.');
        resetDraft();
        draw();
      } catch (err) { toast(err.message, 'error'); }
    });
  };

  const bind = () => {
    root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      tab = b.dataset.tab;
      editing = null;
      history.replaceState(null, '', url());
      draw();
      root.querySelector(`[data-tab="${tab}"]`)?.focus();
    }));
    root.querySelector('[data-goto-monthly]')?.addEventListener('click', () => {
      tab = 'monthly';
      editing = null;
      history.replaceState(null, '', url());
      draw();
      const first = root.querySelector('.tm-cell.missing');
      first?.scrollIntoView({ block: 'center' });
      first?.focus();
    });
    if (tab === 'config') bindConfig(); else bindMonthly();
    root.querySelector('[data-month]').addEventListener('change', (e) => { month = e.target.value; reload(); });
    root.querySelectorAll('[data-unit]').forEach((b) => b.addEventListener('click', () => {
      unit = b.dataset.unit;
      history.replaceState(null, '', url());
      draw();
    }));
    root.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
      const key = b.dataset.sort;
      sort = sort.key === key ? { key, dir: -sort.dir } : { key, dir: 1 };
      draw();
      root.querySelector(`[data-sort="${key}"]`)?.focus();
    }));
    root.querySelectorAll('[data-expand]').forEach((b) => b.addEventListener('click', () => {
      const id = Number(b.dataset.expand);
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      draw();
      root.querySelector(`[data-expand="${id}"]`)?.focus();
    }));
  };

  draw();
}
