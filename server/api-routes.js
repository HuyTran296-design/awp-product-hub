// REST API — session, dashboards, team costs, members. Project management lives in project-routes.js.
// Viewer: read-only dashboards + project list. Admin: everything incl. configuration and per-person cost.

import { periodCosts, PROJECT_STATUSES, stateAt } from '../shared/cost-timeline.js';
import { formatVnd } from '../shared/format.js';
import { METRIC_CATALOG } from '../shared/metric-catalog.js';
import { PERIODS, addDays, dateList, getPeriod, isWorkingDay } from '../shared/periods.js';
import { addMonths } from '../shared/closing.js';
import { visibleProjectIds } from './scope.js';
import { addVersion, listMembers, listProjects, loadTimeline, tx } from './database.js';
import { changePrice, hasClosedCost, monthlyTable, saveTools, setActual } from './services/tool-cost-service.js';
import { missingActuals, priceAt, toolMonth } from '../shared/tool-costs.js';
import { revenueMetricFor } from '../shared/metric-catalog.js';
import { WORKING_DAYS } from '../shared/system-config.js';
import { phaseAt } from './services/phase-service.js';
import { listHistory, logChange } from './services/audit-log.js';
import { httpError, SOURCES } from './services/connection-service.js';
import { assertOpenDate, firstOpenDate, projectStatus, today } from './services/project-service.js';
import { costShare, DASHBOARD_STATUSES } from './services/report-service.js';

