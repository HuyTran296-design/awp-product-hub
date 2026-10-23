// Effective-dated cost configuration.
//
// A timeline is { versions, members, projects }:
//   versions: [{ entity, entityId, effectiveDate:'YYYY-MM-DD', seq, data }]
//     team        (entityId 0)  data { tools:[{id, name, monthlyCost, appliesTo:[project ids]}] }  — Chi phí Tools/AI
//     member_cost (member id)   data { monthlyCost, removed? }
//     staffing    (project id)  data { rows:[{memberId, effortPct}] }
//     status      (project id)  data { status: draft|active|paused|archived|deleted }
//     membership  (project id)  data { parentId | null }       — "Thuộc dự án" (max 2 levels)
//     parent_split (project id) data { method, manualPct } — how "Nhân sự chung" of a parent is split
//   members:  [{ id, name, role }]
//   projects: [{ id, name, color, kind? }]   kind 'folder' = Dự án: no data of its own
//   revenueOf?(projectId, date): revenue used by the "Theo doanh thu" split
// The configuration in force on date D is the latest version per (entity, entityId) with effectiveDate ≤ D.
// Only "active" projects carry effort and receive Tools/AI.

import { computeCosts } from './cost-calculator.js';
import { addDays, daysBetween } from './periods.js';
import { WORKING_DAYS } from './system-config.js';

export const PROJECT_STATUSES = {
  draft: 'Nháp', active: 'Đang chạy', paused: 'Tạm dừng', archived: 'Lưu trữ', deleted: 'Đã xóa',
};

export function latestVersion(timeline, entity, entityId, date) {
  let best = null;
  for (const v of timeline.versions) {
    if (v.entity !== entity || v.entityId !== entityId || v.effectiveDate > date) continue;
    if (!best || v.effectiveDate > best.effectiveDate || (v.effectiveDate === best.effectiveDate && v.seq > best.seq)) best = v;
  }
  return best;
}

/** Full configuration and computed monthly costs in force on `date`. */
export function stateAt(timeline, date) {
  const settings = { tools: latestVersion(timeline, 'team', 0, date)?.data.tools ?? [] };
  const members = [];
  for (const m of timeline.members) {
    const v = latestVersion(timeline, 'member_cost', m.id, date);
    if (v && !v.data.removed) members.push({ ...m, monthlyCost: v.data.monthlyCost });
  }
  const memberIds = new Set(members.map((m) => m.id));
  const statuses = {};
  const staffing = {};
  for (const p of timeline.projects) {
    statuses[p.id] = latestVersion(timeline, 'status', p.id, date)?.data.status ?? null;
    const s = latestVersion(timeline, 'staffing', p.id, date)?.data;
    staffing[p.id] = { rows: (s?.rows ?? []).filter((r) => memberIds.has(r.memberId)) };
  }
  const parentOf = {};
  const parentSplit = {};
  for (const p of timeline.projects) {
    parentOf[p.id] = latestVersion(timeline, 'membership', p.id, date)?.data.parentId ?? null;
    const ps = latestVersion(timeline, 'parent_split', p.id, date)?.data;
    parentSplit[p.id] = { method: ps?.method ?? 'even', manualPct: ps?.manualPct ?? {} };
  }
  const childrenOf = {};
  for (const p of timeline.projects) if (parentOf[p.id] != null) (childrenOf[parentOf[p.id]] ??= []).push(p.id);
  const active = timeline.projects.filter((p) => statuses[p.id] === 'active');
  const assignments = active.flatMap((p) => staffing[p.id].rows.map((r) => ({ projectId: p.id, memberId: r.memberId, effortPct: r.effortPct })));
  // Parents = folders (also without children: their shared staff is then unallocated) and any project with children.
  const isParent = (p) => p.kind === 'folder' || childrenOf[p.id]?.length;
  const parents = timeline.projects.filter(isParent).map((p) => ({
    id: p.id, ...parentSplit[p.id],
    revenue: parentSplit[p.id].method === 'revenue' && timeline.revenueOf
      ? Object.fromEntries(active.filter((c) => parentOf[c.id] === p.id).map((c) => [c.id, timeline.revenueOf(c.id, date)])) : {},
  }));
  const costs = computeCosts({
    settings, members, assignments, parents,
    projects: active.map((p) => ({ id: p.id, name: p.name, parentId: parentOf[p.id] })),
  });
  for (const p of timeline.projects) {
    if (!costs.projects[p.id]) {
      costs.projects[p.id] = { projectId: p.id, parentId: parentOf[p.id], members: [], fte: 0, directFte: 0, parentFte: 0, direct: 0,
        directOwn: 0, parentShared: 0, tools: 0, toolRows: [], total: 0, totalDaily: 0, teamPct: 0 };
    }
  }
  // Inclusive figures of every parent: Σ children that belong to it on this date (a parent has no cost of its own).
  for (const p of timeline.projects.filter(isParent)) {
    const kids = childrenOf[p.id] ?? [];
    const own = costs.projects[p.id];
    const pc = (costs.parents[p.id] ??= { projectId: p.id, method: parentSplit[p.id].method, sharedRows: [],
      sharedCost: 0, sharedFte: 0, distributed: 0, unallocated: 0, warnings: [], childIds: [] });
    pc.childIds = kids;
    pc.total = own.total + kids.reduce((s, id) => s + (costs.projects[id]?.total ?? 0), 0);
    pc.direct = own.direct + kids.reduce((s, id) => s + (costs.projects[id]?.direct ?? 0), 0);
    pc.own = own.total;
    pc.teamPct = costs.teamTotal ? (pc.total / costs.teamTotal) * 100 : 0;
  }
  return { date, settings, members, statuses, staffing, assignments, parentOf, parentSplit, childrenOf, costs };
}

