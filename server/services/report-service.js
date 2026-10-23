// Builds the payloads for Dashboard, Project overview and Marketing pages.
// Costs come from the effective-dated timeline: a period's cost is its day-weighted average monthly
// cost × the period factor, so changes only affect the dates they are effective for.
// Per-person cost is only included for admins.

import { periodCosts, PROJECT_STATUSES, stateAt } from '../../shared/cost-timeline.js';
import { scoreProject } from '../../shared/health-score.js';
import { getMetricDef, PLAYABLES, PLAYABLES_REVENUE_NOTE, revenueMetricFor } from '../../shared/metric-catalog.js';
import {
  addDays, costFactor, daysBetween, getPeriod, isWorkingDay, periodRange,
} from '../../shared/periods.js';
import { todayIso, yesterday } from '../clock.js';
import { WORKING_DAYS } from '../../shared/system-config.js';
import { budgetInfo, costStartDate, cumulativeCost, phaseAt } from './phase-service.js';
import { percentChange } from '../../shared/format.js';
import { getBaselines, getProject, getThresholds, listProjects, loadTimeline } from '../database.js';
import { CHANNELS } from '../data-sources/mock-data-generator.js';
import { listPromoSources } from './promo-source-service.js';
import { httpError } from './connection-service.js';

const MIN_CHART_DAYS = 14;
const ZERO_COST = { total: 0, direct: 0, tools: 0, fte: 0, teamPct: 0 };
/** Statuses shown on the Dashboard; archived/draft/deleted projects are hidden. */
export const DASHBOARD_STATUSES = ['active', 'paused'];

export class ReportService {
  constructor({ db, dataSource, metrics, manual }) {
    this.db = db;
    this.ds = dataSource;
    this.metrics = metrics;
    this.manual = manual;
  }

  /** Timeline + costs for the current and previous period of `range`. */
  costContext(range, periodKey) {
    const timeline = loadTimeline(this.db);
    const per = periodCosts(timeline, range.from, range.to);
    const prev = periodCosts(timeline, range.prevFrom, range.prevTo);
    return {
      timeline, per, prev,
      endState: stateAt(timeline, range.to),
      factor: costFactor(periodKey, per.workingDays),
      prevFactor: costFactor(periodKey, prev.workingDays),
    };
  }

  /** Last date with complete data across the given projects (default: yesterday). */
  async endDate(projects) {
    const dates = [];
    for (const p of projects) dates.push(await this.ds.getLatestCompleteDate(p.id));
    const valid = dates.filter(Boolean).sort();
    return valid[0] ?? yesterday();
  }

  lastUpdated(projectIds) {
    if (!projectIds.length) return null;
    const ph = projectIds.map(() => '?').join(',');
    return this.db.prepare(`SELECT MAX(last_synced_at) AS t FROM connections WHERE project_id IN (${ph})`)
      .get(...projectIds).t;
  }

  rangeInfo(periodKey, end, projectIds) {
    const r = periodRange(periodKey, end);
    return { period: getPeriod(periodKey).key, label: getPeriod(periodKey).label, ...r,
      lastUpdated: this.lastUpdated(projectIds) };
  }

  /** Revenue (VND) of the latest 30-day window — used as the monthly run-rate in lifecycle previews. */
  async monthRevenue(projectId) {
    const project = getProject(this.db, projectId);
    const end = await this.endDate([project]);
    const r = periodRange('month', end);
    return { from: r.from, to: r.to, value: (await this.metrics.aggregate(projectId, revenueMetricFor(project.productType), r.from, r.to)).value };
  }

