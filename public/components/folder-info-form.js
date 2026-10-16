// "Thông tin" form of a Dự án: name, description, color, icon and the color thresholds of its composite score
// (default Tốt > 80%, Báo động < 50%).

import { esc } from '../ui.js';

const ICONS = ['📁', '🎮', '🔔', '📱', '🌐', '🎵', '📚', '🧘', '🛒', '⭐'];

const normalize = (v) => JSON.stringify({ name: v.name, description: v.description, color: String(v.color).toLowerCase(), icon: v.icon ?? '',
  green: v.thresholds.green, red: v.thresholds.red });

/** @param {{info:{name,description,color,icon,thresholds}, onChange?:Function}} o */
export function createFolderInfoForm(el, { info, onChange }) {
  const th = info.thresholds ?? { green: 80, red: 50 };
  const initial = normalize({ ...info, thresholds: th });
  el.innerHTML = `<form class="stack" style="gap:14px;max-width:660px" novalidate>
    <label class="field"><span>Tên dự án</span><input class="input" name="name" maxlength="60" value="${esc(info.name)}" placeholder="Ví dụ: ABC Game Studio"></label>
    <label class="field"><span>Mô tả <span class="muted">(không bắt buộc)</span></span><textarea class="input" name="description" rows="2" maxlength="300">${esc(info.description ?? '')}</textarea></label>
    <div class="form-grid">
      <label class="field"><span>Màu nhận diện</span><input class="input" type="color" name="color" value="${esc(info.color)}" style="height:40px;padding:4px"></label>
      <div class="field"><span>Icon</span><div class="chips">${ICONS.map((i) => `<label class="check-chip"><input type="radio" name="icon" value="${i}"
        ${(info.icon ?? '📁') === i ? 'checked' : ''}><span aria-hidden="true">${i}</span></label>`).join('')}</div></div>
    </div>
    <div class="field"><span>Ngưỡng màu cho điểm tổng hợp</span><div class="form-grid">
      <label class="field"><span class="small">Tốt khi &gt;</span><div class="input-suffix" data-suffix="%"><input class="input right" type="number" min="1" max="100" name="green" value="${th.green}"></div></label>
      <label class="field"><span class="small">Báo động khi &lt;</span><div class="input-suffix" data-suffix="%"><input class="input right" type="number" min="0" max="99" name="red" value="${th.red}"></div></label>
    </div><span class="hint">Điểm tổng hợp = trung bình điểm các sản phẩm theo chi phí kỳ (bỏ qua sản phẩm Xây dựng, Tạm dừng, chưa có điểm).</span></div>
  </form>`;
  const form = el.querySelector('form');
  const getValue = () => {
    const fd = new FormData(form);
    return { name: String(fd.get('name') || '').trim(), description: String(fd.get('description') || '').trim(),
      color: fd.get('color'), icon: fd.get('icon') || null, thresholds: { green: Number(fd.get('green')), red: Number(fd.get('red')) } };
  };
  form.addEventListener('input', () => onChange?.());
  form.addEventListener('submit', (e) => e.preventDefault());
  return {
    getValue,
    isDirty: () => normalize(getValue()) !== initial,
    errors: () => {
      const v = getValue();
      const e = [];
      if (!v.name) e.push('Vui lòng nhập tên dự án.');
      if (!(v.thresholds.green > 0 && v.thresholds.green <= 100 && v.thresholds.red >= 0 && v.thresholds.red < v.thresholds.green)) {
        e.push('Ngưỡng màu không hợp lệ: cần 0 ≤ Báo động < Tốt ≤ 100.');
      }
      return e;
    },
  };
}
