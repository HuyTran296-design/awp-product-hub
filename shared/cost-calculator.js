// Team cost structure: personnel cost (direct + shared staff of the Dự án), Tools/AI split by effective FTE, unallocated cost.
// Tổng chi phí team = Σ lương nhân sự + Σ Tools/AI. All money values are VND per month unless suffixed with "Daily".

import { WORKING_DAYS } from './system-config.js';

/** How a parent project's own staff cost is split over its running child projects. */
export const PARENT_SPLIT_METHODS = {
  even: 'Chia đều', fte: 'Theo FTE trực tiếp của sản phẩm', revenue: 'Theo doanh thu của kỳ', manual: 'Thủ công %',
};
/** "Thuộc dự án" has no data of its own: its shared staff is always split down to its running children. */
export const NO_RUNNING_CHILD = 'Dự án chưa có sản phẩm để chia chi phí';

/**
 * @param {object} input
 * @param {{tools?:{id:string, name:string, monthlyCost:number, appliesTo?:number[]}[]}} input.settings
 *   Tools/AI; appliesTo = ids of Dự án (every product in it, also created later) or products; empty = "Tất cả sản phẩm"
 * @param {{id:number, monthlyCost:number}[]} input.members
 * @param {{id:number, name?:string, parentId?:number|null}[]} input.projects  running projects only
 * @param {{projectId:number, memberId:number, effortPct:number}[]} input.assignments  direct effort (parents included)
 * @param {{id:number, method:string, manualPct?:object, revenue?:object}[]} [input.parents]
 *   split settings of parent projects ("Nhân sự chung"); what cannot be split stays unallocated ("Chưa phân bổ")
 */
export function computeCosts({ settings, members, projects, assignments, parents = [] }) {
  const workingDays = WORKING_DAYS;
  const tools = settings?.tools ?? [];
  const memberById = new Map(members.map((m) => [m.id, m]));

  const payrollTotal = members.reduce((s, m) => s + m.monthlyCost, 0);
  const toolsTotal = tools.reduce((s, t) => s + t.monthlyCost, 0);
  const teamTotal = payrollTotal + toolsTotal;

  // Total effort per member across every project (a parent's staff counts once, at the parent).
  const memberEffort = Object.fromEntries(members.map((m) => [m.id, 0]));
  for (const a of assignments) if (memberById.has(a.memberId)) memberEffort[a.memberId] += a.effortPct;

  const perProject = projects.map((p) => {
    const rows = assignments
      .filter((a) => a.projectId === p.id && memberById.has(a.memberId))
      .map((a) => {
        const monthly = memberById.get(a.memberId).monthlyCost * (a.effortPct / 100);
        return { memberId: a.memberId, effortPct: a.effortPct, monthly, daily: monthly / workingDays };
      });
    const directOwn = rows.reduce((s, r) => s + r.monthly, 0);
    const directFte = rows.reduce((s, r) => s + r.effortPct, 0) / 100;
    return {
      projectId: p.id, parentId: p.parentId ?? null, members: rows, directOwn, directFte,
      parentShared: 0, parentFte: 0, parentShare: 0, toolRows: [],
    };
  });
  const byId = new Map(perProject.map((p) => [p.projectId, p]));

  // A running parent's shared staff → its running children. A parent never keeps cost: what no child can take is unallocated.
  const parentCosts = {};
  let unallocatedShared = 0;
  for (const cfg of parents) {
    const parent = byId.get(cfg.id);
    if (!parent) continue;
    const sharedRows = parent.members;
    const sharedCost = parent.directOwn;
    const sharedFte = parent.directFte;
    const children = perProject.filter((p) => p.parentId === cfg.id);
    const method = PARENT_SPLIT_METHODS[cfg.method] ? cfg.method : 'even';
    const weight = (c) => ({
      even: 1, fte: c.directFte, revenue: Math.max(0, cfg.revenue?.[c.projectId] ?? 0), manual: Number(cfg.manualPct?.[c.projectId] ?? 0),
    }[method] ?? 1);
    const totalWeight = children.reduce((s, c) => s + weight(c), 0);
    const warnings = [];
    let distributed = 0;
    if (sharedCost > 0 || sharedFte > 0) {
      if (method === 'fte') {
        for (const c of children) {
          if (!c.directFte) warnings.push({ projectId: c.projectId, message: `${projects.find((p) => p.id === c.projectId)?.name ?? 'Sản phẩm'} không có nhân sự trực tiếp nên không nhận chi phí nhân sự chung` });
        }
      }
      if (totalWeight > 0) {
        for (const c of children) {
          const share = weight(c) / totalWeight;
          c.parentShare = share;
          c.parentShared = sharedCost * share;
          c.parentFte = sharedFte * share;
          distributed += c.parentShared;
        }
      } else {
        warnings.push({ message: children.length ? 'Không sản phẩm nào đủ điều kiện nhận chi phí nhân sự chung — chi phí nằm ở "Lương chưa phân bổ".'
          : `${NO_RUNNING_CHILD} — chi phí nhân sự chung nằm ở "Lương chưa phân bổ".` });
      }
    }
    // The parent itself carries no cost and no FTE (so it takes no Tools/AI either).
    parent.directOwn = 0;
    parent.directFte = 0;
    parent.isParent = true;
    unallocatedShared += sharedCost - distributed;
    parentCosts[cfg.id] = { projectId: cfg.id, method, sharedRows, sharedCost, sharedFte,
      distributed, unallocated: sharedCost - distributed, warnings, childIds: children.map((c) => c.projectId) };
  }

  for (const p of perProject) {
    p.direct = p.directOwn + p.parentShared;     // personnel cost incl. the share of the parent's staff
    p.fte = p.directFte + p.parentFte;           // effective FTE
  }

  // Each tool → the running products in its "Áp dụng cho", by effective FTE within that group.
  const products = perProject.filter((p) => !p.isParent);
  let unallocatedTools = 0;
  for (const t of tools) {
    const scope = t.appliesTo ?? [];
    const group = scope.length ? products.filter((p) => scope.includes(p.projectId) || scope.includes(p.parentId)) : products;
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

  // Free effort + shared staff of parents without a running child to split to.
  const unallocatedPersonnel = members.reduce((s, m) => s + m.monthlyCost * (1 - memberEffort[m.id] / 100), 0) + unallocatedShared;
  const unallocated = unallocatedPersonnel + unallocatedTools;

  return {
    teamTotal,
    workingDays,
    payrollTotal,
    toolsTotal,
    fteTotal,
    memberEffort,
    projects: Object.fromEntries(perProject.map((p) => [p.projectId, p])),
    parents: parentCosts,
    unallocated,
    unallocatedPersonnel,
    unallocatedTools,
    unallocatedShared,
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
        message: `Effort của ${m?.name ?? 'nhân sự'} trong ${p?.name ?? 'sản phẩm'} phải trong khoảng 0–100%.` });
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
      errors.push({ type: 'no_member', projectId: p.id, message: `Sản phẩm ${p.name} cần ít nhất 1 nhân sự.` });
    }
  }
  return errors;
}

function fmt(n) {
  return String(Math.round(n * 10) / 10).replace('.', ',');
}