  /**
   * One baseline in the filtered period. Manual baselines use their own period (day/week/month) and may be
   * "Chưa cập nhật" (stale); connector/CSV baselines aggregate the filtered range.
   */
  async baselineValue(project, b, range, today) {
    const src = this.manual.sourceAt(project.id, b.metricKey, range.to);
    const info = { source: src?.source ?? 'auto', sourceLabel: src?.label, manualPeriod: src?.period };
    if (src?.source === 'manual') {
      const m = this.manual.evaluate(project.id, b.metricKey, src.period, range.to, today, src.effectiveDate);
      // Values kept on one platform (Game B's Doanh thu on YouTube Playables): the panel still splits iOS · Android · Playables.
      const mp = this.manual.defaultPlatform(project.id, b.metricKey);
      const byPlatform = mp === 'all' || m.value == null ? {} : Object.fromEntries(getMetricDef(b.metricKey).platforms
        .filter((p) => project.platforms.includes(p)).map((p) => [p, p === mp ? m.value : 0]));
      return { ...info, value: m.value, prevValue: m.prevValue ?? null, prevComplete: m.prevValue != null, byPlatform,
        periodKey: src.period, manual: m, stale: m.status === 'stale' };
    }
    const cur = await this.metrics.aggregate(project.id, b.metricKey, range.from, range.to);
    const prev = await this.metrics.aggregate(project.id, b.metricKey, range.prevFrom, range.prevTo);
    return { ...info, value: cur.value, byPlatform: cur.byPlatform, prevValue: prev.value, prevComplete: prev.complete, periodKey: null };
  }

  /** Health score + finance for one project in current and previous period. */
  async projectSummary(project, periodKey, range, ctx) {
    const today = todayIso();
    // Targets, weights and thresholds in force at the end of the period.
    const baselines = getBaselines(this.db, project.id, range.to);
    const thresholds = getThresholds(this.db, project.id, range.to);
    const budget = budgetInfo(this.db, project.id, today, this.manual);
    const vals = {};
    for (const b of baselines) vals[b.metricKey] = await this.baselineValue(project, b, range, today);
    const pick = (k) => Object.fromEntries(Object.entries(vals).map(([key, v]) => [key, v[k]]));
    const periodKeys = Object.fromEntries(Object.entries(vals).filter(([, v]) => v.periodKey).map(([k, v]) => [k, v.periodKey]));
    // "Chi phí lũy kế": lower is better against the budget planned to date.
    const targets = budget.inBuild && budget.plannedToDate ? { budget_burn: budget.plannedToDate } : {};
    if ('budget_burn' in vals && !budget.inBuild) vals.budget_burn.value = null;
    const score = scoreProject(baselines, pick('value'), periodKey, thresholds, { periodKeys, targets });
    const prevScore = scoreProject(baselines, pick('prevValue'), periodKey, thresholds, { periodKeys, targets });

    const revenueKey = revenueMetricFor(project.productType);
    const rev = await this.metrics.aggregate(project.id, revenueKey, range.from, range.to);
    const revPrev = await this.metrics.aggregate(project.id, revenueKey, range.prevFrom, range.prevTo);
    const pc = ctx.per.projects[project.id] ?? ZERO_COST;
    const cost = pc.total * ctx.factor;
    const costPrev = (ctx.prev.projects[project.id] ?? ZERO_COST).total * ctx.prevFactor;
    const profit = (rev.value ?? 0) - cost;
    const profitPrev = revPrev.complete ? revPrev.value - costPrev : null;
    const lifecycle = ctx.endState.statuses[project.id];
    const ph = phaseAt(this.db, project.id, today);

    return {
      id: project.id, slug: project.slug, name: project.name, color: project.color, platforms: project.platforms,
      productType: project.productType, phase: ph.phase, phaseLabel: ph.label, budget,
      thresholds, lifecycle, lifecycleLabel: PROJECT_STATUSES[lifecycle] ?? null,
      score: score.score, status: score.status, scoreUsed: score.used, scoreTotal: score.total,
      scoreDelta: Object.values(vals).every((v) => v.prevComplete) && prevScore.score != null && score.score != null ? score.score - prevScore.score : null,
      baselines: score.items.map((i) => {
        const def = getMetricDef(i.metricKey);
        const v = vals[i.metricKey];
        return {
          metricKey: i.metricKey, name: def.name, short: def.short, unit: def.unit, direction: def.direction,
          aggregation: def.aggregation, budget: Boolean(def.budget), note: def.note ?? null,
          weight: i.weight, targetMonthly: i.targetMonthly, target: i.target, actual: i.actual, pct: i.pct, status: i.status,
          byPlatform: v.byPlatform, source: v.source, sourceLabel: v.sourceLabel, manualPeriod: v.manualPeriod,
          stale: Boolean(v.stale), manual: v.manual ?? null, combined: Boolean(v.combined),
          delta: v.prevComplete && v.prevValue != null ? percentChange(i.actual, v.prevValue) : null,
        };
      }),
      revenueMetric: revenueKey,
      revenue: rev.value, revenueByPlatform: rev.byPlatform,
      revenueDelta: revPrev.complete ? percentChange(rev.value, revPrev.value) : null,
      cost, costDirect: pc.direct * ctx.factor, costTools: pc.tools * ctx.factor,
      costMonthly: ctx.endState.costs.projects[project.id]?.total ?? 0,
      profit, profitDelta: profitPrev != null ? percentChange(profit, profitPrev) : null,
      margin: rev.value ? (profit / rev.value) * 100 : null,
      teamPct: pc.teamPct, fte: pc.fte,
    };
  }

