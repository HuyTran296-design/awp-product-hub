// Cấu hình → Chi phí team: Thiết lập chung (lương nhân sự, chỉ xem + Chi phí Tools/AI, effective from a chosen month)
// and "Phân bổ chi phí" of a month per project, monthly or daily (÷ working days). Closed months are read-only.

import { get, put } from '../api.js';
import { shareBar } from '../charts.js';
import { esc, lifecycleBadge, monthOptions, parseVnd, sampleTag, toast } from '../ui.js';
import { createToolScopePicker } from '../components/tool-scope-picker.js';
import { formatDate, formatDateTime, formatNumber, formatPct, formatVnd } from '/shared/format.js';

export async function render(root, ctx) {
  let month = ctx.query.month;
  let unit = ctx.query.unit === 'day' ? 'day' : 'month';
  let data = await get(`/api/team-costs${month ? `?month=${month}` : ''}`);
  if (!ctx.isCurrent()) return;
  month = data.month;
  let draft;
  let initial;
  const expanded = new Set();
  const comparable = () => JSON.stringify(draft.tools.map(({ name, monthlyCost, appliesTo }) => ({ name, monthlyCost, appliesTo })));
  const resetDraft = () => {
    draft = { effectiveDate: data.firstOpenDate, tools: data.settings.tools.map((t) => ({ ...t, appliesTo: [...t.appliesTo] })), reason: '' };
    initial = comparable();
  };
  const isDirty = () => comparable() !== initial;
  resetDraft();
  ctx.setGuard(() => isDirty());

  const errors = () => {
    const e = [];
    draft.tools.forEach((t, i) => {
      if (!t.name.trim()) e.push(`Tool dòng ${i + 1}: vui lòng nhập tên.`);
      if (!(Number.isFinite(t.monthlyCost) && t.monthlyCost >= 0)) e.push(`${t.name.trim() || `Tool dòng ${i + 1}`}: chi phí/tháng phải ≥ 0.`);
    });
    return e;
  };
  const toolsSum = () => draft.tools.reduce((s, t) => s + (Number.isFinite(t.monthlyCost) ? t.monthlyCost : 0), 0);

  const toolRow = (t, i) => `<div class="tool-row" data-row="${i}">
      <label class="field tool-name"><span>Tên</span><input class="input" data-t="name" maxlength="80" value="${esc(t.name)}" placeholder="Ví dụ: Claude"></label>
      <label class="field tool-cost"><span>Chi phí/tháng</span>
        <div class="input-suffix" data-suffix="₫"><input class="input right" data-t="monthlyCost" inputmode="numeric" value="${Number.isFinite(t.monthlyCost) ? formatNumber(t.monthlyCost) : ''}"></div></label>
      <div class="field tool-scope-field"><span>Áp dụng cho</span><div data-scope="${i}"></div></div>
      <button type="button" class="icon-btn tool-remove" data-remove="${i}" aria-label="Xóa ${esc(t.name || 'tool')}" title="Xóa">✕</button>
    </div>`;

  const draw = () => {
    const t = data.table;
    const div = unit === 'day' ? t.workingDays : 1;
    const money = (v) => formatVnd(v / div);
    const per = unit === 'day' ? '/ngày' : '/tháng';
    const payroll = data.payroll;
    root.innerHTML = `
      ${ctx.pageHeader({ title: 'Chi phí team', crumb: 'Cấu hình' })}
      <div class="stack">
      <section class="card">
        <div class="card-head"><div><h2>Thiết lập chung</h2><div class="sub">Áp dụng từ tháng được chọn; các tháng trước giữ nguyên số liệu</div></div></div>
        <label class="field effective-month"><span>Hiệu lực từ tháng</span><select class="input" data-f="effectiveDate">${monthOptions(data.firstOpenDate, draft.effectiveDate)}</select></label>

        <h3 class="setting-title">Chi phí lương nhân sự</h3>
        <div class="fin-row"><span class="label">Lương nhân sự: <b class="value">${formatVnd(payroll.total)}</b>/tháng · ${payroll.count} người</span>
          <a href="#/config/members">Quản lý nhân sự</a></div>

        <h3 class="setting-title">Chi phí Tools/AI</h3>
        <div class="tool-list">${draft.tools.map(toolRow).join('') || '<p class="muted small">Chưa có tool nào.</p>'}</div>
        <div class="tool-foot"><button type="button" class="btn" data-add>+ Thêm tool</button>
          <span>Tổng Tools/AI: <b data-tools-sum>${formatVnd(toolsSum())}</b>/tháng</span></div>

        <div class="team-total"><span>Tổng chi phí team/tháng = Lương nhân sự + Tools/AI</span><b data-team-sum>${formatVnd(payroll.total + toolsSum())}</b></div>

        <label class="field" style="margin-top:12px"><span>Ghi chú thay đổi <span class="muted">(không bắt buộc)</span></span><input class="input" data-f="reason" maxlength="200" value="${esc(draft.reason)}"></label>
        <div data-feedback style="margin-top:12px"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;align-items:center;flex-wrap:wrap">
          <span class="note" data-dirty></span><button class="btn" data-reset>Hoàn tác</button><button class="btn primary" data-save>Lưu thiết lập</button></div>
        <details style="margin-top:12px"><summary class="small">Các phiên bản thiết lập (${data.settingsVersions.length})</summary>
          <div class="versions" style="margin-top:8px">${data.settingsVersions.map((v) => `<div class="version"><b>Hiệu lực từ ${v.effectiveDate <= '2000-01-01' ? 'ban đầu' : formatDate(v.effectiveDate)}</b>
            · Tools/AI ${formatVnd(v.tools.reduce((s, x) => s + x.monthlyCost, 0))}/tháng (${v.tools.map((x) => esc(x.name)).join(', ') || 'không có tool'})
            <div class="note">${esc(v.createdBy)} · ${formatDateTime(v.createdAt)}</div></div>`).join('')}</div></details>
      </section>

      <section class="card">
        <div class="card-head"><div><h2>Phân bổ chi phí</h2>
          <div class="sub">${unit === 'day' ? `Theo ngày = số tháng ÷ ${t.workingDays}` : 'Theo tháng'} · trung bình theo ngày trong tháng${data.closed ? ' · <span class="pill-closed">đã chốt sổ</span>' : ''}</div></div>
          <div class="alloc-controls">${sampleTag()}
            <div class="seg" role="group" aria-label="Đơn vị">
              <button type="button" data-unit="month" aria-pressed="${unit === 'month'}">Theo tháng</button>
              <button type="button" data-unit="day" aria-pressed="${unit === 'day'}">Theo ngày</button></div>
            <select class="input" data-month style="width:auto" aria-label="Tháng">${data.months.map((m) =>
              `<option value="${m}" ${m === data.month ? 'selected' : ''}>Tháng ${Number(m.slice(5))}/${m.slice(0, 4)}</option>`).join('')}</select></div></div>
        ${shareBar(data.costShare)}
        <div class="table-wrap" style="margin-top:16px"><table class="alloc-table">
          <thead><tr><th>Dự án</th><th class="r">Lương</th><th class="r">Tools/AI</th><th class="r">Tổng${per}</th><th class="r">% chi phí team</th></tr></thead>
          <tbody>${t.rows.map((r) => projectRows(r, money)).join('')}
            <tr class="alloc-unallocated"><td>Lương chưa phân bổ<div class="note">Năng lực nhân sự chưa giao việc</div></td>
              <td class="r">${money(t.unallocatedSalary)}</td><td class="r muted">—</td><td class="r"><b>${money(t.unallocatedSalary)}</b></td><td class="r">${formatPct(t.unallocatedSalaryPct)}</td></tr>
            ${t.unallocatedTools > 0.5 ? `<tr class="alloc-unallocated"><td>Tools/AI chưa phân bổ<div class="note">Không có dự án đang chạy trong nhóm "Áp dụng cho"</div></td>
              <td class="r muted">—</td><td class="r">${money(t.unallocatedTools)}</td><td class="r"><b>${money(t.unallocatedTools)}</b></td><td class="r">${formatPct(t.unallocatedToolsPct)}</td></tr>` : ''}
          </tbody>
          <tfoot><tr><td>Tổng chi phí team</td><td class="r">${money(t.payrollTotal)}</td><td class="r">${money(t.toolsTotal)}</td>
            <td class="r">${money(t.teamTotal)}</td><td class="r">100,0%</td></tr></tfoot>
        </table></div>
      </section>
      </div>`;
    ctx.bindPageHeader(root);
    bind();
    refresh();
  };

  const projectRows = (r, money) => {
    const cells = `<td class="r">${money(r.salary)}</td><td class="r">${money(r.tools)}</td><td class="r"><b>${money(r.total)}</b></td><td class="r">${formatPct(r.teamPct)}</td>`;
    if (r.deleted) return `<tr><td class="muted">Dự án đã xóa</td>${cells}</tr>`;
    const open = expanded.has(r.id);
    const badge = r.status && r.status !== 'active' ? ` ${lifecycleBadge(r.status, r.statusLabel)}` : '';
    const detail = open ? `<tr class="alloc-detail"><td colspan="5"><div class="alloc-detail-grid">
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
    root.querySelector('[data-dirty]').textContent = isDirty() ? `Có thay đổi chưa lưu · áp dụng từ ${formatDate(draft.effectiveDate)}` : '';
    root.querySelector('[data-tools-sum]').textContent = formatVnd(toolsSum());
    root.querySelector('[data-team-sum]').textContent = formatVnd(data.payroll.total + toolsSum());
  };

  const reload = async () => {
    const keep = { draft, initial };
    data = await get(`/api/team-costs?month=${month}`);
    ({ draft, initial } = keep);
    history.replaceState(null, '', `#/config/team-costs?month=${month}${unit === 'day' ? '&unit=day' : ''}`);
    draw();
  };

  const bind = () => {
    root.querySelectorAll('[data-f]').forEach((i) => i.addEventListener(i.tagName === 'SELECT' ? 'change' : 'input', () => {
      draft[i.dataset.f] = i.value;
      refresh();
    }));
    root.querySelectorAll('[data-row]').forEach((rowEl) => {
      const tool = draft.tools[Number(rowEl.dataset.row)];
      rowEl.querySelectorAll('[data-t]').forEach((i) => {
        const f = i.dataset.t;
        i.addEventListener('input', () => { tool[f] = f === 'monthlyCost' ? parseVnd(i.value) : i.value; refresh(); });
        if (f === 'monthlyCost') i.addEventListener('blur', () => { if (Number.isFinite(tool.monthlyCost)) i.value = formatNumber(tool.monthlyCost); });
      });
      createToolScopePicker(rowEl.querySelector('[data-scope]'), { options: data.scopeOptions, value: tool.appliesTo,
        onChange: (ids) => { tool.appliesTo = ids; refresh(); } });
    });
    root.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
      draft.tools.splice(Number(b.dataset.remove), 1);
      draw();
    }));
    root.querySelector('[data-add]').addEventListener('click', () => {
      draft.tools.push({ id: null, name: '', monthlyCost: 0, appliesTo: [] });
      draw();
      root.querySelector(`[data-row="${draft.tools.length - 1}"] [data-t="name"]`)?.focus();
    });
    root.querySelector('[data-reset]').addEventListener('click', () => { resetDraft(); draw(); });
    root.querySelector('[data-save]').addEventListener('click', async () => {
      try {
        data = await put('/api/team-costs', draft);
        toast(`Đã lưu thiết lập, hiệu lực từ ${formatDate(draft.effectiveDate)}.`);
        month = data.month;
        resetDraft();
        draw();
      } catch (err) { toast(err.message, 'error'); }
    });
    root.querySelector('[data-month]').addEventListener('change', (e) => { month = e.target.value; reload(); });
    root.querySelectorAll('[data-unit]').forEach((b) => b.addEventListener('click', () => {
      unit = b.dataset.unit;
      history.replaceState(null, '', `#/config/team-costs?month=${data.month}${unit === 'day' ? '&unit=day' : ''}`);
      draw();
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
