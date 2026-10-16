// Aggregates DataSource daily series into period values, per-platform breakdowns and chart series.

import { getMetricDef } from '../../shared/metric-catalog.js';
import { addDays, dateList } from '../../shared/periods.js';

export class MetricService {
  /** @param {import('../data-sources/data-source.js').DataSource} dataSource */
  /**
   * @param {import('./manual-data-service.js').ManualDataService} [manual] effective-dated sources + manual values
   * @param {(projectId:number)=>string[]} [platformsOf] the project's release platforms
   */
  constructor(dataSource, getUsdRate, manual = null, platformsOf = null) {
    this.ds = dataSource;
    this.getUsdRate = getUsdRate;
    this.manual = manual;
    this.platformsOf = platformsOf;
  }

  /**
   * Platforms a metric is read from for this project: its own platforms limited to the project's release
   * platforms (iOS/Android), plus "extra" platforms mapped to another metric (e.g. revenue ← Playables ad share).
   * Extras are optional: a day without Playables data counts as 0 for summed metrics.
   */
  platformsFor(projectId, def) {
    const rel = this.platformsOf?.(projectId);
    const base = rel ? def.platforms.filter((p) => !['ios', 'android'].includes(p) || rel.includes(p)) : def.platforms;
    const extras = rel ? Object.entries(def.extra ?? {}).filter(([p]) => rel.includes(p)).map(([platform, key]) => ({ platform, key })) : [];
    return { base, extras, all: [...base, ...extras.map((e) => e.platform)] };
  }

  async platformMaps(projectId, def, metricKey, from, to) {
    const pf = this.platformsFor(projectId, def);
    const maps = {};
    for (const p of pf.base) maps[p] = await this.dailyMap(projectId, metricKey, from, to, p);
    for (const e of pf.extras) {
      const sub = getMetricDef(e.key);
      maps[e.platform] = await this.dailyMap(projectId, e.key, from, to, sub.platforms[0]);
    }
    return { pf, maps };
  }

  /**
   * Map date -> value for one platform, following the baseline's source on each day:
   * connector/CSV days read metric_daily (Store revenue converted USD → VND), manual days use the
   * expanded manual values (split evenly across platforms for summed metrics).
   */
  async dailyMap(projectId, metricKey, from, to, platform) {
    const def = getMetricDef(metricKey);
    const segments = this.manual && def ? this.manual.sources(projectId, metricKey) : [];
    if (!segments.some((s) => s.source === 'manual')) return this.dataMap(projectId, metricKey, from, to, platform);
    const out = new Map();
    for (let i = 0; i < segments.length; i++) {
      const segFrom = segments[i].effectiveDate > from ? segments[i].effectiveDate : from;
      const next = segments[i + 1]?.effectiveDate;
      const segTo = next && addDays(next, -1) < to ? addDays(next, -1) : to;
      if (segFrom > segTo) continue;
      if (segments[i].source === 'manual') {
        const share = def.platformCombine === 'sum' ? 1 / def.platforms.length : 1;
        for (const [d, v] of this.manual.expand(projectId, metricKey, segFrom, segTo)) out.set(d, v * share);
      } else {
        for (const [d, v] of await this.dataMap(projectId, metricKey, segFrom, segTo, platform)) out.set(d, v);
      }
    }
    return out;
  }

  async dataMap(projectId, metricKey, from, to, platform) {
    const rows = await this.ds.getMetric(projectId, metricKey, from, to, platform);
    // Store proceeds/earnings arrive in USD; everything else is already in its unit.
    const k = metricKey === 'revenue' && (platform === 'ios' || platform === 'android') ? this.getUsdRate() : 1;
    return new Map(rows.map((r) => [r.date, r.value * k]));
  }

