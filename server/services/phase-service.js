// Project phases (Xây dựng / Ra mắt / Tăng trưởng / Ổn định), effective-dated, plus the build-phase budget.

import { periodCosts } from '../../shared/cost-timeline.js';
import { formatDate, formatVnd } from '../../shared/format.js';
import { PHASES, suggestedBaselines } from '../../shared/phases.js';
import { addDays, daysBetween, isWorkingDay } from '../../shared/periods.js';
import { BEGINNING, getProject, loadTimeline, tx } from '../database.js';
import { logChange } from './audit-log.js';
import { writeBaselines } from './baseline-service.js';
import { firstOpenDate as openDateFor } from '../../shared/closing.js';
import { todayIso } from '../clock.js';
import { WORKING_DAYS } from '../../shared/system-config.js';
import { httpError } from './connection-service.js';

export { PHASES, suggestedBaselines };

export function phaseHistory(db, projectId) {
  return db.prepare('SELECT * FROM project_phases WHERE project_id = ? ORDER BY effective_date, id').all(projectId)
    .map((r) => ({ phase: r.phase, label: PHASES[r.phase], effectiveDate: r.effective_date, createdBy: r.created_by }));
}

/** Phase in force on `date` and since when (projects without rows are "Tăng trưởng"). */
export function phaseAt(db, projectId, date) {
  const rows = phaseHistory(db, projectId);
  const cur = [...rows].reverse().find((r) => r.effectiveDate <= date);
  return cur ? { phase: cur.phase, label: cur.label, since: cur.effectiveDate } : { phase: 'growth', label: PHASES.growth, since: BEGINNING };
}

/**
 * Build-phase budget on `today`. Spend = latest "Chi phí lũy kế" manual value, else the system cost
 * accrued since the build phase started. Planned-to-date = budget × elapsed ÷ (launch − build start).
 */
export function budgetInfo(db, projectId, today, manual) {
  const project = getProject(db, projectId);
  const ph = phaseAt(db, projectId, today);
  if (ph.phase !== 'build') return { phase: ph.phase, inBuild: false };
  const budget = project.buildBudget || null;
  const entries = manual.currentValues(projectId, 'budget_burn');
  let spend;
  let spendSource;
  if (entries.length) {
    spend = entries.at(-1).value;
    spendSource = 'manual';
  } else {
    spend = cumulativeCost(db, projectId, ph.since, today);
    spendSource = 'system';
  }
  const launch = project.launchDate;
  const span = launch ? daysBetween(ph.since, launch) : null;
  const elapsed = Math.max(0, daysBetween(ph.since, today));
  const plannedToDate = budget && span > 0 ? budget * Math.min(1, elapsed / span) : budget;
  return {
    inBuild: true, phase: 'build', since: ph.since, budget, spend, spendSource,
    usedPct: budget ? (spend / budget) * 100 : null, plannedToDate,
    launchDate: launch, daysToLaunch: launch ? daysBetween(today, launch) : null,
  };
}

/** "Ngày bắt đầu tính chi phí": the first day the project was running (status Đang chạy), null if never. */
export function costStartDate(timeline, projectId) {
  return timeline.versions.filter((v) => v.entity === 'status' && v.entityId === projectId && v.data.status === 'active')
    .map((v) => v.effectiveDate).sort()[0] ?? null;
}

/**
 * "Chi phí lũy kế" from `from` to `today`: Σ the monthly cost of each month (configuration in force, day-weighted);
 * a month only partly covered — the current one, or the first one — counts its working days ÷ working days/month.
 */
export function cumulativeCost(db, projectId, from, today = todayIso(), timeline = loadTimeline(db)) {
  if (!from || from > today) return 0;
  let total = 0;
  for (let ym = from.slice(0, 7); ym <= today.slice(0, 7); ym = nextMonth(ym)) {
    const monthStart = `${ym}-01`;
    const monthLast = addDays(`${nextMonth(ym)}-01`, -1);
    const a = from > monthStart ? from : monthStart;
    // The current month counts the working days already passed (up to yesterday).
    const b = monthLast >= today ? addDays(today, -1) : monthLast;
    if (b < a) continue;
    const monthly = periodCosts(timeline, a, b).projects[projectId]?.total ?? 0;
    const full = a === monthStart && b === monthLast;
    total += full ? monthly : monthly * (workingDaysIn(a, b) / WORKING_DAYS);
  }
  return total;
}

function workingDaysIn(a, b) {
  let n = 0;
  for (let d = a; d <= b; d = addDays(d, 1)) if (isWorkingDay(d)) n += 1;
  return n;
}

function nextMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Change phase from `effectiveDate`; optionally apply the suggested baselines of the new phase. */
export function changePhase(db, projectId, body, actor, manual) {
  const project = getProject(db, projectId);
  if (!project) throw httpError(404, 'Không tìm thấy dự án');
  const phase = body.phase;
  if (!PHASES[phase]) throw httpError(422, 'Giai đoạn không hợp lệ.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.effectiveDate || '')) throw httpError(422, 'Chọn ngày hiệu lực.');
  const prev = phaseAt(db, projectId, body.effectiveDate);
  if (prev.phase === phase) throw httpError(422, `Dự án đã ở giai đoạn ${PHASES[phase]} vào ngày đó.`);
  tx(db, () => {
    db.prepare('INSERT INTO project_phases (project_id, phase, effective_date, created_at, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(projectId, phase, body.effectiveDate, new Date().toISOString(), actor);
    logChange(db, { projectId, actor, action: 'Giai đoạn dự án', field: 'Giai đoạn', oldValue: prev.label, newValue: PHASES[phase],
      effectiveDate: body.effectiveDate, reason: body.reason });
    if (body.applyBaselines) {
      const list = suggestedBaselines(phase, project.productType);
      const month = `${body.effectiveDate.slice(0, 7)}-01`;
      writeBaselines(db, projectId, list, { green: 80, red: 50, ...(body.thresholds ?? {}) }, actor, `Áp dụng bộ baseline gợi ý cho giai đoạn ${PHASES[phase]}`,
        month < openDateFor(todayIso()) ? openDateFor(todayIso()) : month);
      for (const b of list) manual.setSource(projectId, b.metricKey, b.source, b.period, body.effectiveDate, actor);
    }
  });
  return phaseAt(db, projectId, body.effectiveDate);
}

export function describeBudget(b) {
  if (!b?.inBuild) return null;
  return `Đang đầu tư · đã dùng ${b.usedPct == null ? '—' : Math.round(b.usedPct)}% ngân sách (${formatVnd(b.spend)} / ${formatVnd(b.budget)})`
    + (b.launchDate ? ` · Ra mắt dự kiến ${formatDate(b.launchDate)}` : '');
}

