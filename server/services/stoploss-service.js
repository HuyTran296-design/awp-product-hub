// Stop-loss: per-project policy, closed-month P&L series, proposals and Admin decisions.
// Evaluation never changes a project by itself — only an Admin's "Thực hiện" runs a lifecycle/staffing change.

import { lastClosedMonth, monthEnd } from '../../shared/closing.js';
import { periodCosts, stateAt } from '../../shared/cost-timeline.js';
import { formatDate, formatNumber, formatVnd } from '../../shared/format.js';
import { scoreProject } from '../../shared/health-score.js';
import {
  ACTION_LABELS, actionLabel, DEFAULT_POLICY, evaluateStopLoss, milestoneTarget, STATUS_LABELS, STATUS_RANK, trackedMonths,
} from '../../shared/stop-loss.js';
import { revenueMetricFor } from '../../shared/metric-catalog.js';
import { todayIso } from '../clock.js';
import { budgetInfo, phaseAt } from './phase-service.js';
import { currentChildren, membershipIntervals, scopeSegments } from './parent-service.js';
import {
  getAppSetting, getBaselines, getProject, getThresholds, listProjects, loadTimeline, setAppSetting, tx,
} from '../database.js';
import { logChange } from './audit-log.js';
import { httpError } from './connection-service.js';
import {
  applyLifecycle, previewLifecycle, previewStaffing, projectStatus, saveStaffing,
} from './project-service.js';

const SYSTEM = 'Hệ thống (theo dõi cắt lỗ)';
const DEFAULT_KEY = 'stoploss_default';

// ---------- Policies ----------

export function getDefaultPolicy(db) {
  return { ...DEFAULT_POLICY, ...getAppSetting(db, DEFAULT_KEY, {}) };
}

export function getPolicy(db, projectId) {
  const r = db.prepare('SELECT data FROM stoploss_policies WHERE project_id = ?').get(projectId);
  return r ? { ...DEFAULT_POLICY, ...JSON.parse(r.data) } : { ...DEFAULT_POLICY, enabled: false };
}

/** New projects start from the team default policy. */
export function initPolicy(db, projectId, policy = null) {
  const data = policy ?? { ...getDefaultPolicy(db), startDate: null };
  db.prepare('INSERT OR REPLACE INTO stoploss_policies (project_id, data, updated_at) VALUES (?, ?, ?)')
    .run(projectId, JSON.stringify(data), new Date().toISOString());
}

