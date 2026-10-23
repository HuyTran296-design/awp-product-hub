// Reads a short Vietnamese question ("Doanh thu của Game B hôm nay") into what the Trợ lý page should show:
// which metrics, which projects / products (or the whole team) and which period.
// Rule-based keyword matching on accent-free text — no AI service is called, nothing leaves the app.

import { METRIC_CATALOG } from './metric-catalog.js';

/** "Doanh thu của Game B" -> "doanh thu cua game b" (no accents, lower case, single spaces). */
export function fold(text) {
  return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Checked in this order, so "3 ngày" wins over "ngày".
const PERIOD_WORDS = [
  ['3days', ['3 ngay', 'ba ngay']],
  ['day', ['hom nay', 'hom qua', 'ngay', 'today']],
  ['week', ['tuan']],
  ['month', ['thang']],
  ['quarter', ['quy']],
  ['year', ['nam nay', 'nam']],
];

export const PERIOD_PHRASES = {
  day: 'hôm nay', '3days': '3 ngày qua', week: 'tuần này', month: 'tháng này', quarter: 'quý này', year: 'năm nay',
};

// Money metrics come from the Dashboard row; the others are baselines of the metric catalog.
const MONEY_METRICS = [
  { key: 'revenue', label: 'Doanh thu', words: ['doanh thu', 'revenue', 'thu nhap'] },
  { key: 'cost', label: 'Chi phí', words: ['chi phi', 'cost'] },
  { key: 'profit', label: 'Lãi/Lỗ', words: ['lai lo', 'loi lo', 'loi nhuan', 'lai', 'lo', 'loi', 'profit'] },
  { key: 'score', label: 'Điểm sức khỏe', words: ['diem', 'suc khoe', 'tinh trang', 'health'] },
];
const EXTRA_WORDS = { downloads: ['luot tai', 'luot cai', 'installs', 'download'], new_users: ['user moi', 'nguoi moi'] };
const BASELINE_METRICS = METRIC_CATALOG.filter((m) => m.key !== 'revenue').map((m) => ({
  key: m.key,
  label: m.short,
  words: [...new Set([fold(m.short), fold(m.name), m.key.replace(/_/g, ' '), ...(EXTRA_WORDS[m.key] ?? [])])],
}));
export const METRICS = [...MONEY_METRICS, ...BASELINE_METRICS];
export const OVERVIEW_METRICS = ['revenue', 'cost', 'profit', 'score'];

const TEAM_WORDS = ['team', 'toan team', 'ca team', 'tat ca', 'toan bo'];
const OVERVIEW_WORDS = ['tong quan', 'tinh hinh', 'overview', 'bao cao', 'ket qua'];

const has = (text, word) => ` ${text} `.includes(` ${word} `);

/**
 * @param {string} question  what the user typed
 * @param {{id:number,name:string}[]} projects  projects / products the user may see
 * @returns {{metrics:string[], projectIds:number[], team:boolean, period:string|null}|null}  null = not understood
 */
export function parseQuestion(question, projects = []) {
  let text = fold(question);
  if (!text) return null;
  // Project names first (longest first, so "Game AB" is not read as "Game A"), then remove them,
  // so a name cannot also count as a metric or period word.
  const projectIds = [];
  const compact = (s) => s.replace(/ /g, '');
  for (const p of [...projects].sort((a, b) => b.name.length - a.name.length)) {
    const name = fold(p.name);
    if (!name) continue;
    if (has(text, name)) {
      projectIds.push(p.id);
      text = ` ${text} `.replace(` ${name} `, ' ').trim();
    } else if (compact(name).length > 3 && text.split(' ').includes(compact(name))) {
      projectIds.push(p.id); // "zenbell"
      text = text.split(' ').filter((w) => w !== compact(name)).join(' ');
    }
  }
  const period = PERIOD_WORDS.find(([, words]) => words.some((w) => has(text, w)))?.[0] ?? null;
  // "đầu" folds to "dau" too, so DAU needs the unaccented word in what was typed.
  const metrics = METRICS.filter((m) => m.words.some((w) => has(text, w)))
    .filter((m) => m.key !== 'dau' || /(^|[^\p{L}])dau([^\p{L}]|$)/iu.test(question)).map((m) => m.key);
  const overview = OVERVIEW_WORDS.some((w) => has(text, w));
  if (!metrics.length && !projectIds.length && !overview) return null;
  return {
    metrics: metrics.length ? metrics : OVERVIEW_METRICS,
    projectIds,
    team: !projectIds.length || TEAM_WORDS.some((w) => has(text, w)),
    period,
  };
}

export function metricLabel(key) {
  return METRICS.find((m) => m.key === key)?.label ?? key;
}
