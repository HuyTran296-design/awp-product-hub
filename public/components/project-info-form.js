// "Thông tin" form of a Sản phẩm: name, "Thuộc dự án", brand color, release platforms (multi-select), phase, launch date, budget.
// Wizard: the Dự án is chosen here with the searchable picker (required). Edit page: it is shown with a
// "Chuyển sang dự án khác" button (effective-dated, handled by the caller via `parentHtml`).

import { esc, parseVnd } from '../ui.js';
import { formatNumber } from '/shared/format.js';
import { createParentPicker } from './parent-picker.js';

export const PLATFORM_OPTIONS = [['ios', 'iOS'], ['android', 'Android'], ['web', 'Website'], ['playables', 'YouTube Playables']];

const normalize = (v) => JSON.stringify({ name: v.name, color: String(v.color).toLowerCase(), platforms: [...v.platforms].sort(),
  launchDate: v.launchDate || null, buildBudget: Number.isFinite(v.buildBudget) ? v.buildBudget : null,
  parentId: v.parentId ?? null, phase: v.phase ?? null });

/**
 * @param {{info:object, onChange?:Function, phaseHtml?:string, phases?:object, parentOptions?:object[]|null, parentHtml?:string,
 *          onParentChange?:(parentId:number|null)=>void}} o
 */
export function createInfoForm(el, { info, onChange, phaseHtml = '', phases = null, parentOptions = null, parentHtml = '', onParentChange }) {
  const initial = normalize({ ...info, parentId: info.parentId ?? null, phase: phases ? (info.phase ?? 'growth') : null });
  el.innerHTML = `<form class="stack" style="gap:14px;max-width:660px" novalidate>
    <label class="field"><span>Tên sản phẩm</span><input class="input" name="name" maxlength="60" value="${esc(info.name)}" placeholder="Ví dụ: Game A"></label>
    ${parentOptions ? '<div data-parent-picker></div>' : parentHtml}
    <div class="field"><span>Nền tảng phát hành</span><div class="chips">${PLATFORM_OPTIONS.map(([v, l]) =>
      `<label class="check-chip"><input type="checkbox" name="platforms" value="${v}" ${info.platforms.includes(v) ? 'checked' : ''}>${l}</label>`).join('')}</div>
      <span class="hint">Kết nối dữ liệu và danh mục baseline hiện theo các nền tảng đã chọn.</span></div>
    <label class="check-chip" style="align-self:flex-start"><input type="checkbox" name="blog" ${info.platforms.includes('blog') ? 'checked' : ''}>Có blog (Marketing)</label>
    <label class="field" style="max-width:220px"><span>Màu nhận diện</span><input class="input" type="color" name="color" value="${esc(info.color)}" style="height:40px;padding:4px"></label>
    ${phaseHtml}
    ${phases ? `<label class="field"><span>Giai đoạn</span><select class="input" name="phase">${Object.entries(phases).map(([k, l]) =>
      `<option value="${k}" ${k === (info.phase ?? 'growth') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>` : ''}
    <div class="form-grid">
      <label class="field"><span>Ngày ra mắt dự kiến</span><input class="input" type="date" name="launchDate" value="${esc(info.launchDate ?? '')}"></label>
      <label class="field"><span>Ngân sách giai đoạn Xây dựng</span><div class="input-suffix" data-suffix="₫">
        <input class="input right" name="buildBudget" inputmode="numeric" value="${info.buildBudget ? formatNumber(info.buildBudget) : ''}" placeholder="Không bắt buộc"></div></label>
    </div>
  </form>`;
  const form = el.querySelector('form');
  const picker = parentOptions ? createParentPicker(form.querySelector('[data-parent-picker]'), { options: parentOptions, value: info.parentId ?? null,
    label: 'Thuộc dự án <span class="muted">(bắt buộc)</span>',
    note: 'Chọn dự án → điền sẵn nền tảng, baseline, trọng số, ngưỡng màu và cắt lỗ theo "Mẫu cho sản phẩm mới" của dự án đó (sửa được).',
    onChange: (id) => { onParentChange?.(id); onChange?.(); } }) : null;
  const getValue = () => {
    const fd = new FormData(form);
    const budget = parseVnd(fd.get('buildBudget'));
    return {
      name: String(fd.get('name') || '').trim(), color: fd.get('color'),
      platforms: [...fd.getAll('platforms'), ...(fd.get('blog') ? ['blog'] : [])],
      launchDate: fd.get('launchDate') || null, buildBudget: Number.isFinite(budget) ? budget : null,
      ...(picker ? { parentId: picker.getValue() } : {}),
      ...(fd.get('phase') ? { phase: fd.get('phase') } : {}),
    };
  };
  form.addEventListener('input', () => onChange?.());
  form.addEventListener('submit', (e) => e.preventDefault());
  return {
    getValue,
    setPlatforms(platforms) {
      form.querySelectorAll('[name="platforms"]').forEach((c) => { c.checked = platforms.includes(c.value); });
      form.querySelector('[name="blog"]').checked = platforms.includes('blog');
    },
    isDirty: () => normalize(getValue()) !== initial,
    errors: () => {
      const v = getValue();
      const e = [];
      if (picker && v.parentId == null) e.push('Hãy chọn dự án cho sản phẩm');
      if (!v.name) e.push('Vui lòng nhập tên sản phẩm.');
      if (!v.platforms.some((p) => p !== 'blog')) e.push('Chọn ít nhất 1 nền tảng phát hành.');
      return e;
    },
  };
}