  /**
   * Period value of a catalog metric.
   * @returns {{value:number|null, byPlatform:Object<string,number|null>, complete:boolean}}
   */
  async aggregate(projectId, metricKey, from, to) {
    const def = getMetricDef(metricKey);
    const dates = dateList(from, to);
    if (def.platformCombine === 'derived') {
      const num = await this.aggregatePlain(projectId, def.numerator, from, to, def.platforms);
      const den = await this.aggregatePlain(projectId, def.denominator, from, to, def.platforms);
      const ratio = (a, b) => (b ? (a / b) * 100 : null);
      return {
        value: ratio(num.total, den.total),
        byPlatform: Object.fromEntries(def.platforms.map((p) => [p, ratio(num.byPlatform[p], den.byPlatform[p])])),
        complete: num.complete && den.complete,
      };
    }

    const { pf, maps } = await this.platformMaps(projectId, def, metricKey, from, to);
    const required = pf.base.length ? pf.base : pf.all;
    const covered = dates.filter((d) => required.every((p) => maps[p].has(d)));
    const complete = covered.length === dates.length;
    if (!covered.length) return { value: null, byPlatform: {}, complete: false };

    const valueOn = (p, d) => maps[p].get(d) ?? (pf.base.includes(p) ? undefined : 0);
    const combineDay = (d) => {
      const vals = pf.all.map((p) => valueOn(p, d));
      const s = vals.reduce((a, v) => a + v, 0);
      return def.platformCombine === 'mean' ? s / vals.length : s;
    };
    const reduce = (valueOf) => {
      if (def.aggregation === 'sum') return covered.reduce((s, d) => s + valueOf(d), 0);
      if (def.aggregation === 'latest') return valueOf(covered[covered.length - 1]);
      return covered.reduce((s, d) => s + valueOf(d), 0) / covered.length; // avg & ratio
    };
    const byPlatform = pf.all.length > 1
      ? Object.fromEntries(pf.all.map((p) => [p, reduce((d) => valueOn(p, d))]))
      : {};
    return { value: reduce(combineDay), byPlatform, complete };
  }

  /** Sum of a non-catalog metric over platforms (e.g. web_sessions, ch_installs:facebook). */
  async aggregatePlain(projectId, metricKey, from, to, platforms) {
    const days = dateList(from, to).length;
    const byPlatform = {};
    let total = 0;
    let complete = true;
    for (const p of platforms) {
      const m = await this.dailyMap(projectId, metricKey, from, to, p);
      if (m.size < days) complete = false;
      byPlatform[p] = [...m.values()].reduce((a, v) => a + v, 0);
      total += byPlatform[p];
    }
    return { total, byPlatform, complete };
  }

  /** Combined daily series of a catalog metric: [{date, value}] (null when missing). */
  async dailyCombined(projectId, metricKey, from, to) {
    const def = getMetricDef(metricKey);
    const dates = dateList(from, to);
    if (def.platformCombine === 'derived') {
      const num = await this.dailyPlain(projectId, def.numerator, from, to, def.platforms);
      const den = await this.dailyPlain(projectId, def.denominator, from, to, def.platforms);
      return dates.map((d, i) => ({ date: d, value: den[i].value ? (num[i].value / den[i].value) * 100 : null }));
    }
    const { pf, maps } = await this.platformMaps(projectId, def, metricKey, from, to);
    const required = pf.base.length ? pf.base : pf.all;
    return dates.map((d) => {
      if (required.some((p) => !maps[p].has(d))) return { date: d, value: null };
      const vals = pf.all.map((p) => maps[p].get(d) ?? 0);
      const s = vals.reduce((a, v) => a + v, 0);
      return { date: d, value: def.platformCombine === 'mean' ? s / vals.length : s };
    });
  }

  /** Daily series summed over platforms for a non-catalog metric. */
  async dailyPlain(projectId, metricKey, from, to, platforms) {
    const maps = [];
    for (const p of platforms) maps.push(await this.dailyMap(projectId, metricKey, from, to, p));
    return dateList(from, to).map((d) => ({
      date: d,
      value: maps.every((m) => m.has(d)) ? maps.reduce((s, m) => s + m.get(d), 0) : null,
    }));
  }
}