  /**
   * Dashboard: one row per project shown (running or paused); team totals add every shown project once.
   * visible: Set of project ids for scoped Viewers (null = all). Scoped Viewers get totals of their projects only.
   */
  async dashboard(periodKey, visible = null) {
    const all = listProjects(this.db).filter((p) => !visible || visible.has(p.id));
    const end = await this.endDate(all);
    const range = this.rangeInfo(periodKey, end, all.map((p) => p.id));
    const ctx = this.costContext(range, periodKey);
    const shown = all.filter((p) => DASHBOARD_STATUSES.includes(ctx.endState.statuses[p.id]));
    const projects = [];
    for (const p of shown) projects.push(await this.projectSummary(p, periodKey, range, ctx));

    const revenue = projects.reduce((s, p) => s + (p.revenue ?? 0), 0);
    let revenuePrev = 0;
    let prevComplete = true;
    for (const p of shown) {
      const r = await this.metrics.aggregate(p.id, revenueMetricFor(p.productType), range.prevFrom, range.prevTo);
      if (r.value == null && !p.sampleData) continue;
      revenuePrev += r.value ?? 0;
      prevComplete &&= r.complete;
    }
    if (visible) {
      // Scoped Viewer: totals of the projects in scope only, no team-wide figures (unallocated cost, other projects' shares).
      const cost = projects.reduce((s, p) => s + p.cost, 0);
      return {
        range, scoped: true, projects, costShare: null,
        team: { revenue, revenueDelta: prevComplete ? percentChange(revenue, revenuePrev) : null, cost, profit: revenue - cost,
          profitDelta: null, unallocated: null, unallocatedPct: null },
      };
    }
    const teamCost = ctx.per.teamTotal * ctx.factor;
    const teamCostPrev = ctx.prev.teamTotal * ctx.prevFactor;
    return {
      range,
      team: {
        revenue, revenueDelta: prevComplete ? percentChange(revenue, revenuePrev) : null,
        cost: teamCost, profit: revenue - teamCost,
        profitDelta: prevComplete ? percentChange(revenue - teamCost, revenuePrev - teamCostPrev) : null,
        unallocated: ctx.per.unallocated * ctx.factor, unallocatedPct: ctx.per.unallocatedPct,
      },
      projects,
      costShare: costShare(ctx.timeline, ctx.per, this.db),
    };
  }