export function buildRoutes({ db, reports }) {
  /** Project id from the URL, 404 if unknown, 403 if outside the user's view scope. */
  const projectIdOf = (params, user) => {
    const id = Number(params.id);
    if (!listProjects(db).some((p) => p.id === id)) throw httpError(404, 'Không tìm thấy dự án');
    const visible = visibleProjectIds(db, user);
    if (visible && !visible.has(id)) throw httpError(403, 'Bạn không có quyền truy cập');
    return id;
  };

  return [
    ['GET', '/api/meta', ({ user }) => {
      const timeline = loadTimeline(db);
      const visible = visibleProjectIds(db, user);
      const all = listProjects(db);
      // Menu: projects that appear on the Dashboard today (running or paused), sorted by name.
      const projects = all.map(({ id, name, color, platforms }) => ({ id, name, color, platforms, status: projectStatus(timeline, id).status }))
        .filter((p) => DASHBOARD_STATUSES.includes(p.status) && (!visible || visible.has(p.id)))
        .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      return { user, periods: PERIODS, catalog: METRIC_CATALOG, today: today(), firstOpenDate: firstOpenDate(), projects };
    }, 'user'],

    ['GET', '/api/dashboard', ({ query, user }) => reports.dashboard(getPeriod(query.period).key, visibleProjectIds(db, user)), 'user'],
    // Admins also get the project's failed data connections (one small warning line on Tổng quan).
    ['GET', '/api/projects/:id/overview', async ({ params, query, user }) => {
      const id = projectIdOf(params, user);
      const data = await reports.overview(id, getPeriod(query.period).key, user);
      if (user.role !== 'admin') return data;
      const failed = db.prepare("SELECT source FROM connections WHERE project_id = ? AND status = 'error' ORDER BY source").all(id);
      return { ...data, connectionErrors: failed.map((c) => SOURCES[c.source]?.name ?? c.source) };
    }, 'user'],
    ['GET', '/api/projects/:id/marketing', ({ params, query, user }) =>
      reports.marketing(projectIdOf(params, user), getPeriod(query.period).key), 'user'],

    // ----- Chi phí team -----
    ['GET', '/api/team-costs', ({ query }) => teamCostsPayload(db, reports, query.month), 'admin'],
    // Cấu hình tab: the whole tool list. Theo tháng tab: actual of one tool in one month (null = back to the estimate).
    ['PUT', '/api/team-costs', ({ body, user }) => {
      saveTools(db, body, { actor: user.name, openMonth: firstOpenDate().slice(0, 7) });
      return teamCostsPayload(db, reports, body.month);
    }, 'admin'],
    ['POST', '/api/team-costs/tools/:id/prices', ({ params, body, user }) => {
      changePrice(db, String(params.id), body, { actor: user.name, openMonth: firstOpenDate().slice(0, 7) });
      return teamCostsPayload(db, reports, body.month);
    }, 'admin'],
    ['PUT', '/api/team-costs/actuals', ({ body, user }) => {
      setActual(db, body, { actor: user.name });
      return teamCostsPayload(db, reports, body.viewMonth);
    }, 'admin'],

    // ----- Nhân sự -----
    ['GET', '/api/members', () => membersPayload(db), 'admin'],
    ['POST', '/api/members', ({ body, user }) => {
      const m = parseMember(body);
      const date = body.effectiveDate || firstOpenDate();
      assertOpenDate(date);
      tx(db, () => {
        const id = Number(db.prepare('INSERT INTO members (name, role, is_admin) VALUES (?, ?, ?)').run(m.name, m.role, m.isAdmin ? 1 : 0).lastInsertRowid);
        addVersion(db, { entity: 'member_cost', entityId: id, effectiveDate: date, data: { monthlyCost: m.monthlyCost }, actor: user.name });
        logChange(db, { actor: user.name, action: 'Nhân sự', field: `Thêm ${m.name}`, oldValue: '—',
          newValue: `${m.role} · ${formatVnd(m.monthlyCost)}/tháng`, effectiveDate: date });
      });
      return { status: 201, body: membersPayload(db) };
    }, 'admin'],
    ['PUT', '/api/members/:id', ({ params, body, user }) => {
      const id = Number(params.id);
      const old = listMembers(db).find((x) => x.id === id);
      if (!old) throw httpError(404, 'Không tìm thấy nhân sự');
      const m = parseMember(body);
      const date = body.effectiveDate || firstOpenDate();
      assertOpenDate(date);
      const oldCost = stateAt(loadTimeline(db), date).members.find((x) => x.id === id)?.monthlyCost;
      tx(db, () => {
        db.prepare('UPDATE members SET name = ?, role = ?, is_admin = ? WHERE id = ?').run(m.name, m.role, m.isAdmin ? 1 : 0, id);
        const log = (field, o, n, eff = null) => logChange(db, { actor: user.name, action: 'Nhân sự', field, oldValue: o, newValue: n, effectiveDate: eff });
        if (old.name !== m.name) log('Họ tên', old.name, m.name);
        if (old.role !== m.role) log(`Vai trò ${m.name}`, old.role, m.role);
        if (old.isAdmin !== m.isAdmin) log(`Quyền Admin ${m.name}`, old.isAdmin ? 'Có' : 'Không', m.isAdmin ? 'Có' : 'Không');
        if (oldCost !== m.monthlyCost) {
          addVersion(db, { entity: 'member_cost', entityId: id, effectiveDate: date, data: { monthlyCost: m.monthlyCost }, actor: user.name });
          log(`Chi phí nhân sự/tháng ${m.name}`, formatVnd(oldCost ?? 0), formatVnd(m.monthlyCost), date);
        }
      });
      return membersPayload(db);
    }, 'admin'],
    ['DELETE', '/api/members/:id', ({ params, user }) => {
      const id = Number(params.id);
      const m = listMembers(db).find((x) => x.id === id);
      if (!m) throw httpError(404, 'Không tìm thấy nhân sự');
      const date = firstOpenDate();
      const st = stateAt(loadTimeline(db), date);
      const orphan = listProjects(db).find((p) => st.statuses[p.id] === 'active'
        && st.staffing[p.id].rows.length && st.staffing[p.id].rows.every((r) => r.memberId === id));
      if (orphan) throw httpError(422, `Không thể xóa: dự án ${orphan.name} sẽ không còn nhân sự nào.`);
      tx(db, () => {
        // Soft delete: cost history in closed months is kept; from this month the member leaves every project.
        db.prepare('UPDATE members SET active = 0 WHERE id = ?').run(id);
        addVersion(db, { entity: 'member_cost', entityId: id, effectiveDate: date, data: { monthlyCost: 0, removed: true }, actor: user.name });
        logChange(db, { actor: user.name, action: 'Nhân sự', field: `Xóa ${m.name}`, oldValue: m.role, newValue: '—', effectiveDate: date });
      });
      return membersPayload(db);
    }, 'admin'],
    ['GET', '/api/team-history', () => ({ history: listHistory(db, null) }), 'admin'],
  ];
}

