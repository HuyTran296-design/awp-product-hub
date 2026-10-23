// Cấu hình → Người dùng & phân quyền (Admin only). Login accounts, separate from cost "Nhân sự".
// Safety rules come from the server as per-action lock reasons (last active Admin, own account).

import { del, get, post, put } from '../api.js';
import { confirmDialog, esc, openModal, toast } from '../ui.js';
import { formatDateTime } from '/shared/format.js';

const ROLE = { admin: 'Admin', viewer: 'Viewer' };
const STATUS = { active: ['green', '● Đang hoạt động'], invited: ['yellow', '✉ Đã mời – chờ kích hoạt'], locked: ['red', '■ Đã khóa'] };
const view = { q: '', role: '', status: '' };

export async function render(root, ctx) {
  let [data, logData] = await Promise.all([get('/api/users'), get('/api/users/log')]);
  if (!ctx.isCurrent()) return;
  let openMenu = null;
  const reload = async () => { [data, logData] = await Promise.all([get('/api/users'), get('/api/users/log')]); draw(); };

  const draw = () => {
    const q = view.q.trim().toLowerCase();
    const rows = data.users.filter((u) => (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      && (!view.role || u.role === view.role) && (!view.status || u.status === view.status));
    root.innerHTML = `
      ${ctx.pageHeader({ title: 'Người dùng & phân quyền', crumb: 'Cấu hình', extra: '<button class="btn primary" data-add>＋ Thêm người dùng</button>' })}
      <p class="note" style="margin-top:-6px">Người dùng là tài khoản đăng nhập — tách biệt với Nhân sự (hồ sơ dùng để tính chi phí).
        Đổi vai trò hoặc khóa tài khoản có hiệu lực ở lần tải trang tiếp theo của người đó.</p>
      <div class="toolbar">
        <input class="input search" type="search" placeholder="Tìm theo tên hoặc email…" value="${esc(view.q)}" data-q aria-label="Tìm người dùng">
        <div style="display:flex;gap:8px">
          <select class="input" data-f="role" style="width:auto" aria-label="Lọc vai trò"><option value="">Mọi vai trò</option>
            ${Object.entries(ROLE).map(([k, l]) => `<option value="${k}" ${view.role === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <select class="input" data-f="status" style="width:auto" aria-label="Lọc trạng thái"><option value="">Mọi trạng thái</option>
            ${Object.entries(STATUS).map(([k, [, l]]) => `<option value="${k}" ${view.status === k ? 'selected' : ''}>${l.slice(2)}</option>`).join('')}</select>
        </div>
      </div>
      <section class="card" style="padding:0"><div class="table-wrap" style="border:0"><table>
        <thead><tr><th>Họ tên</th><th>Email</th><th>Vai trò</th><th>Phạm vi xem</th><th>Trạng thái</th><th>Lần đăng nhập cuối</th><th><span class="sr-only">Thao tác</span></th></tr></thead>
        <tbody>${rows.map(row).join('') || '<tr><td colspan="7" class="empty">Không có người dùng phù hợp.</td></tr>'}</tbody>
      </table></div></section>
      <section class="card" style="margin-top:16px">
        <div class="card-head"><div><h2>Nhật ký người dùng</h2><div class="sub">Thêm / sửa / khóa / xóa / đổi vai trò — mới nhất trước</div></div></div>
        <div class="table-wrap"><table class="history-table"><thead><tr><th>Thời điểm</th><th>Người thực hiện</th><th>Nội dung</th><th>Cũ → mới</th></tr></thead>
          <tbody>${logData.log.map((h) => `<tr><td>${formatDateTime(h.at)}</td><td>${esc(h.actor)}</td><td class="wrap">${esc(h.field ?? '')}</td>
            <td class="wrap">${h.oldValue != null || h.newValue != null ? `${esc(h.oldValue ?? '—')} <span class="arrow-sep">→</span> <b>${esc(h.newValue ?? '—')}</b>` : ''}</td></tr>`).join('')
            || '<tr><td colspan="4" class="empty">Chưa có thao tác nào.</td></tr>'}</tbody></table></div>
      </section>`;
    ctx.bindPageHeader(root);
    bind();
  };

  const row = (u) => {
    const [cls, label] = STATUS[u.status];
    return `<tr>
      <td><b>${esc(u.name)}</b>${u.id === data.me ? ' <span class="chip">Bạn</span>' : ''}</td><td>${esc(u.email)}</td>
      <td>${ROLE[u.role]}</td><td class="wrap">${esc(u.scopeText)}</td>
      <td><span class="badge ${cls}">${label}</span></td><td class="small">${formatDateTime(u.lastLoginAt)}</td>
      <td class="r"><div class="row-menu"><button class="icon-btn" data-menu="${u.id}" aria-haspopup="menu" aria-label="Thao tác cho ${esc(u.name)}">⋯</button>
        ${openMenu === u.id ? menu(u) : ''}</div></td></tr>`;
  };

  const item = (action, label, u, lockKey, cls = '') => {
    const why = lockKey ? u.locks[lockKey] : null;
    return `<button role="menuitem" type="button" data-act="${action}" data-id="${u.id}" class="${cls}"
      ${why ? `disabled aria-disabled="true" data-tip="${esc(why)}" title="${esc(why)}"` : ''}>${label}</button>`;
  };

  const menu = (u) => `<div class="menu-pop" role="menu">
    ${item('edit', 'Sửa', u)}
    ${u.status === 'invited' ? item('resend', 'Gửi lại lời mời', u) : ''}
    ${u.status === 'locked' ? item('unlock', 'Mở khóa', u) : item('lock', 'Khóa', u, 'lock')}
    <hr>${item('delete', 'Xóa', u, 'delete', 'danger')}
    ${['lock', 'delete'].some((k) => u.locks[k]) ? `<div class="note" style="padding:6px 10px;max-width:240px">${esc(u.locks.delete || u.locks.lock)}</div>` : ''}
  </div>`;

  const showInvite = (title, link) => openModal(title, `<p>Prototype: không gửi email thật. Gửi link mời này cho người dùng:</p>
    <div style="display:flex;gap:8px"><input class="input" readonly value="${esc(link)}" data-link><button type="button" class="btn" data-copy>Sao chép</button></div>`,
  { submitLabel: 'Xong', onSubmit: () => {} }).el.querySelector('[data-copy]').addEventListener('click', async (e) => {
    const input = e.target.closest('.modal').querySelector('[data-link]');
    try { await navigator.clipboard.writeText(input.value); } catch { input.select(); document.execCommand('copy'); }
    toast('Đã sao chép link mời.');
  });

  const userForm = (u) => {
    const isEdit = Boolean(u);
    const v = u ?? { name: '', email: '', role: 'viewer', scope: 'all', projectIds: [] };
    // Scope: one checkbox per project (sorted by name).
    const scopeItem = (p) => `<label class="check-chip scope-item"><input type="checkbox" name="projectIds" value="${p.id}"
      ${v.projectIds.includes(p.id) ? 'checked' : ''}><span class="dot" style="background:${esc(p.color)}"></span>${esc(p.name)}</label>`;
    const demoteWhy = u?.locks.demote;
    const m = openModal(isEdit ? `Sửa ${u.name}` : 'Thêm người dùng', `
      <label class="field"><span>Họ tên</span><input class="input" name="name" value="${esc(v.name)}" required maxlength="80"></label>
      <label class="field"><span>Email</span><input class="input" type="email" name="email" value="${esc(v.email)}" required></label>
      <div class="field"><span>Vai trò</span><div class="radio-row">
        <label class="radio-card"><input type="radio" name="role" value="admin" ${v.role === 'admin' ? 'checked' : ''}><span><b>Admin</b><br><span class="small muted">Toàn quyền, thấy chi phí từng nhân sự, quyết định cắt lỗ</span></span></label>
        <label class="radio-card"${demoteWhy ? ` data-tip="${esc(demoteWhy)}"` : ''}><input type="radio" name="role" value="viewer" ${v.role === 'viewer' ? 'checked' : ''} ${demoteWhy ? 'disabled' : ''}>
          <span><b>Viewer</b><br><span class="small muted">${demoteWhy ? esc(demoteWhy) : 'Chỉ xem Dashboard, Tổng quan, Marketing'}</span></span></label>
      </div></div>
      <div class="field" data-scope><span>Phạm vi xem (Viewer)</span><div class="radio-row">
        <label class="radio-card"><input type="radio" name="scope" value="all" ${v.scope !== 'selected' ? 'checked' : ''}><span>Tất cả dự án</span></label>
        <label class="radio-card"><input type="radio" name="scope" value="selected" ${v.scope === 'selected' ? 'checked' : ''}><span>Chọn từng dự án</span></label></div>
        <div data-projects style="margin-top:8px">
          <div class="note">Chọn một hoặc nhiều dự án:</div>
          <div class="scope-tree" style="margin-top:6px">${data.projects.map(scopeItem).join('')}</div></div></div>
      ${isEdit ? '' : '<p class="note" style="margin:0">Người dùng mới ở trạng thái "Đã mời" cho tới khi mở link mời.</p>'}`, {
      submitLabel: isEdit ? 'Lưu' : 'Tạo & lấy link mời',
      onSubmit: async (fd) => {
        const body = { name: fd.get('name'), email: fd.get('email'), role: fd.get('role') ?? v.role, scope: fd.get('scope'),
          projectIds: fd.getAll('projectIds').map(Number) };
        if (isEdit) { await put(`/api/users/${u.id}`, body); toast('Đã lưu người dùng.'); }
        else { const r = await post('/api/users', body); setTimeout(() => showInvite(`Đã mời ${r.user.name}`, r.inviteLink)); }
        await reload();
      },
    });
    const sync = () => {
      const viewer = m.el.querySelector('input[name="role"]:checked')?.value === 'viewer';
      m.el.querySelector('[data-scope]').hidden = !viewer;
      m.el.querySelector('[data-projects]').hidden = m.el.querySelector('input[name="scope"]:checked')?.value !== 'selected';
    };
    m.el.addEventListener('change', sync);
    sync();
  };

  const bind = () => {
    root.querySelector('[data-add]').addEventListener('click', () => userForm(null));
    const q = root.querySelector('[data-q]');
    q.addEventListener('input', () => { view.q = q.value; const pos = q.selectionStart; draw(); const n = root.querySelector('[data-q]'); n.focus(); n.setSelectionRange(pos, pos); });
    root.querySelectorAll('[data-f]').forEach((s) => s.addEventListener('change', () => { view[s.dataset.f] = s.value; draw(); }));
    root.querySelectorAll('[data-menu]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      openMenu = openMenu === Number(b.dataset.menu) ? null : Number(b.dataset.menu);
      draw();
    }));
    root.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
      const u = data.users.find((x) => x.id === Number(b.dataset.id));
      openMenu = null;
      draw();
      try {
        if (b.dataset.act === 'edit') return userForm(u);
        if (b.dataset.act === 'resend') { const r = await post(`/api/users/${u.id}/resend`); showInvite(`Link mời mới cho ${u.name}`, r.inviteLink); }
        if (b.dataset.act === 'lock' || b.dataset.act === 'unlock') {
          const locking = b.dataset.act === 'lock';
          if (!(await confirmDialog({ title: `${locking ? 'Khóa' : 'Mở khóa'} ${u.name}?`, danger: locking, confirmLabel: locking ? 'Khóa tài khoản' : 'Mở khóa',
            body: `<p>${locking ? 'Người dùng sẽ bị đăng xuất ở lần tải trang tiếp theo và không đăng nhập được.' : 'Người dùng đăng nhập lại được.'}</p>` }))) return;
          await post(`/api/users/${u.id}/lock`, { locked: locking });
          toast(locking ? `Đã khóa ${u.name}.` : `Đã mở khóa ${u.name}.`);
        }
        if (b.dataset.act === 'delete') return confirmDelete(u);
        await reload();
      } catch (err) { toast(err.message, 'error'); }
    }));
  };

  const confirmDelete = (u) => openModal(`Xóa ${u.name}?`, `<p>Tài khoản bị xóa không đăng nhập được nữa. Lịch sử thay đổi cũ vẫn giữ tên kèm "(đã xóa)".</p>
    <label class="field"><span>Gõ email <b>${esc(u.email)}</b> để xác nhận</span><input class="input" name="confirmEmail" autocomplete="off"></label>`, {
    submitLabel: 'Xóa người dùng',
    onSubmit: async (fd) => {
      await del(`/api/users/${u.id}`, { confirmEmail: fd.get('confirmEmail') });
      toast(`Đã xóa ${u.name}.`);
      await reload();
    },
  });

  const close = (e) => { if (openMenu != null && !e.target.closest?.('.row-menu')) { openMenu = null; draw(); } };
  document.addEventListener('click', close);
  ctx.onLeave(() => document.removeEventListener('click', close));
  draw();
}