  /** Dự án → Tổng quan. */
  async overview(projectId, periodKey, user) {
    const project = getProject(this.db, projectId);
    if (!project) throw httpError(404, 'Không tìm thấy dự án');
    const end = await this.endDate([project]);
    const range = this.rangeInfo(periodKey, end, [project.id]);
    const ctx = this.costContext(range, periodKey);
    const summary = await this.projectSummary(project, periodKey, range, ctx);

    // Sparklines: at least 14 days of context, weekly means for long periods.
    const sparkFrom = range.days < MIN_CHART_DAYS ? addDays(end, -(MIN_CHART_DAYS - 1)) : range.from;
    for (const b of summary.baselines) {
      const daily = await this.metrics.dailyCombined(project.id, b.metricKey, sparkFrom, end);
      b.sparkline = range.days > 90 ? weeklyMeans(daily) : daily;
      // Detail panel: daily values of exactly the filtered period, plus the data source.
      b.series = sparkFrom === range.from ? daily : daily.filter((d) => d.date >= range.from);
      b.sourceText = b.source === 'auto' ? getMetricDef(b.metricKey).source : b.sourceLabel;
      b.platformCombine = getMetricDef(b.metricKey).platformCombine;
      b.combinedNote = getMetricDef(b.metricKey).combinedNote ?? null;
      b.sourceChanges = this.manual.sourceChanges(project.id, b.metricKey, sparkFrom, end);
      // Manual baselines are charted per entered period (latest 12), matching the value on the card.
      if (b.source === 'manual') b.manualSeries = this.manual.currentValues(project.id, b.metricKey).slice(-12).map((v) => ({ date: v.periodStart, value: v.value }));
    }

    const chart = await this.financeChart(project, periodKey, end, ctx);
    const st = ctx.endState;
    const active = st.statuses[project.id] === 'active';
    const members = (st.staffing[project.id]?.rows ?? []).map((a) => {
      const m = st.members.find((x) => x.id === a.memberId);
      const row = { id: m.id, name: m.name, role: m.role, effortPct: active ? a.effortPct : 0, plannedEffortPct: a.effortPct };
      if (user.role === 'admin') row.monthlyCost = active ? m.monthlyCost * (a.effortPct / 100) : 0;
      return row;
    });
    if (summary.budget?.inBuild) {
      const since = costStartDate(ctx.timeline, project.id);
      summary.cumulative = { since, value: cumulativeCost(this.db, project.id, since, todayIso(), ctx.timeline) };
    }

    if (user.role !== 'admin') {
      // Viewers only see the project's total cost.
      delete summary.costDirect;
      delete summary.costTools;
    }
    return { range, project: summary, chart, members, breakEvenMonthly: summary.costMonthly };
  }

  /**
   * Revenue bars and cost line; each working day costs (monthly cost in force that day) ÷ working days/month,
   * so effective-dated changes show up from their date.
   */
  async financeChart(project, periodKey, end, ctx) {
    const { days } = getPeriod(periodKey);
    const from = addDays(end, -(Math.max(days, MIN_CHART_DAYS) - 1));
    const daily = await this.metrics.dailyCombined(project.id, revenueMetricFor(project.productType), from, end);
    const bucketKey = days > 120 ? (d) => d.slice(0, 7) : days > 31 ? (d) => `w${Math.floor(daysBetween(d, end) / 7)}` : (d) => d;
    const buckets = new Map();
    for (const { date, value } of daily) {
      const k = bucketKey(date);
      if (!buckets.has(k)) buckets.set(k, { key: k, from: date, to: date, revenue: 0, workDays: 0, cost: 0 });
      const b = buckets.get(k);
      b.to = date;
      b.revenue += value ?? 0;
      if (isWorkingDay(date)) {
        b.workDays += 1;
        b.cost += (stateAt(ctx.timeline, date).costs.projects[project.id]?.total ?? 0) / WORKING_DAYS;
      }
    }
    return {
      granularity: days > 120 ? 'month' : days > 31 ? 'week' : 'day',
      extended: days < MIN_CHART_DAYS,
      buckets: [...buckets.values()],
    };
  }