/**
 * State of a month in "Phân bổ chi phí":
 * provisional = current month (costs × working days elapsed up to the latest data ÷ 21, revenue up to that day);
 * open = past month not closed yet (before day 3 of the next month) or a "Theo mức dùng" tool still without its actual;
 * closed; future = planned costs, no revenue yet.
 */
async function monthState(db, reports, timeline, m, projects) {
  const now = today();
  const cur = now.slice(0, 7);
  if (m > cur) return { status: 'future', factor: 1, revenueTo: null };
  if (m === cur) {
    const end = await reports.endDate(projects);
    const days = end >= `${m}-01` ? dateList(`${m}-01`, end).filter(isWorkingDay).length : 0;
    return { status: 'provisional', factor: days / WORKING_DAYS, revenueTo: end, through: end, workingDaysElapsed: days };
  }
  const missing = missingActuals(timeline.tools, timeline.toolActuals, now, m).some((x) => x.month === m);
  return { status: `${m}-01` < firstOpenDate() && !missing ? 'closed' : 'open', factor: 1, revenueTo: addDays(`${addMonths(m, 1)}-01`, -1) };
}

/**
 * Chi phí team: the Tools/AI list (editable), its monthly table (Theo tháng) and the month's allocation per project
 * (Lương · Tools/AI · Tổng chi phí · % ‖ Doanh thu · Lãi/Lỗ), plus "Lương chưa phân bổ" and "Tools/AI chưa phân bổ".
 * The current month is provisional: every cost × working days elapsed ÷ 21.
 */
