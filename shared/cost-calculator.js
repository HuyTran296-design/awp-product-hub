// Team cost structure: personnel cost per project, Tools/AI split by FTE, unallocated cost.
// Tổng chi phí team = Σ lương nhân sự + Σ Tools/AI. All money values are VND per month unless suffixed with "Daily".

import { WORKING_DAYS } from './system-config.js';

/**
 * @param {object} input
 * @param {{tools?:{id:string, name:string, monthlyCost:number, appliesTo?:number[]}[]}} input.settings
 *   Tools/AI; appliesTo = project ids; empty = "Tất cả dự án"
 * @param {{id:number, monthlyCost:number}[]} input.members
 * @param {{id:number, name?:string}[]} input.projects  running projects only
 * @param {{projectId:number, memberId:number, effortPct:number}[]} input.assignments
 */
export function computeCosts({ settings, members, projects, assignments }) {
  const workingDays = WORKING_DAYS;
  const tools = settings?.tools ?? [];
  const memberById = new Map(members.map((m) => [m.id, m]));

  const payrollTotal = members.reduce((s, m) => s + m.monthlyCost, 0);
  const toolsTotal = tools.reduce((s, t) => s + t.monthlyCost, 0);
  const teamTotal = payrollTotal + toolsTotal;

  // Total effort per member across every running project.
  const memberEffort = Object.fromEntries(members.map((m) => [m.id, 0]));
  for (const a of assignments) if (memberById.has(a.memberId)) memberEffort[a.memberId] += a.effortPct;

  const perProject = projects.map((p) => {
    const rows = assignments
      .filter((a) => a.projectId === p.id && memberById.has(a.memberId))
      .map((a) => {
        const monthly = memberById.get(a.memberId).monthlyCost * (a.effortPct / 100);
        return { memberId: a.memberId, effortPct: a.effortPct, monthly, daily: monthly / workingDays };
      });
    return {
      projectId: p.id, members: rows, toolRows: [],
      direct: rows.reduce((s, r) => s + r.monthly, 0),       // Lương = Σ chi phí nhân sự × % effort
      fte: rows.reduce((s, r) => s + r.effortPct, 0) / 100,   // FTE = Σ % effort
    };
  });

  // Each tool → the running projects in its "Áp dụng cho", by FTE within that group.
  let unallocatedTools = 0;
  for (const t of tools) {
    const scope = t.appliesTo ?? [];
    const group = scope.length ? perProject.filter((p) => scope.includes(p.projectId)) : perProject;
    const fte = group.reduce((s, p) => s + p.fte, 0);
    if (!(fte > 0)) { unallocatedTools += t.monthlyCost; continue; }
    for (const p of group) {
      if (p.fte > 0) p.toolRows.push({ toolId: t.id, name: t.name, amount: t.monthlyCost * (p.fte / fte), share: p.fte / fte });
    }
  }

  const fteTotal = perProject.reduce((s, p) => s + p.fte, 0);
  for (const p of perProject) {
    p.tools = p.toolRows.reduce((s, r) => s + r.amount, 0);
    p.total = p.direct + p.tools;
    p.totalDaily = p.total / workingDays;
    p.teamPct = teamTotal ? (p.total / teamTotal) * 100 : 0;
  }

  // Free effort of every member ("Lương chưa phân bổ").
  const unallocatedPersonnel = members.reduce((s, m) => s + m.monthlyCost * (1 - memberEffort[m.id] / 100), 0);
  const unallocated = unallocatedPersonnel + unallocatedTools;

  return {
    teamTotal,
    workingDays,
    payrollTotal,
    toolsTotal,
    fteTotal,
    memberEffort,
    projects: Object.fromEntries(perProject.map((p) => [p.projectId, p])),
    unallocated,
    unallocatedPersonnel,
    unallocatedTools,
    unallocatedPct: teamTotal ? (unallocated / teamTotal) * 100 : 0,
  };
}

/** Per-person cost for one project: monthly × effort%, and daily = ÷ working days. */
export function memberProjectCost(monthlyCost, effortPct, workingDays = WORKING_DAYS) {
  const monthly = monthlyCost * (effortPct / 100);
  return { monthly, daily: monthly / workingDays };
}

/**
 * Validate project assignments. Returns a list of Vietnamese error messages (empty = valid).
 * @param {{id:number,name:string}[]} members
 * @param {{id:number,name:string}[]} projects
 * @param {{projectId:number, memberId:number, effortPct:number}[]} assignments
 */
export function validateAssignments({ members, projects, assignments }) {
  const errors = [];
  for (const a of assignments) {
    if (!(a.effortPct >= 0 && a.effortPct <= 100)) {
      const m = members.find((x) => x.id === a.memberId);
      const p = projects.find((x) => x.id === a.projectId);
      errors.push({ type: 'effort_range', memberId: a.memberId, projectId: a.projectId,
        message: `Effort của ${m?.name ?? 'nhân sự'} trong ${p?.name ?? 'dự án'} phải trong khoảng 0–100%.` });
    }
  }
  for (const m of members) {
    const total = assignments.filter((a) => a.memberId === m.id).reduce((s, a) => s + a.effortPct, 0);
    if (total > 100 + 1e-9) {
      const over = Math.round((total - 100) * 10) / 10;
      errors.push({ type: 'over_allocated', memberId: m.id, total, over,
        message: `${m.name} đang được phân bổ ${fmt(total)}% — vượt ${fmt(over)}% so với giới hạn 100%.` });
    }
  }
  for (const p of projects) {
    if (!assignments.some((a) => a.projectId === p.id)) {
      errors.push({ type: 'no_member', projectId: p.id, message: `Dự án ${p.name} cần ít nhất 1 nhân sự.` });
    }
  }
  return errors;
}

function fmt(n) {
  return String(Math.round(n * 10) / 10).replace('.', ',');
}
