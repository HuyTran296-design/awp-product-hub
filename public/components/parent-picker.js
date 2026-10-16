// "Thuộc dự án" picker of a Sản phẩm: a searchable combobox (not the browser's native select), required.
// Options: Dự án (color dot · name · "N sản phẩm"). Keyboard: ↑ ↓ Enter Esc, type to filter.

import { esc } from '../ui.js';

export const PLACEHOLDER = 'Chọn dự án…';

/**
 * @param {HTMLElement} el
 * @param {{options:{id:number, name:string, color:string, children:number}[], value?:number|null, disabled?:boolean,
 *          note?:string, label?:string (trusted HTML), onChange?:(id:number|null)=>void}} o
 */
export function createParentPicker(el, { options, value = null, disabled = false, note = '', label = 'Thuộc dự án', onChange }) {
  let current = value;
  let open = false;
  let active = 0;
  let query = '';
  const uid = `pp${Math.random().toString(36).slice(2, 8)}`;
  const items = () => options
    .filter((o) => !query || o.name.toLowerCase().includes(query.toLowerCase()));
  const optionHtml = (o) => (o.id == null
    ? `<span class="pp-root muted">${esc(PLACEHOLDER)}</span>`
    : `<span class="dot" style="background:${esc(o.color)}"></span><span class="pp-name">${esc(o.name)}</span><span class="note">· ${o.children} sản phẩm</span>`);
  const selected = () => options.find((o) => o.id === current) ?? { id: null, name: PLACEHOLDER };

  el.innerHTML = `<div class="field"><span id="${uid}-l">${label}</span>
    <div class="parent-picker${disabled ? ' disabled' : ''}">
      <button type="button" class="input pp-button" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="${uid}-l ${uid}-v" ${disabled ? 'disabled' : ''}>
        <span id="${uid}-v" class="pp-value"></span><span aria-hidden="true" class="pp-caret">▾</span></button>
      <div class="pp-pop" hidden>
        <input class="input pp-search" type="search" placeholder="Tìm dự án…" aria-label="Tìm dự án" role="combobox" aria-expanded="true"
          aria-controls="${uid}-list" aria-autocomplete="list" autocomplete="off">
        <ul class="pp-list" role="listbox" id="${uid}-list" aria-labelledby="${uid}-l"></ul>
      </div>
    </div>
    ${note ? `<span class="hint">${esc(note)}</span>` : ''}</div>`;
  const btn = el.querySelector('.pp-button');
  const pop = el.querySelector('.pp-pop');
  const search = el.querySelector('.pp-search');
  const list = el.querySelector('.pp-list');

  const drawValue = () => { el.querySelector('.pp-value').innerHTML = optionHtml(selected()); };
  const drawList = () => {
    const its = items();
    active = Math.min(active, Math.max(0, its.length - 1));
    list.innerHTML = its.map((o, i) => `<li role="option" id="${uid}-o${i}" data-i="${i}" aria-selected="${o.id === current}"
      class="${i === active ? 'active' : ''}">${optionHtml(o)}${o.id === current ? '<span class="pp-check" aria-hidden="true">✓</span>' : ''}</li>`).join('')
      || '<li class="empty" role="presentation">Không tìm thấy dự án phù hợp</li>';
    search.setAttribute('aria-activedescendant', its.length ? `${uid}-o${active}` : '');
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  };
  const setOpen = (v) => {
    open = v;
    pop.hidden = !v;
    btn.setAttribute('aria-expanded', String(v));
    if (v) {
      query = '';
      search.value = '';
      active = Math.max(0, items().findIndex((o) => o.id === current));
      drawList();
      search.focus();
    }
  };
  const choose = (o) => {
    const changed = o.id !== current;
    current = o.id;
    drawValue();
    setOpen(false);
    btn.focus();
    if (changed) onChange?.(current);
  };

  btn.addEventListener('click', () => setOpen(!open));
  btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); } });
  search.addEventListener('input', () => { query = search.value; active = 0; drawList(); });
  search.addEventListener('keydown', (e) => {
    const its = items();
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(its.length - 1, active + 1); drawList(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); drawList(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (its[active]) choose(its[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  });
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const li = e.target.closest('[data-i]');
    if (li) choose(items()[Number(li.dataset.i)]);
  });
  const outside = (e) => {
    if (!document.body.contains(el)) { document.removeEventListener('mousedown', outside); return; }
    if (open && !el.contains(e.target)) setOpen(false);
  };
  document.addEventListener('mousedown', outside);
  drawValue();

  return {
    getValue: () => current,
    setValue(id) { current = id; drawValue(); },
  };
}
