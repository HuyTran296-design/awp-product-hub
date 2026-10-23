// "Thông tin" form of a Dự án: name, brand color, release platforms (multi-select), phase, launch date, budget.
// Wizard: optional "Sao chép cấu hình từ dự án…" (platforms, baselines, weights, targets, thresholds, stop-loss — never
// staff or connections); the caller loads the chosen project's configuration via `onCopyChange`.

import { esc, parseVnd } from '../ui.js';
import { formatNumber } from '/shared/format.js';

export const PLATFORM_OPTIONS = [['ios', 'iOS'], ['android', 'Android'], ['web', 'Website'], ['playables', 'YouTube Playables']];

const normalize = (v) => JSON.stringify({ name: v.name, color: String(v.color).toLowerCase(), platforms: [...v.platforms].sort(),
  launchDate: v.launchDate || null, buildBudget: Number.isFinite(v.buildBudget) ? v.buildBudget : null,
  phase: v.phase ?? null, copyFromId: v.copyFromId ?? null });

/**
 * @param {{info:object, onChange?:Function, phaseHtml?:string, phases?:object,
 *          copyOptions?:{id:number, name:string}[]|null, onCopyChange?:(projectId:number|null)=>void}} o
 */
export function createInfoForm(el, { info, onChange, phaseHtml = '', phases = null, copyOptions = null, onCopyChange }) {
  const initial = normalize({ ...info, phase: phases ? (info.phase ?? 'growth') : null, copyFromId: copyOptions ? (info.copyFromId ?? null) : null });
  el.innerHTML = `<form class="stack" style="gap:14px;max-width:660px" novalidate>
    <label class="field"><span>Tên dự án</span><input class="input" name="name" maxlength="60" value="${esc(info.name)}" placeholder="Ví dụ: Game C"></label>
    ${copyOptions ? `<label class="field"><span>Sao chép cấu hình từ dự án… <span class="muted">(không bắt buộc)</span></span>
      <select class="input" name="copyFromId"><option value="">Không sao chép</option>${copyOptions.map((p) =>
        `<option value="${p.id}" ${p.id === info.copyFromId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <span class="hint">Sao chép nền tảng, baseline, trọng số, mục tiêu, ngưỡng màu và phương án cắt lỗ (sửa được); không sao chép nhân sự và kết nối.
        Không sao chép thì phương án cắt lỗ mặc định tắt.</span></label>` : ''}
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
  const getValue = () => {
    const fd = new FormData(form);
    const budget = parseVnd(fd.get('buildBudget'));
    return {
      name: String(fd.get('name') || '').trim(), color: fd.get('color'),
      platforms: [...fd.getAll('platforms'), ...(fd.get('blog') ? ['blog'] : [])],
      launchDate: fd.get('launchDate') || null, buildBudget: Number.isFinite(budget) ? budget : null,
      ...(copyOptions ? { copyFromId: Number(fd.get('copyFromId')) || null } : {}),
      ...(fd.get('phase') ? { phase: fd.get('phase') } : {}),
    };
  };
  form.addEventListener('input', () => onChange?.());
  form.querySelector('[name="copyFromId"]')?.addEventListener('change', (e) => onCopyChange?.(Number(e.target.value) || null));
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
      if (!v.name) e.push('Vui lòng nhập tên dự án.');
      if (!v.platforms.some((p) => p !== 'blog')) e.push('Chọn ít nhất 1 nền tảng phát hành.');
      return e;
    },
  };
}