export function parsePolicy(body, { isDefault = false } = {}) {
  const n = (v) => Number(v);
  const errors = [];
  const p = {
    enabled: Boolean(body.enabled),
    startDate: !isDefault && /^\d{4}-\d{2}-\d{2}$/.test(body.startDate || '') ? body.startDate : null,
    warnPct: n(body.warnPct),
    cumulativeLoss: { on: Boolean(body.cumulativeLoss?.on), amount: n(body.cumulativeLoss?.amount) },
    consecutiveLoss: { on: Boolean(body.consecutiveLoss?.on), months: n(body.consecutiveLoss?.months) },
    lowHealth: { on: Boolean(body.lowHealth?.on), below: n(body.lowHealth?.below), months: n(body.lowHealth?.months) },
    budgetOverrun: { on: Boolean(body.budgetOverrun?.on), pct: n(body.budgetOverrun?.pct ?? 100) },
    lateLaunch: { on: Boolean(body.lateLaunch?.on), days: n(body.lateLaunch?.days ?? 30) },
    milestones: (body.milestones || []).map((m, i) => ({
      id: String(m.id || `m${Date.now().toString(36)}${i}`), on: m.on !== false, date: String(m.date || ''),
      kind: String(m.kind), value: m.kind === 'breakeven' ? null : n(m.value), metricKey: m.kind === 'baseline' ? String(m.metricKey) : null,
    })),
    triggerCount: n(body.triggerCount),
    action: { type: String(body.action?.type), effortPct: n(body.action?.effortPct) },
  };
  if (!(p.warnPct > 0 && p.warnPct < 100)) errors.push('Ngưỡng cảnh báo sớm phải trong khoảng 1–99%.');
  if (p.cumulativeLoss.on && !(p.cumulativeLoss.amount > 0)) errors.push('Ngưỡng lỗ lũy kế phải lớn hơn 0.');
  if (p.consecutiveLoss.on && !(Number.isInteger(p.consecutiveLoss.months) && p.consecutiveLoss.months >= 1)) errors.push('Số tháng lỗ liên tiếp phải là số nguyên ≥ 1.');
  if (p.lowHealth.on && !(p.lowHealth.below > 0 && p.lowHealth.below <= 120)) errors.push('Ngưỡng điểm sức khỏe phải trong khoảng 1–120%.');
  if (p.lowHealth.on && !(Number.isInteger(p.lowHealth.months) && p.lowHealth.months >= 1)) errors.push('Số tháng điểm sức khỏe thấp phải là số nguyên ≥ 1.');
  for (const m of p.milestones) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date)) errors.push('Mỗi mốc cần có ngày.');
    if (!['revenue_ratio', 'breakeven', 'health', 'baseline'].includes(m.kind)) errors.push('Chỉ tiêu của mốc không hợp lệ.');
    else if (m.kind !== 'breakeven' && !(m.value > 0)) errors.push(`Mốc ${m.date}: giá trị chỉ tiêu phải lớn hơn 0.`);
    if (m.kind === 'baseline' && !m.metricKey) errors.push(`Mốc ${m.date}: chọn baseline.`);
  }
  if (p.budgetOverrun.on && !(p.budgetOverrun.pct > 0)) errors.push('Ngưỡng % ngân sách phải lớn hơn 0.');
  if (p.lateLaunch.on && !(Number.isInteger(p.lateLaunch.days) && p.lateLaunch.days >= 0)) errors.push('Số ngày sau ngày ra mắt phải là số nguyên ≥ 0.');
  if (!(Number.isInteger(p.triggerCount) && p.triggerCount >= 1 && p.triggerCount <= 6)) errors.push('Quy tắc kích hoạt: chọn từ 1 đến 6 điều kiện.');
  if (!ACTION_LABELS[p.action.type]) errors.push('Chọn phương án xử lý.');
  if (p.action.type === 'reduce_effort' && !(p.action.effortPct > 0 && p.action.effortPct < 100)) errors.push('Mức giảm effort phải trong khoảng 1–99%.');
  if (errors.length) throw httpError(422, errors[0], errors.map((message) => ({ message })));
  return p;
}

const POLICY_FIELDS = [
  ['Bật phương án cắt lỗ', (p) => (p.enabled ? 'Bật' : 'Tắt')],
  ['Ngày bắt đầu theo dõi', (p) => (p.startDate ? formatDate(p.startDate) : 'Theo ngày bắt đầu tính chi phí')],
  ['Ngưỡng cảnh báo sớm', (p) => `${formatNumber(p.warnPct)}%`],
  ['Lỗ lũy kế', (p) => `${p.cumulativeLoss.on ? 'Bật' : 'Tắt'} · ${formatVnd(p.cumulativeLoss.amount)}`],
  ['Lỗ liên tiếp', (p) => `${p.consecutiveLoss.on ? 'Bật' : 'Tắt'} · ${p.consecutiveLoss.months} tháng`],
  ['Điểm sức khỏe thấp', (p) => `${p.lowHealth.on ? 'Bật' : 'Tắt'} · < ${formatNumber(p.lowHealth.below)}% trong ${p.lowHealth.months} tháng`],
  ['Chi phí vượt ngân sách', (p) => `${p.budgetOverrun?.on ? 'Bật' : 'Tắt'} · ${formatNumber(p.budgetOverrun?.pct ?? 100)}% ngân sách`],
  ['Chưa ra mắt đúng hạn', (p) => `${p.lateLaunch?.on ? 'Bật' : 'Tắt'} · +${p.lateLaunch?.days ?? 30} ngày`],
  ['Mốc thời gian', (p) => p.milestones.map((m) => `${m.on === false ? '(tắt) ' : ''}${formatDate(m.date)}: ${milestoneTarget(m)}`).join('; ') || 'Không có'],
  ['Quy tắc kích hoạt', (p) => `≥ ${p.triggerCount} điều kiện`],
  ['Phương án xử lý', (p) => actionLabel(p.action)],
];

