// REST API — session, dashboards, team costs, members. Project management lives in project-routes.js.
// Viewer: read-only dashboards + project list. Admin: everything incl. configuration and per-person cost.

import { periodCosts, PROJECT_STATUSES, stateAt } from '../shared/cost-timeline.js';
import { formatNumber, formatVnd } from '../shared/format.js';
import { METRIC_CATALOG } from '../shared/metric-catalog.js';
import { PERIODS, addDays, getPeriod } from '../shared/periods.js';
import { addMonths } from '../shared/closing.js';
import { visibleProjectIds } from './scope.js';
import { addVersion, listMembers, listProjects, loadTimeline, tx } from './database.js';
import { FAR_FUTURE, parentOf } from './services/parent-service.js';
import { listHistory, logChange } from './services/audit-log.js';
import { httpError, SOURCES } from './services/connection-service.js';
import { assertOpenDate, firstOpenDate, projectStatus, today } from './services/project-service.js';
import { costShare, DASHBOARD_STATUSES } from './services/report-service.js';

export function buildRoutes({ db, reports }) {
  /** Project id from the URL, 404 if unknown, 403 if outside the user's view scope. */
  const projectIdOf = (params, user) => {
    const id = Number(params.id);
    if (!listProjects(db).some((p) => p.id === id)) throw httpError(404, 'Không tìm thấy dự án hoặc sản phẩm');
    const visible = visibleProjectIds(db, user);
    if (visible && !visible.has(id)) throw httpError(403, 'Bạn không có quyền truy cập');
    return id;
  };

  return [
    ['GET', '/api/meta', ({ user }) => {
      const timeline = loadTimeline(db);
      const visible = visibleProjectIds(db, user);
      const all = listProjects(db);
      // Sidebar tree: projects that appear on the Dashboard today (running or paused) with their "Thuộc dự án".
      // parentId is today's parent; scheduledParentId the latest scheduled one (a move later this month).
      // kind: 'folder' = Dự án (its only page is the Trang tổng hợp).
      const projects = all.map(({ id, name, color, platforms, kind, icon }) => ({ id, name, color, platforms, kind, icon,
        status: projectStatus(timeline, id).status, parentId: parentOf(timeline, id, today()), scheduledParentId: parentOf(timeline, id, FAR_FUTURE) }))
        .filter((p) => DASHBOARD_STATUSES.includes(p.status) && (!visible || visible.has(p.id)));
      // A Viewer who sees only some products of a Dự án still sees the Dự án name as a (non-clickable) group in the menu.
      const lockedParents = [...new Set(projects.map((p) => p.parentId).filter((id) => id != null && visible && !visible.has(id)))]
        .map((id) => all.find((p) => p.id === id)).filter(Boolean).map(({ id, name, color }) => ({ id, name, color }));
      return { user, periods: PERIODS, catalog: METRIC_CATALOG, today: today(), firstOpenDate: firstOpenDate(), projects, lockedParents };
    }, 'user'],

    ['GET', '/api/dashboard', ({ query, user }) => reports.dashboard(getPeriod(query.period).key, visibleProjectIds(db, user)), 'user'],
    // A Dự án answers with its Trang tổng hợp ({ folder: true, … }).
    // Admins also get the product's failed data connections (one small warning line on Tổng quan).
    ['GET', '/api/projects/:id/overview', async ({ params, query, user }) => {
      const id = projectIdOf(params, user);
      const data = await reports.overview(id, getPeriod(query.period).key, user);
      if (user.role !== 'admin' || data.folder) return data;
      const failed = db.prepare("SELECT source FROM connections WHERE project_id = ? AND status = 'error' ORDER BY source").all(id);
      return { ...data, connectionErrors: failed.map((c) => SOURCES[c.source]?.name ?? c.source) };
    }, 'user'],
    ['GET', '/api/projects/:id/marketing', ({ params, query, user }) =>
      reports.marketing(projectIdOf(params, user), getPeriod(query.period).key), 'user'],

    // ----- Chi phí team -----
    ['GET', '/api/team-costs', ({ query }) => teamCostsPayload(db, query.month), 'admin'],
    ['PUT', '/api/team-costs', ({ body, user }) => {
      const date = body.effectiveDate;
      assertOpenDate(date);
      const next = {
        fixedMonthlyCost: Number(body.fixedMonthlyCost), workingDays: Number(body.workingDays),
        allocationMode: body.allocationMode === 'manual' ? 'manual' : 'fte', usdVndRate: Number(body.usdVndRate),
      };
      const errors = [];
      if (!(next.fixedMonthlyCost > 0)) errors.push({ message: 'Chi phí cố định của team phải lớn hơn 0.' });
      if (!(Number.isInteger(next.workingDays) && next.workingDays >= 1 && next.workingDays <= 31)) errors.push({ message: 'Số ngày làm việc/tháng phải từ 1 đến 31.' });
      if (!(next.usdVndRate > 0)) errors.push({ message: 'Tỷ giá USD → VND phải lớn hơn 0.' });
      if (errors.length) throw httpError(422, errors[0].message, errors);
      const prev = stateAt(loadTimeline(db), date).settings;
      const MODES = { fte: 'Theo tỷ lệ FTE', manual: 'Nhập % thủ công' };
      tx(db, () => {
        addVersion(db, { entity: 'team', entityId: 0, effectiveDate: date, data: next, actor: user.name });
        const log = (field, o, n) => logChange(db, { actor: user.name, action: 'Chi phí team', field, oldValue: o, newValue: n, effectiveDate: date, reason: body.reason });
        if (prev.fixedMonthlyCost !== next.fixedMonthlyCost) log('Chi phí cố định team/tháng', formatVnd(prev.fixedMonthlyCost), formatVnd(next.fixedMonthlyCost));
        if (prev.workingDays !== next.workingDays) log('Số ngày làm việc/tháng', prev.workingDays, next.workingDays);
        if (prev.allocationMode !== next.allocationMode) log('Cách phân bổ chi phí chung', MODES[prev.allocationMode], MODES[next.allocationMode]);
        if (prev.usdVndRate !== next.usdVndRate) log('Tỷ giá USD → VND', formatNumber(prev.usdVndRate), formatNumber(next.usdVndRate));
      });
      return teamCostsPayload(db, date.slice(0, 7));
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
      if (orphan) throw httpError(422, `Không thể xóa: sản phẩm ${orphan.name} sẽ không còn nhân sự nào.`);
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

/** Month view of team cost allocation (closed months are read-only history). */
function teamCostsPayload(db, month) {
  const timeline = loadTimeline(db);
  const open = firstOpenDate();
  const m = /^\d{4}-\d{2}$/.test(month || '') ? month : open.slice(0, 7);
  const from = `${m}-01`;
  const to = addDays(`${addMonths(m, 1)}-01`, -1);
  const per = periodCosts(timeline, from, to);
  const live = new Map(listProjects(db).map((p) => [p.id, p]));
  const rows = [];
  const deleted = { name: 'Sản phẩm đã xóa', deleted: true, fte: 0, direct: 0, overhead: 0, total: 0, teamPct: 0 };
  const endState = stateAt(timeline, to);
  for (const p of timeline.projects) {
    const pc = per.projects[p.id];
    const status = endState.statuses[p.id];
    if (!live.has(p.id)) {
      if (pc?.total > 0) for (const k of ['fte', 'direct', 'overhead', 'total', 'teamPct']) deleted[k] += pc[k];
      continue;
    }
    if (live.get(p.id).isFolder) continue; // a Dự án carries no cost: its shared staff is in its products (or Chưa phân bổ)
    if (!(pc?.total > 0) && !['active', 'paused'].includes(status)) continue;
    rows.push({ id: p.id, name: p.name, color: p.color, status, statusLabel: PROJECT_STATUSES[status] ?? '—', ...pc });
  }
  if (deleted.total > 0) rows.push(deleted);
  const months = [];
  for (let k = -12; k <= 12; k++) months.push(addMonths(open.slice(0, 7), k));
  return {
    month: m, closed: from < open, firstOpenDate: open, months,
    settings: stateAt(timeline, open).settings,
    settingsVersions: timeline.versions.filter((v) => v.entity === 'team').sort((a, b) => b.seq - a.seq)
      .map((v) => ({ effectiveDate: v.effectiveDate, createdAt: v.createdAt, createdBy: v.createdBy, ...v.data })),
    // unallocatedShared: "Nhân sự chung" of Dự án that have no running child to split it to (part of Chưa phân bổ).
    table: { rows, unallocated: per.unallocated, unallocatedPct: per.unallocatedPct, unallocatedShared: per.unallocatedShared, teamTotal: per.teamTotal,
      payrollTotal: per.payrollTotal, overheadFund: per.overheadFund, overheadNegative: per.overheadNegative,
      workingDays: per.workingDays },
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