/** Effective dates strictly after `from` and up to `to` where the configuration may change. */
export function changeDates(timeline, from, to) {
  return [...new Set(timeline.versions.map((v) => v.effectiveDate).filter((d) => d > from && d <= to))].sort();
}

/**
 * Day-weighted average monthly costs over [from, to]. With a constant configuration this is
 * exactly the monthly cost, so period cost = result × period factor keeps the original table.
 */
export function periodCosts(timeline, from, to) {
  const bounds = [from, ...changeDates(timeline, from, to)];
  const totalDays = daysBetween(from, to) + 1;
  // roots: cost of each project while it is a root (incl. its children that day) — rows of the Dashboard, never double counted.
  const acc = { teamTotal: 0, unallocated: 0, unallocatedShared: 0, unallocatedPersonnel: 0, unallocatedTools: 0, payrollTotal: 0, toolsTotal: 0,
    projects: {}, parents: {}, roots: {} };
  bounds.forEach((start, i) => {
    const end = i + 1 < bounds.length ? addDays(bounds[i + 1], -1) : to;
    const w = (daysBetween(start, end) + 1) / totalDays;
    const { costs, parentOf } = stateAt(timeline, start);
    for (const k of ['teamTotal', 'unallocated', 'unallocatedShared', 'unallocatedPersonnel', 'unallocatedTools', 'payrollTotal', 'toolsTotal']) {
      acc[k] += costs[k] * w;
    }
    for (const [id, pc] of Object.entries(costs.projects)) {
      const a = (acc.projects[id] ??= { total: 0, direct: 0, tools: 0, fte: 0 });
      a.total += pc.total * w;
      a.direct += pc.direct * w;
      a.tools += pc.tools * w;
      a.fte += pc.fte * w;
      a.parentShared = (a.parentShared ?? 0) + (pc.parentShared ?? 0) * w;
      a.directOwn = (a.directOwn ?? 0) + (pc.directOwn ?? 0) * w;
      // Detail of the cost: each person (direct, or split from the Dự án's shared staff) and each tool.
      const d = (a.detail ??= { members: {}, tools: {} });
      const addMember = (r, kind, share) => {
        const m = (d.members[`${kind}:${r.memberId}`] ??= { memberId: r.memberId, kind, effortPct: 0, monthly: 0 });
        m.effortPct += r.effortPct * share * w;
        m.monthly += r.monthly * share * w;
      };
      if (!pc.isParent) for (const r of pc.members ?? []) addMember(r, 'direct', 1);
      if (pc.parentShare) for (const r of costs.parents[pc.parentId]?.sharedRows ?? []) addMember(r, 'shared', pc.parentShare);
      for (const t of pc.toolRows ?? []) {
        const x = (d.tools[t.toolId] ??= { toolId: t.toolId, name: t.name, amount: 0 });
        x.amount += t.amount * w;
      }
    }
    for (const [id, pc] of Object.entries(costs.projects)) {
      if (parentOf[id] != null) continue;
      const a = (acc.roots[id] ??= { total: 0 });
      a.total += (costs.parents[id]?.total ?? pc.total) * w;
    }
    // Per-day attribution: a child's cost counts for the parent it belonged to on that day.
    for (const [id, pc] of Object.entries(costs.parents)) {
      if (pc.total == null) continue;
      const a = (acc.parents[id] ??= { total: 0, direct: 0, own: 0, sharedCost: 0, unallocated: 0 });
      a.total += pc.total * w;
      a.direct += pc.direct * w;
      a.own += pc.own * w;
      a.sharedCost += pc.sharedCost * w;
      a.unallocated += pc.unallocated * w;
    }
  });
  for (const a of Object.values(acc.projects)) a.teamPct = acc.teamTotal ? (a.total / acc.teamTotal) * 100 : 0;
  for (const a of Object.values(acc.parents)) a.teamPct = acc.teamTotal ? (a.total / acc.teamTotal) * 100 : 0;
  for (const a of Object.values(acc.roots)) a.teamPct = acc.teamTotal ? (a.total / acc.teamTotal) * 100 : 0;
  acc.unallocatedPct = acc.teamTotal ? (acc.unallocated / acc.teamTotal) * 100 : 0;
  acc.workingDays = WORKING_DAYS;
  return acc;
}

