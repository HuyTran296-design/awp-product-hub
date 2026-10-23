// Cấu hình → Chi phí team: Thiết lập chung (lương nhân sự, chỉ xem + Chi phí Tools/AI with tabs "Cấu hình" | "Theo tháng")
// and "Phân bổ chi phí" of a calendar month per project, monthly or daily (÷ working days).
// Cấu hình: kind, amount + currency, Áp dụng cho, Từ/Đến tháng; "Đổi giá từ tháng…" for Hằng tháng / Theo mức dùng.
// Theo tháng: planned (grey italic) or actual per tool and month; click a cell to enter the invoice amount.

import { get, post, put } from '../api.js';
import { shareBar } from '../charts.js';
import { esc, lifecycleBadge, monthOptions, openModal, parseDecimal, parseVnd, sampleTag, toast } from '../ui.js';
import { createToolScopePicker } from '../components/tool-scope-picker.js';
import { addMonths } from '/shared/closing.js';
import { formatDate, formatDateTime, formatNumber, formatPct, formatVnd } from '/shared/format.js';
import { USD_VND_RATE } from '/shared/system-config.js';
import { formatMoney, hasPriceVersions, monthLabel, priceAt, TOOL_KINDS, toolsForMonth, toVnd } from '/shared/tool-costs.js';

