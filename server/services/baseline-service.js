// Baseline & threshold validation and persistence (with change history).

import { getMetricDef } from '../../shared/metric-catalog.js';
import { formatNumber } from '../../shared/format.js';
import { getBaselines, getThresholds, tx } from '../database.js';
import { logChange } from './audit-log.js';

export const MIN_BASELINES = 1;
export const MAX_BASELINES = 5;

export function validateBaselines(list, thresholds) {
  const errors = [];
  if (list.length < MIN_BASELINES) errors.push({ message: 'Cần chọn ít nhất 1 baseline.' });
  if (list.length > MAX_BASELINES) errors.push({ message: `Tối đa ${MAX_BASELINES} baseline.` });
  if (new Set(list.map((b) => b.metricKey)).size !== list.length) errors.push({ message: 'Baseline bị trùng.' });
  for (const b of list) {
    const def = getMetricDef(b.metricKey);
    if (!def) errors.push({ message: `Chỉ số ${b.metricKey} không có trong danh mục.` });
    else if (!(b.weight >= 1 && b.weight <= 100)) errors.push({ message: `Trọng số "${def.name}" phải từ 1% đến 100%.` });
    else if (!def.budget && !(b.targetMonthly > 0)) errors.push({ message: `Mục tiêu "${def.name}" phải lớn hơn 0.` });
    if (b.source && !['auto', 'manual', 'csv'].includes(b.source)) errors.push({ message: 'Nguồn dữ liệu không hợp lệ.' });
  }
  const { green, red } = thresholds;
  if (!(red >= 0 && green <= 120 && red < green)) errors.push({ message: 'Ngưỡng không hợp lệ: cần 0 ≤ Báo động < Tốt ≤ 120.' });
  return errors;
}

export function parseBaselines(body) {
  return {
    list: (body.baselines || []).map((b) => ({ metricKey: String(b.metricKey), weight: Number(b.weight),
      targetMonthly: getMetricDef(String(b.metricKey))?.budget ? 1 : Number(b.targetMonthly),
      source: b.source ?? null, period: ['day', 'week', 'month'].includes(b.period) ? b.period : 'month' })),
    sourceDate: /^\d{4}-\d{2}-\d{2}$/.test(body.sourceDate || '') ? body.sourceDate : null,
    thresholds: { green: Number(body.thresholds?.green), red: Number(body.thresholds?.red) },
  };
}

/**
 * Save baselines/thresholds as a new version "Hiệu lực từ tháng" `effectiveDate` (first day of an open month):
 * earlier months keep the targets that applied to them. Each difference is recorded in the change history.
 */
export function writeBaselines(db, projectId, list, thresholds, actor, reason, effectiveDate) {
  const oldList = getBaselines(db, projectId);
  const oldTh = getThresholds(db, projectId);
  tx(db, () => {
    db.prepare('INSERT INTO baseline_versions (project_id, effective_date, data, created_at, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(projectId, effectiveDate, JSON.stringify({ list: list.map(({ metricKey, weight, targetMonthly }) => ({ metricKey, weight, targetMonthly })),
        thresholds: { green: thresholds.green, red: thresholds.red } }), new Date().toISOString(), actor);

    const log = (field, o, n) => logChange(db, { projectId, actor, action: 'Baseline & trọng số', field, oldValue: o, newValue: n, reason, effectiveDate });
    const name = (k) => getMetricDef(k)?.name ?? k;
    const num = (v) => formatNumber(v, Number.isInteger(v) ? 0 : 2);
    for (const b of list) {
      const prev = oldList.find((x) => x.metricKey === b.metricKey);
      if (!prev) { log(`Thêm baseline ${name(b.metricKey)}`, '—', `Trọng số ${num(b.weight)}% · mục tiêu ${num(b.targetMonthly)}`); continue; }
      if (prev.weight !== b.weight) log(`Trọng số ${name(b.metricKey)}`, `${num(prev.weight)}%`, `${num(b.weight)}%`);
      if (prev.targetMonthly !== b.targetMonthly) log(`Mục tiêu/tháng ${name(b.metricKey)}`, num(prev.targetMonthly), num(b.targetMonthly));
    }
    for (const prev of oldList) if (!list.some((b) => b.metricKey === prev.metricKey)) log(`Bỏ baseline ${name(prev.metricKey)}`, `Trọng số ${num(prev.weight)}%`, '—');
    const order = (l) => l.map((b) => getMetricDef(b.metricKey)?.short ?? b.metricKey).join(' → ');
    const sameSet = oldList.length === list.length && oldList.every((b) => list.some((x) => x.metricKey === b.metricKey));
    if (sameSet && order(oldList) !== order(list)) log('Thứ tự hiển thị', order(oldList), order(list));
    if (oldTh.green !== thresholds.green) log('Ngưỡng Tốt', `> ${num(oldTh.green)}%`, `> ${num(thresholds.green)}%`);
    if (oldTh.red !== thresholds.red) log('Ngưỡng Báo động', `< ${num(oldTh.red)}%`, `< ${num(thresholds.red)}%`);
  });
  return { baselines: getBaselines(db, projectId), thresholds: getThresholds(db, projectId) };
}
