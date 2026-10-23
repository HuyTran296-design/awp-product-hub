// Effective-dated cost configuration.
//
// A timeline is { versions, members, projects, tools, toolActuals }:
//   versions: [{ entity, entityId, effectiveDate:'YYYY-MM-DD', seq, data }]
//     member_cost (member id)   data { monthlyCost, removed? }
//     staffing    (project id)  data { rows:[{memberId, effortPct}] }
//     status      (project id)  data { status: draft|active|paused|archived|deleted }
//   members:  [{ id, name, role }]
//   projects: [{ id, name, color }]
//   tools / toolActuals: Chi phí Tools/AI, resolved per calendar month (see shared/tool-costs.js)
// The configuration in force on date D is the latest version per (entity, entityId) with effectiveDate ≤ D.
// Only "active" projects carry effort and receive Tools/AI.

import { computeCosts } from './cost-calculator.js';
import { addMonths } from './closing.js';
import { addDays, daysBetween } from './periods.js';
import { toolsForMonth } from './tool-costs.js';
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

const ZERO = { members: [], toolRows: [], fte: 0, direct: 0, tools: 0, total: 0, totalDaily: 0, teamPct: 0 };

/** Full configuration and computed monthly costs in force on `date`; Tools/AI are those of the date's calendar month. */
export function stateAt(timeline, date) {
  const settings = { tools: toolsForMonth(timeline.tools, timeline.toolActuals ?? {}, date.slice(0, 7)) };
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
  const active = timeline.projects.filter((p) => statuses[p.id] === 'active');
  const assignments = active.flatMap((p) => staffing[p.id].rows.map((r) => ({ projectId: p.id, memberId: r.memberId, effortPct: r.effortPct })));
  const costs = computeCosts({ settings, members, assignments, projects: active.map((p) => ({ id: p.id, name: p.name })) });
  for (const p of timeline.projects) costs.projects[p.id] ??= { projectId: p.id, ...ZERO };
  return { date, settings, members, statuses, staffing, assignments, costs };
}

/** Effective dates strictly after `from` and up to `to` where the configuration may change. */
export function changeDates(timeline, from, to) {
  return [...new Set(timeline.versions.map((v) => v.effectiveDate).filter((d) => d > from && d <= to))].sort();
}

/** First days of the calendar months strictly after `from` and up to `to` (Tools/AI cost changes by month). */
function monthStarts(from, to) {
  const out = [];
  for (let m = addMonths(from.slice(0, 7), 1); `${m}-01` <= to; m = addMonths(m, 1)) out.push(`${m}-01`);
  return out;
}

/**
 * Day-weighted average monthly costs over [from, to]: a period across two calendar months weighs each month by its
 * days in the period. With a constant configuration this is exactly the monthly cost, so period cost = result ×
 * period factor keeps the original table. Each project also gets `detail`: every person (Lương) and every tool.
 */
export function periodCosts(timeline, from, to) {
  const bounds = [...new Set([from, ...changeDates(timeline, from, to), ...monthStarts(from, to)])].sort();
  const totalDays = daysBetween(from, to) + 1;
  const acc = { teamTotal: 0, unallocated: 0, unallocatedPersonnel: 0, unallocatedTools: 0, payrollTotal: 0, toolsTotal: 0, projects: {} };
  bounds.forEach((start, i) => {
    const end = i + 1 < bounds.length ? addDays(bounds[i + 1], -1) : to;
    const w = (daysBetween(start, end) + 1) / totalDays;
    const { costs } = stateAt(timeline, start);
    for (const k of ['teamTotal', 'unallocated', 'unallocatedPersonnel', 'unallocatedTools', 'payrollTotal', 'toolsTotal']) acc[k] += costs[k] * w;
    for (const [id, pc] of Object.entries(costs.projects)) {
      const a = (acc.projects[id] ??= { total: 0, direct: 0, tools: 0, fte: 0, detail: { members: {}, tools: {} } });
      a.total += pc.total * w;
      a.direct += pc.direct * w;
      a.tools += pc.tools * w;
      a.fte += pc.fte * w;
      for (const r of pc.members) {
        const m = (a.detail.members[r.memberId] ??= { memberId: r.memberId, effortPct: 0, monthly: 0 });
        m.effortPct += r.effortPct * w;
        m.monthly += r.monthly * w;
      }
      for (const t of pc.toolRows) {
        const x = (a.detail.tools[t.toolId] ??= { toolId: t.toolId, name: t.name, amount: 0 });
        x.amount += t.amount * w;
      }
    }
  });
  for (const a of Object.values(acc.projects)) a.teamPct = acc.teamTotal ? (a.total / acc.teamTotal) * 100 : 0;
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
        // Where else the effort is used: "Nam đã dùng 100%: Game A 50%, Game B 50%".
        const elsewhere = st.assignments.filter((a) => a.memberId === m.id && a.projectId !== focusProjectId)
          .map((a) => ({ name: timeline.projects.find((p) => p.id === a.projectId)?.name, effortPct: a.effortPct }))
          .filter((x) => x.effortPct > 0);
        const used = elsewhere.reduce((s, x) => s + x.effortPct, 0);
        const given = m.name.trim().split(/\s+/).pop();
        errors.push({ type: 'over_allocated', memberId: m.id, date, total, over,
          message: `${m.name}: Vượt ${fmt(over)}% (${given} đã dùng ${fmt(used)}%${elsewhere.length ? `: ${elsewhere.map((x) => `${x.name} ${fmt(x.effortPct)}%`).join(', ')}` : ''}) — tổng ${fmt(total)}% từ ${fmtDate(date)}.` });

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
  const rows = timeline.projects
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