const SORT_COLS = [['salary', 'Lương'], ['tools', 'Tools/AI'], ['total', 'Tổng chi phí'], ['teamPct', '% chi phí team'], ['revenue', 'Doanh thu'], ['profit', 'Lãi/Lỗ']];
const AMOUNT_LABEL = { monthly: 'Số tiền/tháng', usage: 'Ước tính/tháng', annual: 'Số tiền/năm', one_time: 'Số tiền' };
const parseMoney = (text, currency) => (currency === 'USD' ? parseDecimal(text) : parseVnd(text));
const inputMoney = (v, currency) => (Number.isFinite(v) ? formatNumber(v, currency === 'USD' && !Number.isInteger(v) ? 2 : 0) : '');

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
  const FIELDS = ['id', 'name', 'kind', 'currency', 'amount', 'startMonth', 'endMonth', 'spreadMonths', 'appliesTo'];
  const comparable = () => JSON.stringify(draft.tools.map((t) => FIELDS.map((f) => t[f])));
  const resetDraft = () => {
    draft = { tools: data.settings.tools.map((t) => ({ ...t, appliesTo: [...t.appliesTo], saved: { kind: t.kind, currency: t.currency } })), reason: '' };
    initial = comparable();
  };
  const isDirty = () => comparable() !== initial;
  resetDraft();
  ctx.setGuard(() => isDirty());
  const nowMonth = data.today.slice(0, 7);

  /** A saved Hằng tháng / Theo mức dùng tool keeps its price: it changes with "Đổi giá từ tháng…". */
  const priceLocked = (t) => Boolean(t.saved) && hasPriceVersions(t.saved.kind) && hasPriceVersions(t.kind) && t.saved.currency === t.currency;
  const draftTools = () => draft.tools.map((t, i) => ({ ...t, id: t.id ?? `new${i}`, amount: Number.isFinite(t.amount) ? t.amount : 0,
    prices: priceLocked(t) ? t.prices : [], spreadMonths: Number(t.spreadMonths) || 1 }));
  const toolsThisMonth = () => toolsForMonth(draftTools(), data.actuals, nowMonth).reduce((s, x) => s + x.monthlyCost, 0);

  const errors = () => {
    const e = [];
    draft.tools.forEach((t, i) => {
      const label = t.name.trim() || `Tool dòng ${i + 1}`;
      if (!t.name.trim()) e.push(`Tool dòng ${i + 1}: vui lòng nhập tên.`);
      if (!(Number.isFinite(t.amount) && t.amount >= 0)) e.push(`${label}: số tiền phải ≥ 0.`);
      if ((t.kind === 'annual' || t.kind === 'one_time') && !t.startMonth) e.push(`${label}: vui lòng chọn ${t.kind === 'annual' ? 'tháng bắt đầu' : 'tháng phát sinh'}.`);
      if (t.kind !== 'one_time' && t.startMonth && t.endMonth && t.endMonth < t.startMonth) e.push(`${label}: "Đến tháng" phải từ "Từ tháng" trở đi.`);
      if (t.kind === 'one_time' && !(Number.isInteger(Number(t.spreadMonths)) && t.spreadMonths >= 1 && t.spreadMonths <= 60)) e.push(`${label}: "Chia đều trong" phải từ 1 đến 60 tháng.`);
    });
    return e;
  };

  /** Month picker over 3 years back / 2 years ahead; `empty` = label of the empty choice (none = required). */
  const monthSelect = (attr, value, { empty = null, label }) => {
    const opts = [];
    for (let m = addMonths(nowMonth, -36); m <= addMonths(nowMonth, 24); m = addMonths(m, 1)) opts.push(m);
    if (value && !opts.includes(value)) opts.push(value);
    opts.sort();
    return `<select class="input" data-t="${attr}" aria-label="${esc(label)}">${empty != null ? `<option value="" ${value ? '' : 'selected'}>${esc(empty)}</option>` : (value ? '' : '<option value="" selected>Chọn tháng</option>')}
      ${opts.map((m) => `<option value="${m}" ${m === value ? 'selected' : ''}>Tháng ${monthLabel(m)}</option>`).join('')}</select>`;
  };

  const monthFields = (t) => {
    if (t.kind === 'one_time') {
      return `<label class="field"><span>Tháng phát sinh</span>${monthSelect('startMonth', t.startMonth, { label: 'Tháng phát sinh' })}</label>
        <label class="field tool-spread"><span>Chia đều trong</span><div class="input-suffix" data-suffix="tháng">
          <input class="input right" data-t="spreadMonths" inputmode="numeric" value="${esc(t.spreadMonths ?? 1)}"></div></label>`;
    }
    const start = t.kind === 'annual'
      ? `<label class="field"><span>Tháng bắt đầu</span>${monthSelect('startMonth', t.startMonth, { label: 'Tháng bắt đầu' })}</label>`
      : `<label class="field"><span>Từ tháng</span>${monthSelect('startMonth', t.startMonth, { empty: 'Từ đầu', label: 'Từ tháng' })}</label>`;
    return `${start}<label class="field"><span>Đến tháng</span>${monthSelect('endMonth', t.endMonth, { empty: 'Đang dùng', label: 'Đến tháng' })}</label>`;
  };

  const priceHistory = (t) => (t.prices?.length ? `<details class="tool-prices"><summary class="small">Lịch sử giá (${t.prices.length + 1})</summary>
      <div class="note">${[`${t.startMonth ? `Từ tháng ${monthLabel(t.startMonth)}` : 'Ban đầu'}: ${esc(formatMoney(t.amount, t.currency))}`,
        ...t.prices.map((p) => `Từ tháng ${monthLabel(p.fromMonth)}: ${esc(formatMoney(p.amount, t.currency))}`)].join('<br>')}</div></details>` : '');

  const toolRow = (t, i) => {
    const locked = priceLocked(t);
    const amount = locked ? priceAt(t, nowMonth) : t.amount;
    const vnd = t.currency === 'USD' && Number.isFinite(amount)
      ? `<div class="note" data-vnd>≈ ${formatVnd(toVnd(amount, 'USD'))} (${formatNumber(USD_VND_RATE)} ₫/USD)</div>` : '<div class="note" data-vnd></div>';
    const removable = !t.saved || t.canDelete;
    return `<div class="tool-row" data-row="${i}">
      <label class="field tool-name"><span>Tên</span><input class="input" data-t="name" maxlength="80" value="${esc(t.name)}" placeholder="Ví dụ: Claude"></label>
      <label class="field tool-kind"><span>Kiểu chi phí</span><select class="input" data-t="kind">${Object.entries(TOOL_KINDS).map(([k, l]) =>
        `<option value="${k}" ${k === t.kind ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <div class="field tool-cost"><span>${AMOUNT_LABEL[t.kind]}</span>
        <div class="money-input"><input class="input right" data-t="amount" inputmode="decimal" value="${inputMoney(amount, t.currency)}" ${locked ? 'disabled' : ''}
          aria-label="${AMOUNT_LABEL[t.kind]} ${esc(t.name)}">
          <select class="input" data-t="currency" aria-label="Tiền tệ">${['VND', 'USD'].map((c) => `<option ${c === t.currency ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
        ${vnd}${locked ? `<button type="button" class="link-btn small" data-price="${i}">Đổi giá từ tháng…</button>${priceHistory(t)}` : ''}</div>
      <div class="tool-months">${monthFields(t)}</div>
      <div class="field tool-scope-field"><span>Áp dụng cho</span><div data-scope="${i}"></div></div>
      ${removable ? `<button type="button" class="icon-btn tool-remove" data-remove="${i}" aria-label="Xóa ${esc(t.name || 'tool')}" title="Xóa">✕</button>`
        : '<span class="tool-remove" title="Đã có chi phí trong tháng đã chốt: nhập &quot;Đến tháng&quot; để ngừng dùng"></span>'}
    </div>`;
  };

  const configTab = () => `
    <div class="tool-list">${draft.tools.map(toolRow).join('') || '<p class="muted small">Chưa có tool nào.</p>'}</div>
    <div class="tool-foot"><button type="button" class="btn" data-add>+ Thêm tool</button>
      <span>Tools/AI tháng ${monthLabel(nowMonth)}: <b data-tools-sum>${formatVnd(toolsThisMonth())}</b></span></div>
    <p class="note">USD quy đổi theo tỷ giá hệ thống ${formatNumber(USD_VND_RATE)} ₫/USD. Ngừng dùng tool: nhập "Đến tháng" (giữ chi phí các tháng cũ).</p>
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
          value="${c.actualAmount != null ? inputMoney(c.actualAmount, r.currency) : ''}" placeholder="${esc(inputMoney(c.actual ?? (r.currency === 'USD' ? c.planned / USD_VND_RATE : c.planned), r.currency))}"
          aria-label="Số thực tế ${esc(r.name)} tháng ${monthLabel(c.month)} (${r.currency})"><span class="tm-cur">${r.currency}</span></div>
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
        <tbody>${mt.rows.map((r) => `<tr><td>${esc(r.name)}<div class="note">${TOOL_KINDS[r.kind]}${r.currency === 'USD' ? ' · USD' : ''}</div></td>
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
  /** Server data changed (price, actual): keep unsaved Cấu hình edits only when there are none. */
  const applyData = (next) => {
    const dirty = isDirty();
    data = next;
    if (!dirty) resetDraft();
  };

  const openPriceDialog = (t) => {
    if (isDirty()) { toast('Lưu hoặc hoàn tác thay đổi Tools/AI trước khi đổi giá.', 'error'); return; }
    openModal(`Đổi giá ${t.name}`, `
      <p class="note">Giá mới áp dụng từ tháng được chọn; các tháng trước giữ giá cũ (${esc(formatMoney(priceAt(t, nowMonth), t.currency))}/tháng hiện tại).</p>
      <label class="field"><span>Từ tháng</span><select class="input" name="fromMonth">${monthOptions(data.firstOpenDate, data.firstOpenDate)}</select></label>
      <label class="field"><span>Giá mới/tháng</span><div class="input-suffix" data-suffix="${t.currency === 'USD' ? 'USD' : '₫'}">
        <input class="input right" name="amount" inputmode="decimal" required></div></label>
      <label class="field"><span>Ghi chú <span class="muted">(không bắt buộc)</span></span><input class="input" name="reason" maxlength="200"></label>`, {
      submitLabel: 'Đổi giá',
      onSubmit: async (fd) => {
        const amount = parseMoney(fd.get('amount'), t.currency);
        if (!(Number.isFinite(amount) && amount >= 0)) throw new Error('Giá mới phải ≥ 0.');
        const fromMonth = String(fd.get('fromMonth')).slice(0, 7);
        applyData(await post(`/api/team-costs/tools/${encodeURIComponent(t.id)}/prices`, { fromMonth, amount, reason: fd.get('reason'), month }));
        toast(`Đã đổi giá ${t.name} từ tháng ${monthLabel(fromMonth)}.`);
        draw();
      },
    });
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
    const currency = data.monthly.rows.find((r) => r.id === editing.toolId)?.currency;
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
            tool[f] = el.value || null;
            if (f === 'kind' && tool.kind === 'one_time') tool.spreadMonths ??= 1;
            draw();
            root.querySelector(`[data-row="${i}"] [data-t="${f}"]`)?.focus();
          });
          return;
        }
        el.addEventListener('input', () => {
          if (f === 'amount') {
            tool.amount = parseMoney(el.value, tool.currency);
            rowEl.querySelector('[data-vnd]').textContent = tool.currency === 'USD' && Number.isFinite(tool.amount)
              ? `≈ ${formatVnd(toVnd(tool.amount, 'USD'))} (${formatNumber(USD_VND_RATE)} ₫/USD)` : '';
          } else if (f === 'spreadMonths') tool.spreadMonths = el.value.trim() === '' ? NaN : Number(el.value.replace(/\D/g, ''));
          else tool[f] = el.value;
          refresh();
        });
        if (f === 'amount') el.addEventListener('blur', () => { if (Number.isFinite(tool.amount)) el.value = inputMoney(tool.amount, tool.currency); });
      });
      createToolScopePicker(rowEl.querySelector('[data-scope]'), { options: data.scopeOptions, value: tool.appliesTo,
        onChange: (ids) => { tool.appliesTo = ids; refresh(); } });
    });
    root.querySelectorAll('[data-price]').forEach((b) => b.addEventListener('click', () => openPriceDialog(draft.tools[Number(b.dataset.price)])));
    root.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
      draft.tools.splice(Number(b.dataset.remove), 1);
      draw();
    }));
    root.querySelector('[data-add]').addEventListener('click', () => {
      draft.tools.push({ id: null, name: '', kind: 'monthly', currency: 'VND', amount: 0, prices: [], startMonth: null, endMonth: null,
        spreadMonths: null, appliesTo: [] });
      draw();
      root.querySelector(`[data-row="${draft.tools.length - 1}"] [data-t="name"]`)?.focus();
    });
    root.querySelector('[data-reset]').addEventListener('click', () => { resetDraft(); draw(); });
    root.querySelector('[data-save]').addEventListener('click', async () => {
      try {
        const tools = draftTools().map((t, i) => ({ ...t, id: draft.tools[i].id }));
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
