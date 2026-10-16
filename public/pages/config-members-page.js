// Cấu hình → Nhân sự: team roster with monthly cost and total allocated effort (red when > 100%).

import { del, get, post, put } from '../api.js';
import { confirmDialog, esc, monthOptions, parseVnd, toast } from '../ui.js';
import { formatDate, formatNumber, formatPct, formatVnd } from '/shared/format.js';

export async function render(root, ctx) {
  let data = await get('/api/members');
  if (!ctx.isCurrent()) return;
  let editing = null; // member id being edited, or 'new'
  ctx.setGuard(() => editing != null);

  const draw = () => {
    const total = data.members.reduce((s, m) => s + m.monthlyCost, 0);
    const overs = data.members.filter((m) => m.totalEffort > 100);
    root.innerHTML = `
      ${ctx.pageHeader({ title: 'Nhân sự', crumb: 'Cấu hình', extra: '<button class="btn primary" id="add">＋ Thêm nhân sự</button>' })}
      ${overs.length ? `<div class="alert error" style="margin-bottom:16px"><div><b>Phân bổ vượt 100%:</b><ul>${overs.map((m) =>
        `<li>${esc(m.name)}: ${formatPct(m.totalEffort, 0)} — vượt ${formatPct(m.totalEffort - 100, 0)}</li>`).join('')}</ul></div></div>` : ''}
      <section class="card">
        <div class="card-head"><div><h2>Team AWP</h2><div class="sub">${data.members.length} người · Tổng chi phí nhân sự ${formatVnd(total)}/tháng</div></div></div>
        <form id="member-form"><div class="table-wrap"><table>
          <thead><tr><th>Họ tên</th><th>Vai trò</th><th>Quyền Admin</th><th class="r">Chi phí nhân sự/tháng</th><th>Tổng effort đã phân bổ</th><th>Sản phẩm / dự án</th><th></th></tr></thead>
          <tbody>
            ${data.members.map((m) => (editing === m.id ? editRow(m) : viewRow(m))).join('')}
            ${editing === 'new' ? editRow({ id: 'new', name: '', role: '', monthlyCost: '' }) : ''}
          </tbody>
          <tfoot><tr><td colspan="3">Tổng</td><td class="r">${formatVnd(total)}</td><td colspan="3"></td></tr></tfoot>
        </table></div></form>
        <p class="small muted" style="margin:10px 0 0">Effort hiện tại theo cấu hình đang áp dụng hôm nay. Gán effort ở tab "Nhân sự & chi phí" của từng sản phẩm, hoặc "Nhân sự chung" của dự án (<a href="#/config/projects">Quản lý dự án & sản phẩm</a>). Tổng effort của một người trên mọi dự án không được vượt 100%. Thay đổi chi phí nhân sự áp dụng từ tháng được chọn; các tháng đã chốt sổ (trước ${formatDate(data.firstOpenDate)}) giữ nguyên.</p>
      </section>`;
    ctx.bindPageHeader(root);
    bind();
  };

  const viewRow = (m) => {
    const over = m.totalEffort > 100;
    const status = over ? 'red' : 'green';
    return `<tr>
      <td><b>${esc(m.name)}</b></td><td>${esc(m.role)}</td><td>${m.isAdmin ? '<span class="chip">✓ Admin</span>' : '<span class="muted">—</span>'}</td><td class="r">${formatVnd(m.monthlyCost)}</td>
      <td><div class="effort-bar"><div class="progress"><span class="${status}" style="width:${Math.min(100, m.totalEffort)}%"></span></div>
        <span class="${over ? 'over' : ''}">${formatPct(m.totalEffort, 0)}${over ? ` · vượt ${formatPct(m.totalEffort - 100, 0)}` : ''}</span></div></td>
      <td class="small">${m.projects.map((p) => `${esc(p.name)} ${formatPct(p.effortPct, 0)}`).join(' · ') || '<span class="muted">Chưa phân bổ</span>'}</td>
      <td class="r"><button type="button" class="btn sm" data-edit="${m.id}">Sửa</button>
        <button type="button" class="btn sm danger" data-del="${m.id}">Xóa</button></td></tr>`;
  };

  const editRow = (m) => `<tr>
    <td><input class="input" name="name" value="${esc(m.name)}" placeholder="Họ tên" required></td>
    <td><input class="input" name="role" value="${esc(m.role)}" placeholder="Vai trò" required></td>
    <td><label class="check-chip"><input type="checkbox" name="isAdmin" ${m.isAdmin ? 'checked' : ''}>Admin</label></td>
    <td><div class="input-suffix" data-suffix="₫"><input class="input right" name="monthlyCost" inputmode="numeric"
      value="${m.monthlyCost === '' ? '' : formatNumber(m.monthlyCost)}" placeholder="0" required></div></td>
    <td colspan="2"><label class="field"><span>${m.id === 'new' ? 'Vào team từ tháng' : 'Chi phí mới áp dụng từ tháng'}</span>
      <select class="input" name="effectiveDate">${monthOptions(data.firstOpenDate, data.firstOpenDate)}</select></label></td>
    <td class="r"><button type="submit" class="btn sm primary">Lưu</button> <button type="button" class="btn sm" data-cancel>Hủy</button></td></tr>`;

  const bind = () => {
    root.querySelector('#add').addEventListener('click', () => { editing = 'new'; draw(); root.querySelector('[name="name"]').focus(); });
    root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => { editing = Number(b.dataset.edit); draw(); }));
    root.querySelector('[data-cancel]')?.addEventListener('click', () => { editing = null; draw(); });
    root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const m = data.members.find((x) => x.id === Number(b.dataset.del));
      const ok = await confirmDialog({ title: `Xóa ${m.name} khỏi team?`, danger: true, confirmLabel: 'Xóa nhân sự',
        body: `<p>Từ ${formatDate(data.firstOpenDate)}, ${esc(m.name)} rời mọi sản phẩm / dự án và không còn tính vào lương team. Chi phí các tháng đã chốt sổ giữ nguyên.</p>` });
      if (!ok) return;
      try { data = await del(`/api/members/${m.id}`); toast(`Đã xóa ${m.name}.`); draw(); } catch (err) { toast(err.message, 'error'); }
    }));
    root.querySelector('#member-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = { name: fd.get('name'), role: fd.get('role'), monthlyCost: parseVnd(fd.get('monthlyCost')), effectiveDate: fd.get('effectiveDate'),
        isAdmin: fd.get('isAdmin') === 'on' };
      try {
        data = editing === 'new' ? await post('/api/members', body) : await put(`/api/members/${editing}`, body);
        toast('Đã lưu nhân sự.');
        editing = null;
        draw();
      } catch (err) { toast(err.message, 'error'); }
    });
  };

  draw();
}