async function teamCostsPayload(db, reports, month) {
  const timeline = loadTimeline(db);
  const open = firstOpenDate();
  const m = /^\d{4}-\d{2}$/.test(month || '') ? month : open.slice(0, 7);
  const from = `${m}-01`;
  const to = addDays(`${addMonths(m, 1)}-01`, -1);
  const per = periodCosts(timeline, from, to);
  const projects = listProjects(db);
  const live = new Map(projects.map((p) => [p.id, p]));
  const endState = stateAt(timeline, to);
  const memberName = new Map(timeline.members.map((x) => [x.id, x.name]));
  const toolName = new Map(timeline.tools.map((t) => [t.id, t.name]));

  const state = await monthState(db, reports, timeline, m, projects);
  const k = state.factor;
  const revenueOf = async (p) => (state.revenueTo
    ? (await reports.metrics.aggregate(p.id, revenueMetricFor(p.productType), from, state.revenueTo)).value ?? 0 : null);

  const rows = [];
  const deleted = { id: null, name: 'Dự án đã xóa', deleted: true, fte: 0, salary: 0, tools: 0, total: 0, teamPct: 0, revenue: state.revenueTo ? 0 : null };
  for (const p of timeline.projects) {
    const pc = per.projects[p.id];
    if (!live.has(p.id)) {
      if (pc?.total > 0.5) { deleted.fte += pc.fte; deleted.salary += pc.direct * k; deleted.tools += pc.tools * k; deleted.total += pc.total * k; deleted.teamPct += pc.teamPct; }
      continue;
    }
    const status = endState.statuses[p.id];
    if (!(pc?.total > 0.5) && !['active', 'paused'].includes(status)) continue;
    const project = live.get(p.id);
    const revenue = await revenueOf(project);
    rows.push({
      id: p.id, name: p.name, color: p.color, status, statusLabel: PROJECT_STATUSES[status] ?? '—',
      fte: pc.fte, salary: pc.direct * k, tools: pc.tools * k, total: pc.total * k, teamPct: pc.teamPct,
      revenue, profit: revenue == null ? null : revenue - pc.total * k,
      // "Xây dựng": a negative result reads "Đang đầu tư", not "Lỗ".
      investing: phaseAt(db, p.id, state.revenueTo ?? to).phase === 'build',
      // Detail of the cost: each person (Lương) and each tool it gets.
      detail: {
        members: Object.values(pc.detail.members).filter((x) => x.monthly > 0.5)
          .map((x) => ({ name: memberName.get(x.memberId) ?? 'Nhân sự đã xóa', effortPct: x.effortPct, monthly: x.monthly * k })),
        tools: Object.values(pc.detail.tools).filter((x) => x.amount > 0.5).map((x) => ({ name: toolName.get(x.toolId) ?? x.name, amount: x.amount * k })),
      },
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  if (deleted.total > 0.5) rows.push({ ...deleted, profit: deleted.revenue == null ? null : -deleted.total });

  const openState = stateAt(timeline, open);
  const openMonth = open.slice(0, 7);
  const now = today();
  const monthly = monthlyTable(timeline.tools, timeline.toolActuals, now);
  // "gồm số dự kiến": a tool of the chosen month still without its actual.
  const includesPlanned = timeline.tools.some((t) => { const c = toolMonth(t, m, timeline.toolActuals); return c.active && c.actual == null; });
  const months = [];
  for (let k = -12; k <= 12; k++) months.push(addMonths(open.slice(0, 7), k));
  const pct = (v) => (per.teamTotal ? (v / per.teamTotal) * 100 : 0);
  const revenueTotal = state.revenueTo ? rows.reduce((s, r) => s + (r.revenue ?? 0), 0) : null;
  return {
    month: m, closed: state.status === 'closed', monthState: state, firstOpenDate: open, months,
    today: now,
    // Each tool with its price this month and whether it can still be removed (no cost in a closed month).
    settings: { tools: timeline.tools.map((t) => ({ ...t, currentPrice: priceAt(t, now.slice(0, 7)), canDelete: !hasClosedCost(t, openMonth) })) },
    actuals: timeline.toolActuals,
    monthly,
    history: listHistory(db, null, { action: 'Chi phí Tools/AI' }).slice(0, 100),
    payroll: { total: openState.members.reduce((s, x) => s + x.monthlyCost, 0), count: openState.members.length },
    // "Áp dụng cho": every project, sorted by name.
    scopeOptions: projects.map((p) => ({ id: p.id, name: p.name, color: p.color })).sort((a, b) => a.name.localeCompare(b.name, 'vi')),
    table: {
      rows, teamTotal: per.teamTotal * k, payrollTotal: per.payrollTotal * k, toolsTotal: per.toolsTotal * k,
      unallocatedSalary: per.unallocatedPersonnel * k, unallocatedSalaryPct: pct(per.unallocatedPersonnel),
      unallocatedTools: per.unallocatedTools * k, unallocatedToolsPct: pct(per.unallocatedTools),
      // Lãi/Lỗ team = Σ doanh thu − Tổng chi phí team (incl. the unallocated cost) = Σ of the Lãi/Lỗ column.
      revenueTotal, profitTotal: revenueTotal == null ? null : revenueTotal - per.teamTotal * k,
      workingDays: per.workingDays,
      toolsIncludePlanned: includesPlanned,
    },
    costShare: costShare(timeline, per, db),
  };
}


function membersPayload(db) {
  const timeline = loadTimeline(db);
  const st = stateAt(timeline, today());
  const projects = listProjects(db);
  return {
    firstOpenDate: firstOpenDate(),
    members: listMembers(db).map((m) => {
      const mine = st.assignments.filter((a) => a.memberId === m.id);
      return { ...m, monthlyCost: st.members.find((x) => x.id === m.id)?.monthlyCost ?? 0,
        totalEffort: mine.reduce((s, a) => s + a.effortPct, 0),
        projects: mine.map((a) => ({ projectId: a.projectId, name: projects.find((p) => p.id === a.projectId)?.name,
          effortPct: a.effortPct })) };
    }),
  };
}

function parseMember(body) {
  const name = String(body.name || '').trim();
  const role = String(body.role || '').trim();
  const monthlyCost = Number(body.monthlyCost);
  if (!name) throw httpError(422, 'Vui lòng nhập họ tên.');
  if (!role) throw httpError(422, 'Vui lòng nhập vai trò.');
  if (!(monthlyCost >= 0)) throw httpError(422, 'Chi phí nhân sự/tháng phải ≥ 0.');
  return { name, role, monthlyCost, isAdmin: Boolean(body.isAdmin) };
}
