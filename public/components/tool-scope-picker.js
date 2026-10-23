// "Áp dụng cho" of a Tools/AI row: a searchable multi-select combobox.
// Options: "Tất cả dự án" (default, exclusive) · single projects.
// Value: [] = Tất cả dự án, else the chosen project ids. Keyboard: ↑ ↓ Enter/Space toggle, Esc close, type to filter.

import { esc } from '../ui.js';

const ALL = 'Tất cả dự án';

/**
 * @param {HTMLElement} el
 * @param {{options:{id:number, name:string, color:string}[], value?:number[], label?:string,
 *          onChange?:(ids:number[])=>void}} o
 */
export function createToolScopePicker(el, { options, value = [], label = 'Áp dụng cho', onChange }) {
  let current = [...value];
  let open = false;
  let active = 0;
  let query = '';
  const uid = `ts${Math.random().toString(36).slice(2, 8)}`;
  const all = [{ id: null, name: ALL }, ...options];
  const text = (o) => (o.id == null ? ALL : o.name);
  const items = () => all.filter((o) => !query || text(o).toLowerCase().includes(query.toLowerCase()));
  const isOn = (o) => (o.id == null ? !current.length : current.includes(o.id));
  const optionHtml = (o) => (o.id == null ? `<span class="pp-name">${ALL}</span>`
    : `<span class="dot" style="background:${esc(o.color)}"></span><span>${esc(o.name)}</span>`);

  el.innerHTML = `<div class="combo tool-scope">
      <button type="button" class="input pp-button" aria-haspopup="listbox" aria-expanded="false" aria-label="${esc(label)}">
        <span class="pp-value ts-value"></span><span aria-hidden="true" class="pp-caret">▾</span></button>
      <div class="pp-pop" hidden>
        <input class="input pp-search" type="search" placeholder="Tìm dự án…" aria-label="Tìm dự án" role="combobox"
          aria-expanded="true" aria-controls="${uid}-list" aria-autocomplete="list" autocomplete="off">
        <ul class="pp-list" role="listbox" aria-multiselectable="true" id="${uid}-list" aria-label="${esc(label)}"></ul>
      </div>
    </div>`;
  const btn = el.querySelector('.pp-button');
  const pop = el.querySelector('.pp-pop');
  const search = el.querySelector('.pp-search');
  const list = el.querySelector('.pp-list');

  const drawValue = () => {
    const names = current.map((id) => all.find((o) => o.id === id)).filter(Boolean).map(text);
    const v = el.querySelector('.ts-value');
    v.textContent = names.length ? names.join(', ') : ALL;
    v.title = v.textContent;
  };
  const drawList = () => {
    const its = items();
    active = Math.min(active, Math.max(0, its.length - 1));
    list.innerHTML = its.map((o, i) => `<li role="option" id="${uid}-o${i}" data-i="${i}" aria-selected="${isOn(o)}"
      class="${i === active ? 'active' : ''}${o.id == null ? ' ts-all' : ''}"><span class="ts-box" aria-hidden="true">${isOn(o) ? '✓' : ''}</span>${optionHtml(o)}</li>`).join('')
      || '<li class="empty" role="presentation">Không tìm thấy dự án phù hợp</li>';
    search.setAttribute('aria-activedescendant', its.length ? `${uid}-o${active}` : '');
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  };
  const setOpen = (v) => {
    open = v;
    pop.hidden = !v;
    btn.setAttribute('aria-expanded', String(v));
    if (v) { query = ''; search.value = ''; active = 0; drawList(); search.focus(); }
  };
  const toggle = (o) => {
    if (o.id == null) current = [];
    else current = current.includes(o.id) ? current.filter((x) => x !== o.id) : [...current, o.id];
    drawValue();
    drawList();
    onChange?.([...current]);
  };

  btn.addEventListener('click', () => setOpen(!open));
  btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); } });
  search.addEventListener('input', () => { query = search.value; active = 0; drawList(); });
  search.addEventListener('keydown', (e) => {
    const its = items();
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(its.length - 1, active + 1); drawList(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); drawList(); }
    else if (e.key === 'Enter' || (e.key === ' ' && !search.value)) { e.preventDefault(); if (its[active]) toggle(its[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  });
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const li = e.target.closest('[data-i]');
    if (li) toggle(items()[Number(li.dataset.i)]);
  });
  const outside = (e) => {
    if (!document.body.contains(el)) { document.removeEventListener('mousedown', outside); return; }
    if (open && !el.contains(e.target)) setOpen(false);
  };
  document.addEventListener('mousedown', outside);
  drawValue();

  return { getValue: () => [...current] };
}