  /** Dự án → Marketing. */
  async marketing(projectId, periodKey) {
    const project = getProject(this.db, projectId);
    if (!project) throw httpError(404, 'Không tìm thấy dự án');
    const live = listProjects(this.db);
    const byId = new Map(live.map((p) => [p.id, p]));
    const segsOf = (from, to) => [[projectId, from, to]];
    const scoped = [...new Set(segsOf('2000-01-01', '9999-12-31').map(([id]) => id))].map((id) => byId.get(id));
    const end = await this.endDate(scoped);
    const range = this.rangeInfo(periodKey, end, scoped.map((p) => p.id));
    // Σ over segments; `only` restricts to one project's segments (promote sources, blog posts belong to one project).
    const sum = async (key, platforms, from = range.from, to = range.to, only = null) => {
      const out = { total: 0, byPlatform: Object.fromEntries(platforms.map((p) => [p, 0])), complete: true };
      for (const [id, a, b] of segsOf(from, to).filter(([id]) => only == null || id === only)) {
        const r = await this.metrics.aggregatePlain(id, key, a, b, platforms);
        out.total += r.total;
        for (const pl of platforms) out.byPlatform[pl] += r.byPlatform[pl] ?? 0;
        if (byId.get(id)?.sampleData !== false) out.complete &&= r.complete;
      }
      return out;
    };
    const daily = async (key, platforms, from, to) => {
      const merged = new Map();
      for (const [id, a, b] of segsOf(from, to)) {
        if (byId.get(id)?.sampleData === false && segsOf(from, to).length > 1) continue;
        for (const d of await this.metrics.dailyPlain(id, key, a, b, platforms)) {
          if (d.value != null) merged.set(d.date, (merged.get(d.date) ?? 0) + d.value);
        }
      }
      const out = [];
      for (let d = from; d <= to; d = addDays(d, 1)) out.push({ date: d, value: merged.has(d) ? merged.get(d) : null });
      return out;
    };
    const has = (pl) => scoped.some((p) => p.platforms.includes(pl));

    // Website KPIs (GA4)
    const web = {};
    for (const [k, key] of [['users', 'web_users'], ['sessions', 'web_sessions'], ['engaged', 'web_engaged_sessions'], ['clicks', 'click_download']]) {
      const cur = await sum(key, ['web']);
      const prev = await sum(key, ['web'], range.prevFrom, range.prevTo);
      web[k] = { value: cur.total, prev: prev.complete ? prev.total : null };
    }
    const rate = (a, b) => (b ? (a / b) * 100 : null);
    const website = {
      users: kpi(web.users.value, web.users.prev),
      sessions: kpi(web.sessions.value, web.sessions.prev),
      engagementRate: kpi(rate(web.engaged.value, web.sessions.value),
        web.sessions.prev != null ? rate(web.engaged.prev, web.sessions.prev) : null, true),
      clicks: kpi(web.clicks.value, web.clicks.prev),
      clickRate: kpi(rate(web.clicks.value, web.sessions.value),
        web.sessions.prev != null ? rate(web.clicks.prev, web.sessions.prev) : null, true),
    };
    const chartFrom = range.days < MIN_CHART_DAYS ? addDays(end, -(MIN_CHART_DAYS - 1)) : range.from;
    const series = {};
    for (const [k, key] of [['users', 'web_users'], ['sessions', 'web_sessions'], ['clicks', 'click_download']]) {
      const d = await daily(key, ['web'], chartFrom, end);
      series[k] = range.days > 90 ? weeklyMeans(d, 'sum') : d;
    }

    // YouTube channel (YouTube Analytics): Playables projects, or any project with the connection configured.
    const isPlayables = scoped.some((p) => p.productType === PLAYABLES || p.platforms.includes('playables'));
    const ytConnected = scoped.some((p) => this.db.prepare("SELECT status FROM connections WHERE project_id = ? AND source = 'youtube'").get(p.id)?.status === 'connected');
    let youtube = null;
    if (isPlayables || ytConnected) {
      const k = {};
      for (const [name, key] of [['views', 'channel_views'], ['hours', 'yt_watch_hours'], ['subs', 'yt_new_subs']]) {
        const cur = await sum(key, ['youtube']);
        const prev = await sum(key, ['youtube'], range.prevFrom, range.prevTo);
        k[name] = kpi(cur.total, prev.complete ? prev.total : null);
      }
      const ser = {};
      for (const [name, key] of [['views', 'channel_views'], ['subs', 'yt_new_subs']]) {
        const d = await daily(key, ['youtube'], chartFrom, end);
        ser[name] = range.days > 90 ? weeklyMeans(d, 'sum') : d;
      }
      youtube = { ...k, series: ser, connected: ytConnected };
    }

    // Acquisition channels (apps only)
    const hasApp = has('ios') || has('android');
    const channels = [];
    for (const c of hasApp ? CHANNELS : []) {
      if (c.promote) { channels.push(await this.promoteChannel(scoped, projectId, c, sum)); continue; }
      const inst = await sum(`ch_installs:${c.key}`, ['ios', 'android']);
      const clicks = c.clickToInstall ? (await sum(`ch_clicks:${c.key}`, ['web'])).total : null;
      channels.push({ key: c.key, name: c.name, color: c.color, source: c.source, clicks,
        ios: inst.byPlatform.ios, android: inst.byPlatform.android, total: inst.total,
        clickToInstall: clicks ? (inst.total / clicks) * 100 : null });
    }
    const channelTotal = channels.reduce((s, c) => s + c.total, 0);
    for (const c of channels.flatMap((x) => [x, ...(x.children ?? [])])) c.share = channelTotal ? (c.total / channelTotal) * 100 : 0;

    // Blog top 5 by views (posts of every project in scope)
    const posts = [];
    for (const p of scoped.filter((x) => x.platforms.includes('blog'))) {
      for (const post of await this.ds.listBlogPosts(p.id)) {
        const views = (await sum(`blog_views:${post.slug}`, ['web'], range.from, range.to, p.id)).total;
        const clicks = await sum(`blog_clicks:${post.slug}`, ['ios', 'android'], range.from, range.to, p.id);
        const installs = (await sum(`blog_installs:${post.slug}`, ['all'], range.from, range.to, p.id)).total;
        posts.push({ slug: post.slug, title: post.title, project: p.id === projectId ? null : p.name, views, clicks: clicks.total,
          ctr: views ? (clicks.total / views) * 100 : null,
          clicksIos: clicks.byPlatform.ios, clicksAndroid: clicks.byPlatform.android, installs });
      }
    }
    posts.sort((a, b) => b.views - a.views);

    return {
      range,
      project: { id: project.id, name: project.name, color: project.color, platforms: project.platforms },
      hasWeb: has('web'), website, websiteSeries: { granularity: range.days > 90 ? 'week' : 'day', ...series },
      youtube, productType: project.productType,
      note: isPlayables ? PLAYABLES_REVENUE_NOTE : null,
      channels: hasApp ? channels : null, channelTotal, blog: has('blog') ? posts.slice(0, 5) : null,
    };
  }