export function savePolicy(db, projectId, body, actor) {
  const next = parsePolicy(body);
  const prev = getPolicy(db, projectId);
  tx(db, () => {
    db.prepare('INSERT OR REPLACE INTO stoploss_policies (project_id, data, updated_at) VALUES (?, ?, ?)')
      .run(projectId, JSON.stringify(next), new Date().toISOString());
    for (const [field, fmt] of POLICY_FIELDS) {
      const o = fmt(prev);
      const n = fmt(next);
      if (o !== n) logChange(db, { projectId, actor, action: 'Phương án cắt lỗ', field, oldValue: o, newValue: n, reason: body.reason });
    }
  });
  return getPolicy(db, projectId);
}

export function saveDefaultPolicy(db, body, actor) {
  const next = parsePolicy(body, { isDefault: true });
  const prev = getDefaultPolicy(db);
  tx(db, () => {
    setAppSetting(db, DEFAULT_KEY, next);
    for (const [field, fmt] of POLICY_FIELDS.slice(2)) {
      const o = fmt(prev);
      const n = fmt(next);
      if (o !== n) logChange(db, { actor, action: 'Chính sách cắt lỗ mặc định', field, oldValue: o, newValue: n });
    }
  });
  return getDefaultPolicy(db);
}

// ---------- Monthly series & evaluation ----------

/** Tracking start: explicit date, else the first day the project carried cost (first "active" status). */
export function trackingStart(policy, timeline, projectId) {
  if (policy.startDate) return policy.startDate;
  const firstActive = timeline.versions.filter((v) => v.entity === 'status' && v.entityId === projectId && v.data.status === 'active')
    .map((v) => v.effectiveDate).sort()[0];
  return firstActive ?? null;
}

export class StopLossService {
  constructor({ db, metrics, dataSource, manual }) {
    this.db = db;
    this.manual = manual;
    this.metrics = metrics;
    this.ds = dataSource;
  }

  /**
   * Closed calendar months from `start`: revenue, cost (config in force), P&L, health score, baseline actuals.
   * A Dự án is evaluated on its children: Σ revenue of each child while it belonged to it, its cost while root
   * (= its children's), score = cost-weighted mean of the children's monthly scores (children in "Xây dựng" skipped).
   */
  async monthlySeries(projectId, start, timeline, extraMetrics = []) {
    const kids = listProjects(this.db).filter((p) => timeline.versions.some((v) => v.entity === 'membership' && v.entityId === p.id && v.data.parentId === projectId));
    if (getProject(this.db, projectId)?.isFolder || kids.length) return this.parentMonthlySeries(projectId, kids, start, timeline);
    return this.ownMonthlySeries(projectId, start, timeline, extraMetrics);
  }

