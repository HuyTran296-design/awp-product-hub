// CSV import ("Tải lên CSV"): columns date, metric_key, platform, value.
// Preview reports errors per line; valid lines can be imported, duplicates are overwritten or skipped.

import { METRIC_CATALOG, getMetricDef } from '../../shared/metric-catalog.js';
import { formatNumber } from '../../shared/format.js';
import { tx } from '../database.js';
import { logChange } from './audit-log.js';
import { httpError } from './connection-service.js';

export const CSV_COLUMNS = ['date', 'metric_key', 'platform', 'value'];
const PLATFORMS = ['ios', 'android', 'web', 'youtube', 'all'];
/** Non-baseline series that may also be imported (website & YouTube channel). */
const EXTRA_KEYS = ['web_users', 'web_sessions', 'web_engaged_sessions', 'yt_watch_hours', 'yt_new_subs'];
const MAX_LINES = 20_000;

export function csvTemplate() {
  return [
    CSV_COLUMNS.join(','),
    '2026-10-01,plays,all,3950',
    '2026-10-01,players,all,1480',
    '2026-10-01,play_time,all,6.4',
    '2026-10-01,ad_revenue_share,all,104000',
    '2026-10-01,channel_views,youtube,7200',
  ].join('\n') + '\n';
}

function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Parse + validate. Line numbers are 1-based file lines (header = line 1). */
export function parseCsv(db, projectId, text) {
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/);
  const header = (lines[0] ?? '').split(',').map((h) => h.trim().toLowerCase());
  if (CSV_COLUMNS.some((c, i) => header[i] !== c)) {
    throw httpError(422, `Dòng tiêu đề phải là: ${CSV_COLUMNS.join(',')}`);
  }
  if (lines.length > MAX_LINES) throw httpError(422, `Tối đa ${formatNumber(MAX_LINES)} dòng mỗi lần tải lên.`);
  const allowed = new Set([...METRIC_CATALOG.map((m) => m.key), ...EXTRA_KEYS]);
  const exists = db.prepare('SELECT value FROM metric_daily WHERE project_id = ? AND metric_key = ? AND platform = ? AND date = ?');
  const valid = [];
  const errors = [];
  const seen = new Map();
  lines.slice(1).forEach((raw, i) => {
    const line = i + 2;
    if (!raw.trim()) return;
    const cells = raw.split(',').map((c) => c.trim());
    const [date, metricKey, platform, valueText] = cells;
    const problems = [];
    if (cells.length !== 4) problems.push(`cần đúng 4 cột, có ${cells.length}`);
    if (!validDate(date)) problems.push(`ngày "${date ?? ''}" không đúng định dạng YYYY-MM-DD`);
    if (!allowed.has(metricKey)) problems.push(`metric_key "${metricKey ?? ''}" không có trong danh mục`);
    if (!PLATFORMS.includes(platform)) problems.push(`platform "${platform ?? ''}" phải là một trong ${PLATFORMS.join('/')}`);
    const value = Number(String(valueText ?? '').replace(',', '.'));
    if (valueText === undefined || valueText === '' || !Number.isFinite(value) || value < 0) problems.push(`value "${valueText ?? ''}" phải là số ≥ 0`);
    if (problems.length) { errors.push({ line, raw, message: problems.join('; ') }); return; }
    const key = `${date}|${metricKey}|${platform}`;
    if (seen.has(key)) valid[seen.get(key)].dupInFile = true;
    const old = exists.get(projectId, metricKey, platform, date);
    seen.set(key, valid.length);
    valid.push({ line, date, metricKey, platform, value, existing: old ? old.value : null,
      name: getMetricDef(metricKey)?.short ?? metricKey });
  });
  return {
    total: valid.length + errors.length, valid: valid.length, errors,
    duplicates: valid.filter((v) => v.existing != null).length,
    sample: valid.slice(0, 20), rows: valid,
  };
}

/** Import valid lines; mode 'overwrite' replaces existing values, 'skip' keeps them. */
export function importCsv(db, projectId, text, mode, actor) {
  const parsed = parseCsv(db, projectId, text);
  const sql = mode === 'overwrite'
    ? 'INSERT OR REPLACE INTO metric_daily (project_id, date, metric_key, platform, value) VALUES (?, ?, ?, ?, ?)'
    : 'INSERT OR IGNORE INTO metric_daily (project_id, date, metric_key, platform, value) VALUES (?, ?, ?, ?, ?)';
  let written = 0;
  tx(db, () => {
    const ins = db.prepare(sql);
    for (const r of parsed.rows) written += Number(ins.run(projectId, r.date, r.metricKey, r.platform, r.value).changes > 0);
    logChange(db, { projectId, actor, action: 'Tải lên CSV', field: `${parsed.valid} dòng hợp lệ · ${parsed.errors.length} dòng lỗi`,
      oldValue: null, newValue: `Đã ghi ${written} dòng (${mode === 'overwrite' ? 'ghi đè' : 'bỏ qua'} dòng trùng)` });
  });
  return { written, skipped: parsed.valid - written, errors: parsed.errors, duplicates: parsed.duplicates };
}
