// Kết nối dữ liệu → "Nguồn promote" (Admin): sub-sources of the channel "Promote từ nền tảng khác".
// Each source gets copyable tracking links (web UTM, App Store ct=, Google Play UTM referrer).

import { del, get, post, put } from '../api.js';
import { confirmDialog, esc, toast } from '../ui.js';
import { suggestPromoCode } from '/shared/promo-links.js';

export async function createPromoSourcesEditor(el, projectId) {
  let data = await get(`/api/projects/${projectId}/promo-sources`);
  let editing = null; // null | 'new' | source id

  const form = (s = {}) => `<form class="promo-item" data-form novalidate>
    <div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));align-items:start">
      <label class="field"><span>Nguồn là sản phẩm khác trong hệ thống?</span><select class="input" name="sourceProjectId">
        <option value="">Không — nhập tên nguồn</option>${data.projects.map((p) => `<option value="${p.id}" ${s.sourceProjectId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Tên nguồn</span><input class="input" name="name" maxlength="80" value="${esc(s.sourceProjectId ? s.name : s.customName ?? '')}" placeholder="Từ Facebook Group" ${s.sourceProjectId ? 'readonly' : ''}>
        <span class="hint" data-name-hint>${s.sourceProjectId ? 'Tự lấy tên sản phẩm.' : ''}</span></label>
      <label class="field"><span>Mã nguồn</span><input class="input" name="code" maxlength="40" value="${esc(s.code ?? '')}" placeholder="promo_fb_group" spellcheck="false" autocomplete="off">
        <span class="hint">Dùng làm utm_source / ct — chữ thường, số, "_".</span></label>
    </div>
    <div data-err></div>
    <div class="conn-actions"><button type="submit" class="btn primary sm">${editing === 'new' ? 'Thêm nguồn' : 'Lưu'}</button><button type="button" class="btn sm" data-cancel>Hủy</button></div>
  </form>`;

  const item = (s) => (editing === s.id ? form(s) : `<div class="promo-item">
    <div class="head"><div><b>${esc(s.name)}</b>${s.note ? ` <span class="note">(${esc(s.note)})</span>` : ''}
      <div class="small muted">Mã nguồn: <code>${esc(s.code)}</code></div></div>
      <div class="conn-actions"><button type="button" class="btn sm" data-edit="${s.id}">Sửa</button><button type="button" class="btn sm danger" data-del="${s.id}">Xóa</button></div></div>
    ${s.links.map((l) => `<div class="promo-link"><span class="small">${esc(l.label)}</span><code>${esc(l.url)}</code>
      <button type="button" class="btn sm" data-copy="${esc(l.url)}" aria-label="Sao chép ${esc(l.label)} của ${esc(s.name)}">Sao chép</button>
      ${l.missing ? `<span class="small muted" style="grid-column:2 / -1">⚠ ${esc(l.missing)}</span>` : ''}</div>`).join('')}
  </div>`);

  const draw = () => {
    el.innerHTML = `<section class="card">
      <div class="card-head"><div><h2>Nguồn promote</h2><div class="sub">Các nguồn con của kênh "Promote từ nền tảng khác" (Marketing → Nguồn tải app theo kênh). Mỗi nguồn có link theo dõi riêng.</div></div>
        ${editing === 'new' ? '' : '<button type="button" class="btn sm primary" data-add>＋ Thêm nguồn</button>'}</div>
      <div class="promo-list">${editing === 'new' ? form() : ''}${data.sources.map(item).join('') || (editing ? '' : '<div class="empty">Chưa có nguồn promote.</div>')}</div>
    </section>`;
    bind();
  };

  const bind = () => {
    el.querySelector('[data-add]')?.addEventListener('click', () => { editing = 'new'; draw(); el.querySelector('[name="sourceProjectId"]').focus(); });
    el.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => { editing = Number(b.dataset.edit); draw(); el.querySelector('[name="name"]').focus(); }));
    el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const s = data.sources.find((x) => x.id === Number(b.dataset.del));
      if (!(await confirmDialog({ title: `Xóa nguồn "${s.name}"?`, body: '<p>Link theo dõi của nguồn này sẽ không còn được tính vào bảng nguồn tải.</p>', confirmLabel: 'Xóa', danger: true }))) return;
      try { await del(`/api/projects/${projectId}/promo-sources/${s.id}`); toast('Đã xóa nguồn promote.'); await reload(); } catch (err) { toast(err.message, 'error'); }
    }));
    el.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copy(b.dataset.copy, b)));
    const f = el.querySelector('[data-form]');
    if (!f) return;
    const nameHint = f.querySelector('[data-name-hint]');
    let codeTouched = Boolean(f.code.value);
    f.code.addEventListener('input', () => { codeTouched = true; });
    const syncCode = () => { if (!codeTouched) f.code.value = suggestPromoCode(f.name.value); };
    f.name.addEventListener('input', syncCode);
    f.sourceProjectId.addEventListener('change', () => {
      const p = data.projects.find((x) => x.id === Number(f.sourceProjectId.value));
      f.name.readOnly = Boolean(p);
      if (p) f.name.value = p.name;
      nameHint.textContent = p ? 'Tự lấy tên sản phẩm.' : '';
      syncCode();
    });
    f.querySelector('[data-cancel]').addEventListener('click', () => { editing = null; draw(); });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { name: f.name.value, code: f.code.value.trim(), sourceProjectId: f.sourceProjectId.value ? Number(f.sourceProjectId.value) : null };
      try {
        if (editing === 'new') await post(`/api/projects/${projectId}/promo-sources`, body);
        else await put(`/api/projects/${projectId}/promo-sources/${editing}`, body);
        toast(editing === 'new' ? 'Đã thêm nguồn promote.' : 'Đã lưu nguồn promote.');
        editing = null;
        await reload();
      } catch (err) { f.querySelector('[data-err]').innerHTML = `<div class="alert error">${esc(err.message)}</div>`; }
    });
  };

  const reload = async () => { data = await get(`/api/projects/${projectId}/promo-sources`); draw(); };
  draw();
  return { isDirty: () => editing !== null };
}

async function copy(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for non-secure contexts.
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  const old = btn.textContent;
  btn.textContent = 'Đã sao chép ✓';
  setTimeout(() => { btn.textContent = old; }, 1500);
}