  /** Months of the project alone (no children). */
  async ownMonthlySeries(projectId, start, timeline, extraMetrics = []) {
    const lastClosed = lastClosedMonth(todayIso());
    const keys = [...new Set([...getBaselines(this.db, projectId).map((b) => b.metricKey), ...extraMetrics])];
    const revenueKey = revenueMetricFor(getProject(this.db, projectId).productType);
    const out = [];
    for (const month of trackedMonths(start, lastClosed)) {
      const from = `${month}-01`;
      const to = monthEnd(month);
      const rev = await this.metrics.aggregate(projectId, revenueKey, from, to);
      if (!rev.complete) continue; // months without complete data are not evaluated
      const cost = periodCosts(timeline, from, to).projects[projectId]?.total ?? 0;
      const actuals = { [revenueKey]: rev.value };
      // Each month is scored with the targets that applied to it.
      const baselines = getBaselines(this.db, projectId, to);
      for (const k of new Set([...keys, ...baselines.map((b) => b.metricKey)])) if (k !== revenueKey && !(k in actuals)) actuals[k] = (await this.metrics.aggregate(projectId, k, from, to)).value;
      const score = scoreProject(baselines, actuals, 'month', getThresholds(this.db, projectId, to));
      out.push({ month, from, to, revenue: rev.value, cost, profit: rev.value - cost, score: score.score, actuals });
    }
    return out;
  }

  async parentMonthlySeries(projectId, kids, start, timeline) {
    const perChild = {};
    for (const p of kids) perChild[p.id] = Object.fromEntries((await this.ownMonthlySeries(p.id, start, timeline)).map((m) => [m.month, m]));
    const revKey = (id) => revenueMetricFor(getProject(this.db, id)?.productType);
    const out = [];
    for (const month of trackedMonths(start, lastClosedMonth(todayIso()))) {
      const from = `${month}-01`;
      const to = monthEnd(month);
      const inside = kids.filter((p) => membershipIntervals(timeline, p.id, projectId, from, to).length);
      if (!inside.length) continue;
      let revenue = 0;
      let complete = true;
      for (const [id, a, b] of scopeSegments(timeline, projectId, from, to)) {
        const r = await this.metrics.aggregate(id, revKey(id), a, b);
        if (r.value == null) { if (id !== projectId) complete = false; continue; }
        revenue += r.value;
        complete &&= r.complete;
      }
      if (!complete) continue;
      const per = periodCosts(timeline, from, to);
      const cost = per.roots[projectId]?.total ?? per.projects[projectId]?.total ?? 0;
      const rows = inside.filter((p) => phaseAt(this.db, p.id, to).phase !== 'build').map((p) => perChild[p.id][month]).filter((r) => r && r.score != null);
      const w = rows.reduce((sum, r) => sum + r.cost, 0);
      const score = !rows.length ? null : w > 0 ? rows.reduce((sum, r) => sum + r.score * r.cost, 0) / w : rows.reduce((sum, r) => sum + r.score, 0) / rows.length;
      out.push({ month, from, to, revenue, cost, profit: revenue - cost, score, actuals: {},
        children: inside.map((p) => ({ id: p.id, name: p.name, profit: perChild[p.id][month]?.profit ?? null })) });
    }
    return out;
  }

  async evaluate(projectId) {
    const policy = getPolicy(this.db, projectId);
    const timeline = loadTimeline(this.db);
    const start = trackingStart(policy, timeline, projectId);
    const today = todayIso();
    const lastClosed = lastClosedMonth(today);
    const extra = policy.milestones.filter((m) => m.kind === 'baseline').map((m) => m.metricKey);
    const months = policy.enabled ? await this.monthlySeries(projectId, start, timeline, extra) : [];
    const budget = this.manual ? budgetInfo(this.db, projectId, today, this.manual) : null;
    const ev = evaluateStopLoss(policy, months, { today, lastClosed, budget });
    const costs = stateAt(timeline, today).costs;
    const monthlyCost = costs.parents[projectId]?.total ?? costs.projects[projectId]?.total ?? 0;
    return { policy, start, lastClosed, today, monthlyCost, ...ev };
  }

  latestProposal(projectId) {
    const r = this.db.prepare('SELECT * FROM stoploss_proposals WHERE project_id = ? ORDER BY id DESC LIMIT 1').get(projectId);
    return r ? mapProposal(r) : null;
  }

