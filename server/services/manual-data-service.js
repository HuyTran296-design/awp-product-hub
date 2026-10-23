// Manual data ("Nhập thủ công") and effective-dated baseline sources.
//
// - A manual baseline is evaluated on its own period (day / week / month): the period containing the
//   evaluation date, else the latest entered one. When the latest ENDED period has no value by
//   end + 3 days it becomes "Chưa cập nhật" (excluded from the score).
// - For finance, charts and source switches, manual values are expanded to daily values
//   (cumulative metrics spread evenly over the period, rates/averages repeated).
// - Values carry a platform: 'all' (the whole metric) or a platform without connector, e.g. Doanh thu – YouTube
//   Playables (metric revenue, platform playables). Without a platform, the project's default is used (manualPlatformOf).

import { monthEnd } from '../../shared/closing.js';
import { formatDate, formatNumber } from '../../shared/format.js';
import { getMetricDef, MANUAL_PERIODS, manualPlatformOf, sourceLabel } from '../../shared/metric-catalog.js';
import { addDays, dateList, daysBetween, parseIsoDate } from '../../shared/periods.js';
import { BEGINNING, getProject, tx } from '../database.js';
import { logChange } from './audit-log.js';
import { httpError } from './connection-service.js';

export const MANUAL_GRACE_DAYS = 3;

/** Period of `type` containing `date`: { type, start, end, label }. Weeks start on Monday. */
export function periodOf(date, type) {
  if (type === 'day') return { type, start: date, end: date, label: formatDate(date) };
  if (type === 'week') {
    const dow = (parseIsoDate(date).getDay() + 6) % 7;
    const start = addDays(date, -dow);
    const end = addDays(start, 6);
    return { type, start, end, label: `Tuần ${formatDate(start).slice(0, 5)}–${formatDate(end)}` };
  }
  const ym = date.slice(0, 7);
  return { type: 'month', start: `${ym}-01`, end: monthEnd(ym), label: `Tháng ${ym.slice(5)}/${ym.slice(0, 4)}` };
}

export const previousPeriod = (p) => periodOf(addDays(p.start, -1), p.type);
export const deadlineOf = (p) => addDays(p.end, MANUAL_GRACE_DAYS);

export class ManualDataService {
  constructor(db) {
    this.db = db;
    this.stmtSources = db.prepare(`SELECT source, manual_period, effective_date, created_at, created_by FROM baseline_sources
      WHERE project_id = ? AND metric_key = ? ORDER BY effective_date, id`);
    this.stmtCurrent = db.prepare(`SELECT * FROM manual_values WHERE project_id = ? AND metric_key = ? AND platform = ?
      AND replaced_at IS NULL ORDER BY period_start`);
  }

  // ---------- Sources ----------

  /** Effective-dated sources of a baseline, oldest first. Without any row: the metric's native source. */
  sources(projectId, metricKey) {
    const rows = this.stmtSources.all(projectId, metricKey).map((r) => ({
      source: r.source, period: r.manual_period, effectiveDate: r.effective_date, createdAt: r.created_at, createdBy: r.created_by,
      label: sourceLabel(metricKey, r.source),
    }));
    if (rows.length) return rows;
    const def = getMetricDef(metricKey);
    if (!def) return [];
    const source = def.nativeSource === 'manual' ? 'manual' : 'auto';
    return [{ source, period: 'month', effectiveDate: BEGINNING, label: sourceLabel(metricKey, source) }];
  }

  sourceAt(projectId, metricKey, date) {
    const rows = this.sources(projectId, metricKey);
    return [...rows].reverse().find((r) => r.effectiveDate <= date) ?? rows[0] ?? null;
  }

  /** Source changes inside [from, to] — drawn as "Đổi nguồn: …" markers. */
  sourceChanges(projectId, metricKey, from, to) {
    return this.sources(projectId, metricKey).filter((r, i) => i > 0 && r.effectiveDate >= from && r.effectiveDate <= to)
      .map((r) => ({ date: r.effectiveDate, label: `Đổi nguồn: ${r.label}` }));
  }

