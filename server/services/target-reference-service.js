// "Tham chiếu" for monthly targets (wizard step "Baseline & trọng số" and the edit tab): closed-month values of each
// baseline from the source chosen for it, statistics, break-even, other projects' first launch month.

import { addMonths, lastClosedMonth, monthEnd } from '../../shared/closing.js';
import { stateAt } from '../../shared/cost-timeline.js';
import { rawAchievement, statusFor } from '../../shared/health-score.js';
import { getMetricDef, revenueMetricFor, sourceLabel } from '../../shared/metric-catalog.js';
import { referenceStats } from '../../shared/target-reference.js';
import { todayIso } from '../clock.js';
import { getBaselines, getProject, getThresholds, listProjects, loadTimeline } from '../database.js';

const MONTHS = 13; // 6 for the statistics, 13 for "Cùng kỳ năm trước"

export class TargetReferenceService {
  constructor({ db, metrics, manual }) {
    this.db = db;
    this.metrics = metrics;
    this.manual = manual;
  }

  /** Metric service reading `metricKey` from one fixed source (the one picked in the form, saved or not). */
  metricsFor(source) {
    if (!source) return this.metrics;
    const manual = this.manual;
    const forced = Object.create(this.metrics);
    forced.manual = {
      sources: () => [{ source: source === 'manual' ? 'manual' : 'auto', effectiveDate: '2000-01-01' }],
      expand: (...a) => manual.expand(...a),
      defaultPlatform: (...a) => manual.defaultPlatform(...a),
    };
    return forced;
  }

  /** Value of a closed calendar month (sum metrics: total; avg / ratio: average; latest: last value). */
  async monthValue(projectId, metricKey, ym, source = null) {
    const r = await this.metricsFor(source).aggregate(projectId, metricKey, `${ym}-01`, monthEnd(ym));
    return r.value;
  }

  async monthSeries(projectId, metricKey, source, count = MONTHS, since = null) {
    const last = lastClosedMonth(todayIso());
    const out = [];
    for (let i = count - 1; i >= 0; i--) {
      const ym = addMonths(last, -i);
      if (since && `${ym}-31` < since) continue;
      out.push({ month: ym, value: await this.monthValue(projectId, metricKey, ym, source) });
    }
    return out;
  }

  /** Target in force for `metricKey` in month `ym` and the achievement / color it gave that month. */
  appliedTarget(projectId, metricKey, ym, value) {
    const b = getBaselines(this.db, projectId, monthEnd(ym)).find((x) => x.metricKey === metricKey);
    if (!b) return null;
    const def = getMetricDef(metricKey);
    const raw = value == null ? null : rawAchievement(value, b.targetMonthly, def.direction);
    const pct = raw == null ? null : Math.round(raw * 10) / 10;
    return { target: b.targetMonthly, pct, status: statusFor(pct, getThresholds(this.db, projectId, monthEnd(ym))) };
  }

  /** Monthly cost under today's configuration — the "Hòa vốn" revenue target. */
  monthlyCost(projectId) {
    return stateAt(loadTimeline(this.db), todayIso()).costs.projects[projectId]?.total ?? 0;
  }

  /**
   * "Các dự án khác ở tháng đầu ra mắt": each other project's first complete closed month (from its first
   * "Đang chạy" date) with a value → average, min, max.
   */
  async siblings(excludeId, metricKey) {
    const timeline = loadTimeline(this.db);
    const last = lastClosedMonth(todayIso());
    const values = [];
    for (const p of listProjects(this.db).filter((x) => x.id !== excludeId)) {
      const start = timeline.versions.filter((v) => v.entity === 'status' && v.entityId === p.id && v.data.status === 'active')
        .map((v) => v.effectiveDate).sort()[0];
      if (!start) continue;
      let ym = start.slice(8) === '01' ? start.slice(0, 7) : addMonths(start.slice(0, 7), 1);
      for (; ym <= last; ym = addMonths(ym, 1)) {
        // Only a month with complete data counts (the sample data starts mid-month).
        const r = await this.metrics.aggregate(p.id, metricKey, `${ym}-01`, monthEnd(ym));
        if (r.value != null && r.complete) { values.push({ id: p.id, name: p.name, month: ym, value: r.value }); break; }
      }
    }
    if (!values.length) return null;
    const vals = values.map((x) => x.value);
    return { count: values.length, items: values,
      avg: vals.reduce((s, v) => s + v, 0) / vals.length, min: Math.min(...vals), max: Math.max(...vals) };
  }

  /**
   * @param {{projectId?:number|null, metrics:{metricKey:string, source?:string}[], breakEven?:number|null}} q
   *   breakEven: monthly cost of a project not created yet (wizard preview)
   */
  async references(q) {
    const project = q.projectId ? getProject(this.db, q.projectId) : null;
    const out = {};
    for (const m of q.metrics ?? []) {
      const def = getMetricDef(m.metricKey);
      if (!def || def.budget) continue;
      const source = m.source === 'manual' ? 'manual' : m.source === 'csv' ? 'csv' : 'auto';
      const months = project ? await this.monthSeries(project.id, m.metricKey, source) : [];
      const stats = referenceStats(months);
      for (const x of stats.months) Object.assign(x, { applied: this.appliedTarget(project.id, m.metricKey, x.month, x.value) });
      const isRevenue = m.metricKey === revenueMetricFor(project?.productType);
      out[m.metricKey] = {
        metricKey: m.metricKey, source, sourceText: `Tính từ ${sourceLabel(m.metricKey, source)}, các tháng đã chốt`,
        stats, unit: def.unit, direction: def.direction,
        breakEven: isRevenue ? (project ? this.monthlyCost(project.id) : q.breakEven ?? null) : null,
        siblings: !stats.count ? await this.siblings(project?.id ?? null, m.metricKey) : null,
        lastClosed: lastClosedMonth(todayIso()),
      };
    }
    return { references: out };
  }
}