  /**
   * Evaluate and create a proposal when the threshold is reached and no decision blocks it:
   * - a pending proposal already exists;
   * - "Gia hạn" until its review date, unless a new condition is satisfied;
   * - "Bỏ qua" for the same closing month, unless a new condition is satisfied;
   * - "Thực hiện", unless a new condition is satisfied.
   * Returns the evaluation with the displayed status (incl. "Đã xử lý").
   */
  async sync(projectId) {
    const ev = await this.evaluate(projectId);
    let proposal = this.latestProposal(projectId);
    const lifecycle = projectStatus(loadTimeline(this.db), projectId).latest;
    if (!ev.enabled) return { ...ev, display: display(ev, null), proposal: null };

    const newKeys = proposal ? ev.metKeys.filter((k) => !proposal.metKeys.includes(k)) : ev.metKeys;
    let blocked = false;
    if (proposal?.status === 'pending') blocked = true;
    else if (proposal?.status === 'extended') blocked = ev.today < proposal.decision.reviewDate && !newKeys.length;
    else if (proposal?.status === 'dismissed') blocked = ev.evaluatedThrough === proposal.evaluatedThrough && !newKeys.length;
    else if (proposal?.status === 'executed') blocked = !newKeys.length;
    // Archived projects are no longer followed up with new proposals.
    if (lifecycle === 'archived') blocked = true;

    if (ev.status === 'triggered' && !blocked) {
      proposal = this.createProposal(projectId, ev);
    }
    return { ...ev, display: display(ev, proposal), proposal };
  }

  createProposal(projectId, ev) {
    const met = ev.conditions.filter((c) => c.met);
    // A parent's proposal lists the children losing the most.
    const loss = {};
    for (const m of ev.months) for (const c of m.children ?? []) if (c.profit != null) loss[c.id] = { name: c.name, profit: (loss[c.id]?.profit ?? 0) + c.profit };
    const topLosers = Object.entries(loss).map(([id, v]) => ({ id: Number(id), ...v })).sort((a, b) => a.profit - b.profit).slice(0, 5);
    const snapshot = {
      conditions: met.map((c) => ({ key: c.key, label: c.label, detail: c.detail })),
      months: ev.months.slice(-6).map((m) => ({ month: m.month, revenue: m.revenue, cost: m.cost, profit: m.profit })),
      action: ev.policy.action, cumLoss: ev.cumLoss, threshold: ev.threshold, usedPct: ev.usedPct,
      ...(Object.keys(loss).length ? { topLosers, scope: 'parent' } : {}),
    };
    const id = tx(this.db, () => {
      const pid = Number(this.db.prepare(`INSERT INTO stoploss_proposals (project_id, created_at, created_on, evaluated_through, met_keys, snapshot)
        VALUES (?, ?, ?, ?, ?, ?)`).run(projectId, new Date().toISOString(), ev.today, ev.evaluatedThrough,
        JSON.stringify(ev.metKeys), JSON.stringify(snapshot)).lastInsertRowid);
      logChange(this.db, { projectId, actor: SYSTEM, action: 'Đề xuất cắt lỗ', field: 'Tạo đề xuất',
        oldValue: null, newValue: `${met.map((c) => c.detail).join('; ')} · Phương án: ${actionLabel(ev.policy.action)}` });
      return pid;
    });
    return this.getProposal(id);
  }

  getProposal(id) {
    const r = this.db.prepare('SELECT * FROM stoploss_proposals WHERE id = ?').get(id);
    if (!r) throw httpError(404, 'Không tìm thấy đề xuất');
    return mapProposal(r);
  }