/** Timeline with hypothetical versions appended (they win ties on the same date). */
export function withVersions(timeline, extra) {
  const maxSeq = timeline.versions.reduce((m, v) => Math.max(m, v.seq), 0);
  return { ...timeline, versions: [...timeline.versions, ...extra.map((v, i) => ({ seq: maxSeq + 1 + i, entityId: 0, ...v }))] };
}

/**
 * Over-allocation check from `fromDate` onwards: evaluated at fromDate and at every later change date,
 * so a change today cannot conflict with a version already scheduled for a later month.
 */
export function validateTimeline(timeline, fromDate, { focusProjectId = null } = {}) {
  const later = [...new Set(timeline.versions.map((v) => v.effectiveDate).filter((d) => d > fromDate))].sort();
  const errors = [];
  const seen = new Set();
  for (const date of [fromDate, ...later]) {
    const st = stateAt(timeline, date);
    for (const m of st.members) {
      const total = st.costs.memberEffort[m.id] ?? 0;
      if (total > 100 + 1e-9 && !seen.has(m.id)) {
        seen.add(m.id);
        const over = Math.round((total - 100) * 10) / 10;
        // Where else the effort is used: "Nam đã dùng 100% ở ABC Studio Game".
        const elsewhere = st.assignments.filter((a) => a.memberId === m.id && a.projectId !== focusProjectId)
          .map((a) => ({ name: timeline.projects.find((p) => p.id === a.projectId)?.name, effortPct: a.effortPct }))
          .filter((x) => x.effortPct > 0);
        const used = elsewhere.reduce((s, x) => s + x.effortPct, 0);
        const given = m.name.trim().split(/\s+/).pop();
        errors.push({ type: 'over_allocated', memberId: m.id, date, total, over,
          message: `${m.name}: Vượt ${fmt(over)}% (${given} đã dùng ${fmt(used)}% ở ${elsewhere.map((x) => x.name).join(', ') || 'nơi khác'}) — tổng ${fmt(total)}% từ ${fmtDate(date)}.` });

      }
    }
  }
  return errors;
}

/** Effort a member still has free on `date`, excluding one project (the one being edited). */
export function availableEffort(state, memberId, excludeProjectId) {
  const used = state.assignments.filter((a) => a.memberId === memberId && a.projectId !== excludeProjectId)
    .reduce((s, a) => s + a.effortPct, 0);
  return 100 - used;
}

/** Before/after monthly cost of every project + unallocated, for impact previews. */
export function impactPreview(timeline, extra, date) {
  const before = stateAt(timeline, date);
  const after = stateAt(withVersions(timeline, extra), date);
  // A Dự án carries no cost of its own: its children's rows show the effect.
  const rows = timeline.projects
    .filter((p) => p.kind !== 'folder')
    .filter((p) => before.costs.projects[p.id].total || after.costs.projects[p.id].total
      || ['active', 'paused'].includes(before.statuses[p.id]) || ['active', 'paused'].includes(after.statuses[p.id]))
    .map((p) => ({
      projectId: p.id, name: p.name, color: p.color,
      statusBefore: before.statuses[p.id], statusAfter: after.statuses[p.id],
      before: pick(before.costs.projects[p.id], before.costs.teamTotal),
      after: pick(after.costs.projects[p.id], after.costs.teamTotal),
    }));
  return {
    date, rows,
    unallocated: { before: { total: before.costs.unallocated, teamPct: before.costs.unallocatedPct },
      after: { total: after.costs.unallocated, teamPct: after.costs.unallocatedPct } },
    teamTotal: after.costs.teamTotal,
  };
}

function pick(pc, teamTotal) {
  return { direct: pc.direct, fte: pc.fte, tools: pc.tools, total: pc.total, teamPct: teamTotal ? (pc.total / teamTotal) * 100 : 0 };
}

/** First day of the month containing `iso`. Months before the current one are closed. */
export function monthStart(iso) {
  return `${iso.slice(0, 7)}-01`;
}

function fmt(n) {
  return String(Math.round(n * 10) / 10).replace('.', ',');
}

function fmtDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