  /** "Promote từ nền tảng khác": one row per configured promote source; the parent row is their exact sum. */
  async promoteChannel(scoped, projectId, c, sum) {
    const children = [];
    for (const p of scoped) {
      for (const s of listPromoSources(this.db, p.id)) {
        const inst = await sum(`promo_installs:${s.code}`, ['ios', 'android'], undefined, undefined, p.id);
        const clicks = (await sum(`promo_clicks:${s.code}`, ['web'], undefined, undefined, p.id)).total;
        children.push({ id: s.id, code: s.code, name: s.name, note: [p.id === projectId ? null : p.name, s.note].filter(Boolean).join(' · ') || null,
          clicks, ios: inst.byPlatform.ios ?? 0, android: inst.byPlatform.android ?? 0,
          total: inst.total, clickToInstall: clicks ? (inst.total / clicks) * 100 : null });
      }
    }
    const add = (k) => children.reduce((a, x) => a + (x[k] ?? 0), 0);
    const clicks = add('clicks');
    return { key: c.key, name: c.name, color: c.color, source: c.source, promote: true, children,
      clicks, ios: add('ios'), android: add('android'), total: add('total'), clickToInstall: clicks ? (add('total') / clicks) * 100 : null };
  }
}

function kpi(value, prev, isRate = false) {
  return { value, delta: prev == null ? null : isRate ? value - prev : percentChange(value, prev), deltaIsPoints: isRate };
}

/**
 * Horizontal share bar for a period: every project with cost, permanently deleted projects grouped as
 * "Dự án đã xóa", and "Chưa phân bổ". Shares sum to 100%.
 */
export function costShare(timeline, per, db) {
  const live = new Set(listProjects(db).map((p) => p.id));
  const items = [];
  const deleted = { id: 'deleted', name: 'Dự án đã xóa', color: '#8b8f98', pct: 0, monthly: 0 };
  for (const p of [...timeline.projects].sort((a, b) => a.name.localeCompare(b.name, 'vi'))) {
    const pc = per.projects[p.id];
    if (!pc || pc.total <= 0) continue;
    if (live.has(p.id)) items.push({ id: p.id, name: p.name, color: p.color, pct: pc.teamPct, monthly: pc.total });
    else { deleted.pct += pc.teamPct; deleted.monthly += pc.total; }
  }
  if (deleted.monthly > 0) items.push(deleted);
  items.push({ id: null, name: 'Chưa phân bổ', color: null, pct: per.unallocatedPct, monthly: per.unallocated });
  return items;
}

function weeklyMeans(daily, mode = 'mean') {
  const out = [];
  for (let i = daily.length; i > 0; i -= 7) {
    const chunk = daily.slice(Math.max(0, i - 7), i).filter((d) => d.value != null);
    if (!chunk.length) continue;
    const s = chunk.reduce((a, d) => a + d.value, 0);
    out.unshift({ date: chunk[0].date, value: mode === 'sum' ? s : s / chunk.length });
  }
  return out;
}