  /** Impact of the proposed action, computed live (same preview as the lifecycle dialogs). */
  impact(projectId, action, effectiveDate) {
    if (action.type === 'pause' || action.type === 'archive') {
      try {
        // A parent's decision applies to its children as well.
        return previewLifecycle(this.db, projectId, { action: action.type, effectiveDate, applyToChildren: true });
      } catch (err) {
        return { errors: [err.message] };
      }
    }
    if (action.type === 'reduce_effort') {
      const st = stateAt(loadTimeline(this.db), effectiveDate);
      const s = st.staffing[projectId];
      return previewStaffing(this.db, projectId, { effectiveDate, rows: scaledRows(s.rows, action.effortPct), manualAllocPct: s.manualAllocPct });
    }
    return null;
  }

  /** Admin decision: execute | extend | dismiss. Reason is mandatory. */
  decide(proposalId, body, actor) {
    const proposal = this.getProposal(proposalId);
    if (proposal.status !== 'pending') throw httpError(409, 'Đề xuất này đã được xử lý.');
    const reason = String(body.reason || '').trim();
    if (!reason) throw httpError(422, 'Vui lòng ghi lý do quyết định.');
    const projectId = proposal.projectId;
    const today = todayIso();
    let decision;
    let summary;

    if (body.decision === 'execute') {
      const action = { type: String(body.action?.type || proposal.snapshot.action.type), effortPct: Number(body.action?.effortPct ?? proposal.snapshot.action.effortPct) };
      if (!ACTION_LABELS[action.type]) throw httpError(422, 'Chọn phương án xử lý.');
      const effectiveDate = body.effectiveDate;
      decision = { type: 'execute', action, effectiveDate };
      summary = action.type === 'review' ? 'Thực hiện: Đánh giá lại (không kèm thao tác)' : `Thực hiện: ${actionLabel(action)} từ ${formatDate(effectiveDate)}`;
      tx(this.db, () => {
        if (action.type === 'pause' || action.type === 'archive') {
          // A parent's decision also applies to its children.
          applyLifecycle(this.db, projectId, { action: action.type, effectiveDate, applyToChildren: true, reason: `Cắt lỗ: ${reason}` }, actor, {});
        } else if (action.type === 'reduce_effort') {
          for (const id of [projectId, ...currentChildren(this.db, projectId, loadTimeline(this.db), effectiveDate).map((p) => p.id)]) {
            const st = stateAt(loadTimeline(this.db), effectiveDate);
            const s = st.staffing[id];
            if (id !== projectId && (st.statuses[id] !== 'active' || !s.rows.length)) continue;
            if (!s.rows.length) continue;
            saveStaffing(this.db, id, { effectiveDate, rows: scaledRows(s.rows, action.effortPct), manualAllocPct: s.manualAllocPct,
              reason: `Cắt lỗ: ${reason}` }, actor);
          }
        }
        this.close(proposal, 'executed', decision, actor, reason, summary, effectiveDate);
      });
    } else if (body.decision === 'extend') {
      const reviewDate = body.reviewDate;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewDate || '') || reviewDate <= today) throw httpError(422, 'Ngày đánh giá lại phải sau hôm nay.');
      const newThreshold = body.newThreshold ? Number(body.newThreshold) : null;
      if (newThreshold != null && !(newThreshold > 0)) throw httpError(422, 'Ngưỡng mới phải lớn hơn 0.');
      decision = { type: 'extend', reviewDate, newThreshold };
      summary = `Gia hạn tới ${formatDate(reviewDate)}${newThreshold ? ` · ngưỡng lỗ lũy kế mới ${formatVnd(newThreshold)}` : ''}`;
      tx(this.db, () => {
        if (newThreshold) {
          const p = getPolicy(this.db, projectId);
          savePolicy(this.db, projectId, { ...p, cumulativeLoss: { ...p.cumulativeLoss, amount: newThreshold }, reason: `Gia hạn cắt lỗ: ${reason}` }, actor);
        }
        this.close(proposal, 'extended', decision, actor, reason, summary, null);
      });
    } else if (body.decision === 'dismiss') {
      decision = { type: 'dismiss' };
      summary = 'Bỏ qua đề xuất';
      tx(this.db, () => this.close(proposal, 'dismissed', decision, actor, reason, summary, null));
    } else {
      throw httpError(422, 'Chọn Thực hiện, Gia hạn hoặc Bỏ qua.');
    }
    return this.getProposal(proposalId);
  }

  close(proposal, status, decision, actor, reason, summary, effectiveDate) {
    const full = { ...decision, decidedBy: actor, decidedAt: new Date().toISOString(), decidedOn: todayIso(), reason };
    this.db.prepare('UPDATE stoploss_proposals SET status = ?, decision = ? WHERE id = ?').run(status, JSON.stringify(full), proposal.id);
    logChange(this.db, { projectId: proposal.projectId, actor, action: 'Quyết định cắt lỗ', field: `Đề xuất #${proposal.id}`,
      oldValue: 'Chờ quyết định', newValue: summary, effectiveDate, reason });
  }

  /** Every live project with its stop-loss status, sorted Chạm ngưỡng → Cảnh báo → An toàn. */
  async tracking() {
    const rows = [];
    for (const p of listProjects(this.db)) {
      const s = await this.sync(p.id);
      rows.push({ id: p.id, name: p.name, color: p.color, ...summarize(s) });
    }
    return rows.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || (b.usedPct ?? 0) - (a.usedPct ?? 0));
  }
}