  /** Change a baseline's source from `effectiveDate` (data before it keeps the old source). */
  setSource(projectId, metricKey, source, period, effectiveDate, actor) {
    const prev = this.sourceAt(projectId, metricKey, effectiveDate);
    if (prev && prev.source === source && (source !== 'manual' || prev.period === period)) return false;
    this.db.prepare(`INSERT INTO baseline_sources (project_id, metric_key, source, manual_period, effective_date, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(projectId, metricKey, source, period, effectiveDate, new Date().toISOString(), actor);
    const label = (s, p) => `${sourceLabel(metricKey, s)}${s === 'manual' ? ` (${MANUAL_PERIODS[p].toLowerCase()})` : ''}`;
    logChange(this.db, { projectId, actor, action: 'Baseline & trọng số', field: `Nguồn ${getMetricDef(metricKey).name}`,
      oldValue: prev ? label(prev.source, prev.period) : '—', newValue: label(source, period), effectiveDate });
    return true;
  }

  // ---------- Values ----------

  /** Platform the values of `metricKey` are kept under when none is given. */
  defaultPlatform(projectId, metricKey) {
    return manualPlatformOf(metricKey, getProject(this.db, projectId)?.platforms ?? []);
  }

  currentValues(projectId, metricKey, platform = this.defaultPlatform(projectId, metricKey)) {
    return this.stmtCurrent.all(projectId, metricKey, platform).map(mapValue);
  }

  valueFor(projectId, metricKey, periodStart, platform) {
    return this.currentValues(projectId, metricKey, platform).find((v) => v.periodStart === periodStart) ?? null;
  }

  history(projectId, metricKey, platform = this.defaultPlatform(projectId, metricKey)) {
    return this.db.prepare('SELECT * FROM manual_values WHERE project_id = ? AND metric_key = ? AND platform = ? ORDER BY id DESC')
      .all(projectId, metricKey, platform).map(mapValue);
  }

  /** Save values (each replaces the current value of its period; the old one stays in history). */
  save(projectId, entries, actor) {
    const project = getProject(this.db, projectId);
    if (!project) throw httpError(404, 'Không tìm thấy dự án');
    const errors = [];
    const clean = entries.filter((e) => e.value !== '' && e.value != null).map((e) => {
      const def = getMetricDef(e.metricKey);
      const value = Number(e.value);
      if (!def) errors.push(`Chỉ số ${e.metricKey} không có trong danh mục.`);
      else if (!Number.isFinite(value) || value < 0) errors.push(`${def.name}: giá trị không hợp lệ.`);
      if (!MANUAL_PERIODS[e.periodType] || !/^\d{4}-\d{2}-\d{2}$/.test(e.periodStart || '')) errors.push('Kỳ nhập không hợp lệ.');
      const platform = e.platform ?? (def ? this.defaultPlatform(projectId, e.metricKey) : 'all');
      if (def && platform !== 'all' && !def.manualPlatforms?.includes(platform)) errors.push(`${def.name}: nền tảng ${platform} không nhập thủ công được.`);
      return { metricKey: e.metricKey, platform, periodType: e.periodType, periodStart: periodOf(e.periodStart, e.periodType).start, value };
    });
    if (errors.length) throw httpError(422, errors[0], errors.map((message) => ({ message })));
    const now = new Date().toISOString();
    tx(this.db, () => {
      for (const e of clean) {
        const old = this.valueFor(projectId, e.metricKey, e.periodStart, e.platform);
        if (old && old.value === e.value) continue;
        if (old) this.db.prepare('UPDATE manual_values SET replaced_at = ? WHERE id = ?').run(now, old.id);
        this.db.prepare(`INSERT INTO manual_values (project_id, metric_key, platform, period_type, period_start, value, entered_by, entered_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(projectId, e.metricKey, e.platform, e.periodType, e.periodStart, e.value, actor, now);
        logChange(this.db, { projectId, actor, action: 'Cập nhật số liệu',
          field: `${manualFieldName(e.metricKey, e.platform)} · ${periodOf(e.periodStart, e.periodType).label}`,
          oldValue: old ? formatNumber(old.value, 2) : '—', newValue: formatNumber(e.value, 2) });
      }
    });
    return clean.length;
  }

  /**
   * Manual baseline value for evaluation date `asOf` (period end of the filter) as seen on `today`.
   * status: ok | pending (current period not entered yet, within the deadline) | stale (overdue → "Chưa cập nhật")
   */
  evaluate(projectId, metricKey, periodType, asOf, today, since = BEGINNING, platform = undefined) {
    const values = this.currentValues(projectId, metricKey, platform);
    const lastEnded = previousPeriod(periodOf(today, periodType));
    // Only periods since the baseline became manual have to be entered.
    const overdue = lastEnded.end >= since && today > deadlineOf(lastEnded) && !values.some((v) => v.periodStart === lastEnded.start);
    const cur = periodOf(asOf, periodType);
    if (overdue && asOf >= lastEnded.start) {
      return { status: 'stale', value: null, missing: lastEnded, deadline: deadlineOf(lastEnded) };
    }
    const used = values.find((v) => v.periodStart === cur.start) ?? [...values].reverse().find((v) => v.periodStart <= cur.start);
    if (!used) return { status: 'pending', value: null, period: cur, deadline: deadlineOf(cur) };
    const period = periodOf(used.periodStart, periodType);
    const prev = values.find((v) => v.periodStart === previousPeriod(period).start) ?? null;
    return {
      status: 'ok', value: used.value, prevValue: prev?.value ?? null, period, enteredBy: used.enteredBy, enteredAt: used.enteredAt,
      next: used.periodStart === cur.start ? null : { period: cur, deadline: deadlineOf(cur) },
    };
  }

  /** Daily expansion of manual values over [from, to] (Map date → value). */
  expand(projectId, metricKey, from, to, platform = undefined) {
    const def = getMetricDef(metricKey);
    const out = new Map();
    for (const v of this.currentValues(projectId, metricKey, platform)) {
      const p = periodOf(v.periodStart, v.periodType);
      if (p.end < from || p.start > to) continue;
      const days = daysBetween(p.start, p.end) + 1;
      const perDay = def?.aggregation === 'sum' ? v.value / days : v.value;
      for (const d of dateList(p.start > from ? p.start : from, p.end < to ? p.end : to)) out.set(d, perDay);
    }
    return out;
  }
}

/** "Doanh thu – YouTube Playables" for a platform part, else the metric name. */
export function manualFieldName(metricKey, platform = 'all') {
  const name = getMetricDef(metricKey)?.name ?? metricKey;
  return platform === 'playables' ? `${name} – YouTube Playables` : name;
}

function mapValue(r) {
  return { id: r.id, metricKey: r.metric_key, platform: r.platform, periodType: r.period_type, periodStart: r.period_start, value: r.value,
    enteredBy: r.entered_by, enteredAt: r.entered_at, replacedAt: r.replaced_at };
}