/** Compact status for lists/badges. */
export function summarize(s) {
  return {
    status: s.display.status, statusLabel: s.display.label, enabled: s.enabled,
    cumLoss: s.cumLoss ?? 0, threshold: s.threshold ?? null, usedPct: s.usedPct ?? null,
    remaining: s.remaining ?? null, nextMilestone: s.nextMilestone ?? null,
    proposal: s.proposal ? { id: s.proposal.id, status: s.proposal.status } : null,
    evaluatedThrough: s.evaluatedThrough ?? null,
  };
}

/** Displayed status: an Admin decision in force shows as "Đã xử lý · …". */
function display(ev, proposal) {
  if (!ev.enabled) return { status: 'off', label: STATUS_LABELS.off };
  if (proposal?.status === 'pending') return { status: 'triggered', label: STATUS_LABELS.triggered };
  const d = proposal?.decision;
  if (proposal && proposal.status !== 'pending' && ev.status === 'triggered') {
    const when = formatDate(d.decidedOn);
    if (proposal.status === 'extended') return { status: 'handled', label: `Đã xử lý · Gia hạn tới ${formatDate(d.reviewDate)}` };
    if (proposal.status === 'dismissed') return { status: 'handled', label: `Đã xử lý · Bỏ qua (${when})` };
    return { status: 'handled', label: `Đã xử lý · ${d.action.type === 'review' ? 'Đánh giá lại' : actionLabel(d.action)}${d.action.type !== 'review' && d.effectiveDate ? ` từ ${formatDate(d.effectiveDate)}` : ''} (quyết định ${when})` };
  }
  if (proposal?.status === 'extended' && ev.today < d.reviewDate) {
    return { status: 'handled', label: `Đã xử lý · Gia hạn tới ${formatDate(d.reviewDate)}` };
  }
  return { status: ev.status, label: STATUS_LABELS[ev.status] };
}

/** "Giảm effort xuống X%": each member keeps X% of their current effort on the project. */
export function scaledRows(rows, pct) {
  return rows.map((r) => ({ memberId: r.memberId, effortPct: Math.round(r.effortPct * pct) / 100 }));
}

function mapProposal(r) {
  return {
    id: r.id, projectId: r.project_id, createdAt: r.created_at, createdOn: r.created_on, evaluatedThrough: r.evaluated_through,
    metKeys: JSON.parse(r.met_keys), snapshot: JSON.parse(r.snapshot), status: r.status,
    decision: r.decision ? JSON.parse(r.decision) : null,
  };
}
