// REST API — Quản lý dự án: list, wizard, edit tabs (info, connections, staffing, baselines, history), lifecycle.

import { PROJECT_STATUSES, stateAt } from '../shared/cost-timeline.js';
import { getPeriod } from '../shared/periods.js';
import { baselineVersionAt, getBaselines, getProject, getThresholds, listBaselineVersions, listProjects, loadTimeline, PRODUCT_TYPES, tx } from './database.js';
import {
  currentChildren, DELETE_PROJECT_TIP, FAR_FUTURE, liveProducts, moveProject, parentOf, parentOptions, saveChildTemplate,
} from './services/parent-service.js';
import { SUGGESTED_CONNECTIONS } from '../shared/product-types.js';
import { budgetInfo, phaseAt } from './services/phase-service.js';
import { listHistory } from './services/audit-log.js';
import { getDefaultPolicy, initPolicy } from './services/stoploss-service.js';
import { createPromoSource, deletePromoSource, listPromoSources, updatePromoSource } from './services/promo-source-service.js';
import { parseBaselines, validateBaselines, writeBaselines } from './services/baseline-service.js';
import {
  httpError, listConnections, saveConnection, SOURCES, syncConnection, testConnection,
} from './services/connection-service.js';
import {
  ACTION_LABELS, applyLifecycle, assertOpenDate, nounOf, createProject, firstOpenDate, previewLifecycle, previewNewProject, previewStaffing,
  projectStatus, saveStaffing, staffingContext, today, TRANSITIONS, updateInfo,
} from './services/project-service.js';

export function buildProjectRoutes({ db, reports, dataSource, secretKey, manual, targets }) {
  const idOf = (params) => {
    const id = Number(params.id);
    if (!getProject(db, id)) throw httpError(404, 'Không tìm thấy dự án hoặc sản phẩm');
    return id;
  };
  const sourceOf = (params) => {
    if (!SOURCES[params.source]) throw httpError(400, 'Nguồn dữ liệu không hợp lệ');
    return params.source;
  };

  return [
    ['GET', '/api/projects', ({ user }) => projectList(db, reports, user), 'admin'],
    ['POST', '/api/projects', ({ body, user }) => {
      const project = createProject(db, body, user.name, { secretKey, dataSource });
      // Stop-loss: the parent template's policy when the wizard used one, else the team default; tracking from the cost start date.
      // A Dự án starts with its stop-loss off (the block shows on its page only once enabled).
      initPolicy(db, project.id, body.stopLoss ? { ...body.stopLoss, startDate: null }
        : project.isFolder ? { ...getDefaultPolicy(db), startDate: null, enabled: false } : null);
      return { status: 201, body: { project } };
    }, 'admin'],
    ['POST', '/api/projects/preview', ({ body }) => previewNewProject(db, body), 'admin'],
    // Member list + free effort on a date, for the wizard (no project yet).
    ['GET', '/api/staffing-context', ({ query }) =>
      staffingContext(db, null, /^\d{4}-\d{2}-\d{2}$/.test(query.date || '') ? query.date : firstOpenDate()), 'admin'],

    ['GET', '/api/projects/:id/edit', ({ params }) => {
      const id = idOf(params);
      const timeline = loadTimeline(db);
      const st = projectStatus(timeline, id);
      const project = getProject(db, id);
      const common = {
        project, productTypes: PRODUCT_TYPES, firstOpenDate: firstOpenDate(), today: today(),
        status: { ...st, label: PROJECT_STATUSES[st.status], latestLabel: PROJECT_STATUSES[st.latest] },
        actions: actionsFor(st.latest, project, liveProducts(db, id, timeline, today()).length),
        children: currentChildren(db, id, timeline, today()).map((p) => ({ id: p.id, name: p.name, color: p.color })),
      };
      // A Dự án: Thông tin (incl. thresholds of the composite score) · Nhân sự chung · Mẫu · Cắt lỗ · Lịch sử.
      if (project.isFolder) return { ...common, thresholds: getThresholds(db, id) };
      return {
        ...common,
        connections: listConnections(db, id),
        baselines: getBaselines(db, id).map((b) => {
          const src = manual.sourceAt(id, b.metricKey, today());
          return { ...b, source: src?.source ?? 'auto', period: src?.period ?? 'month', sources: manual.sources(id, b.metricKey) };
        }),
        thresholds: getThresholds(db, id),
        // "Hiệu lực từ tháng" of the targets shown (latest saved version) and the version history.
        baselineEffective: baselineVersionAt(db, id)?.effectiveDate ?? null,
        baselineVersions: listBaselineVersions(db, id),
        phase: phaseAt(db, id, today()), budget: budgetInfo(db, id, today(), manual), suggestedConnections: SUGGESTED_CONNECTIONS[getProject(db, id).productType] ?? null,
        // "Thuộc dự án": today's / latest scheduled parent and the picker options (projects of kind Dự án).
        parentId: parentOf(timeline, id, today()), scheduledParentId: parentOf(timeline, id, FAR_FUTURE),
        parentOptions: parentOptions(db, id, today()),
      };
    }, 'admin'],
    // "Tham chiếu" of monthly targets; a project not created yet passes its parent and wizard staffing (break-even).
    ['POST', '/api/baseline-references', ({ body }) => {
      const projectId = body.projectId ? idOf({ id: body.projectId }) : null;
      let breakEven = null;
      if (!projectId && body.staffing) {
        try {
          const pv = previewNewProject(db, { info: { name: 'Sản phẩm mới', parentId: body.parentId ?? null }, staffing: body.staffing, activationDate: firstOpenDate() });
          breakEven = pv.preview.rows.find((r) => r.projectId === -1)?.after.total ?? null;
        } catch { breakEven = null; }
      }
      return targets.references({ projectId, parentId: body.parentId ? Number(body.parentId) : null, metrics: body.metrics ?? [], breakEven });
    }, 'admin'],
    ['GET', '/api/parent-options', () => ({ options: parentOptions(db, null, today()) }), 'admin'],
    ['POST', '/api/projects/:id/move', ({ params, body, user }) => moveProject(db, idOf(params), body, user.name, assertOpenDate), 'admin'],
    ['PUT', '/api/projects/:id/child-template', ({ params, body, user }) => ({ project: saveChildTemplate(db, idOf(params), body, user.name) }), 'admin'],
    ['PUT', '/api/projects/:id/info', ({ params, body, user }) => ({ project: updateInfo(db, idOf(params), body, user.name) }), 'admin'],

    ['GET', '/api/projects/:id/staffing', ({ params, query }) =>
      staffingContext(db, idOf(params), /^\d{4}-\d{2}-\d{2}$/.test(query.date || '') ? query.date : firstOpenDate()), 'admin'],
    ['POST', '/api/projects/:id/staffing/preview', ({ params, body }) => previewStaffing(db, idOf(params), body), 'admin'],
    ['PUT', '/api/projects/:id/staffing', ({ params, body, user }) => saveStaffing(db, idOf(params), body, user.name), 'admin'],

    ['PUT', '/api/projects/:id/baselines', ({ params, body, user }) => {
      const id = idOf(params);
      if (getProject(db, id).isFolder) throw httpError(422, 'Dự án không có baseline riêng: điểm tổng hợp lấy từ các sản phẩm.');
      const { list, thresholds, sourceDate } = parseBaselines(body);
      const errors = validateBaselines(list, thresholds);
      if (errors.length) throw httpError(422, errors[0].message, errors);
      // A source change keeps the old data until the chosen date; new data counts from that date.
      const date = sourceDate ?? firstOpenDate();
      if (date < firstOpenDate()) throw httpError(422, 'Ngày đổi nguồn không được nằm trong tháng đã chốt sổ.');
      // Targets, weights and thresholds apply "Hiệu lực từ tháng" (first day of an open month).
      const month = /^\d{4}-\d{2}-01$/.test(body.effectiveMonth || '') ? body.effectiveMonth : firstOpenDate();
      if (month < firstOpenDate()) throw httpError(422, 'Không thể áp dụng mục tiêu mới cho tháng đã chốt sổ.');
      return tx(db, () => {
        const r = writeBaselines(db, id, list, thresholds, user.name, body.reason, month);
        for (const b of list) if (b.source) manual.setSource(id, b.metricKey, b.source, b.period, date, user.name);
        return r;
      });
    }, 'admin'],

    ['GET', '/api/projects/:id/promo-sources', ({ params }) => {
      const id = idOf(params);
      return { sources: listPromoSources(db, id),
        projects: listProjects(db).filter((p) => p.id !== id).map((p) => ({ id: p.id, name: p.name })) };
    }, 'admin'],
    ['POST', '/api/projects/:id/promo-sources', ({ params, body, user }) =>
      ({ source: createPromoSource(db, idOf(params), body, user.name) }), 'admin'],
    ['PUT', '/api/projects/:id/promo-sources/:sid', ({ params, body, user }) =>
      ({ source: updatePromoSource(db, idOf(params), Number(params.sid), body, user.name) }), 'admin'],
    ['DELETE', '/api/projects/:id/promo-sources/:sid', ({ params, user }) => {
      deletePromoSource(db, idOf(params), Number(params.sid), user.name);
      return { ok: true };
    }, 'admin'],
    ['PUT', '/api/projects/:id/connections/:source', ({ params, body, user }) => {
      if (body.secret && body.secret.length > 20000) throw httpError(422, 'Tệp khóa quá lớn.');
      return { connection: saveConnection(db, secretKey, idOf(params), sourceOf(params), body, user.name) };
    }, 'admin'],
    ['POST', '/api/projects/:id/connections/:source/test', ({ params }) =>
      ({ connection: testConnection(db, idOf(params), sourceOf(params)) }), 'admin'],
    ['POST', '/api/projects/:id/connections/:source/sync', ({ params }) => {
      const id = idOf(params);
      const archived = projectStatus(loadTimeline(db), id).status === 'archived';
      return { connection: syncConnection(db, id, sourceOf(params), { archived }) };
    }, 'admin'],

    ['POST', '/api/projects/:id/lifecycle/preview', async ({ params, body }) => {
      const id = idOf(params);
      const result = previewLifecycle(db, id, body);
      // Revenue keeps counting while paused: show last month's revenue as the run-rate next to the new cost.
      const month = await reports.monthRevenue(id);
      return { ...result, revenueMonthly: month };
    }, 'admin'],
    ['POST', '/api/projects/:id/lifecycle', ({ params, body, user }) =>
      applyLifecycle(db, idOf(params), body, user.name, { dataSource }), 'admin'],

    ['GET', '/api/projects/:id/history', ({ params }) => ({ history: listHistory(db, idOf(params)) }), 'admin'],
  ];
}

/**
 * Lifecycle actions valid for the latest status. Sản phẩm: Xóa is listed but locked while running/paused.
 * Dự án: Xóa from any status, locked while it still has products that are not archived.
 */
function actionsFor(latest, project, liveCount = 0) {
  const valid = (TRANSITIONS[latest] ?? []).filter((a) => !(project?.isFolder && a === 'delete'));
  const label = (a) => (a === 'activate' ? `Kích hoạt ${nounOf(project)}` : a === 'delete' && latest === 'archived' ? 'Xóa vĩnh viễn' : ACTION_LABELS[a]);
  const list = valid.map((a) => ({ action: a, label: label(a) }));
  if (project?.isFolder) {
    list.push({ action: 'delete', label: latest === 'archived' ? 'Xóa vĩnh viễn' : 'Xóa', ...(liveCount ? { locked: true, tip: DELETE_PROJECT_TIP } : {}) });
  } else if (['active', 'paused'].includes(latest)) list.push({ action: 'delete', label: 'Xóa', locked: true, tip: 'Hãy lưu trữ sản phẩm trước khi xóa' });
  return list;
}

async function projectList(db, reports, user) {
  const timeline = loadTimeline(db);
  const now = stateAt(timeline, today());
  const projects = listProjects(db);
  const end = await reports.endDate(projects);
  const range = reports.rangeInfo('month', end, projects.map((p) => p.id));
  const ctx = reports.costContext(range, getPeriod('month').key);
  const rows = [];
  for (const p of projects) {
    const st = projectStatus(timeline, p.id);
    // A Dự án shows its aggregated figures (children of any status, not only the Dashboard's).
    const summary = await reports.projectSummary(p, 'month', range, ctx);
    const staffing = now.staffing[p.id]?.rows ?? [];
    const pc = now.costs.projects[p.id];
    const inc = now.costs.parents[p.id];
    const conns = p.isFolder ? null : listConnections(db, p.id);
    rows.push({
      id: p.id, name: p.name, color: p.color, kind: p.kind, isFolder: p.isFolder, icon: p.icon,
      productType: p.productType, productTypeLabel: PRODUCT_TYPES[p.productType], platforms: summary.platforms,
      phase: summary.phase, phaseLabel: summary.phaseLabel,
      status: st.status, statusLabel: PROJECT_STATUSES[st.status], pending: st.pending
        ? { ...st.pending, label: PROJECT_STATUSES[st.pending.status] } : null,
      members: staffing.map((r) => ({ id: r.memberId, name: now.members.find((m) => m.id === r.memberId)?.name ?? '?', effortPct: r.effortPct })),
      fte: p.isFolder ? inc?.sharedFte ?? 0 : pc.fte, monthlyCost: inc?.total ?? pc.total, teamPct: inc?.teamPct ?? pc.teamPct, ownMonthlyCost: pc.total,
      parentId: parentOf(timeline, p.id, today()), scheduledParentId: parentOf(timeline, p.id, FAR_FUTURE),
      score: summary.score, scoreStatus: summary.status, scoreUsed: summary.scoreUsed, scoreTotal: summary.scoreTotal,
      // null = "—" (a Dự án has no connections and no phase).
      connections: conns ? conns.map((c) => ({ source: c.source, name: c.name, status: c.status })) : null,
      lastUpdated: (conns ?? []).map((c) => c.lastSyncedAt).filter(Boolean).sort().pop() ?? null,
      actions: user.role === 'admin' ? actionsFor(st.latest, p, p.isFolder ? liveProducts(db, p.id, timeline, today()).length : 0) : [],
    });
  }
  const counts = { all: rows.length };
  for (const s of ['active', 'paused', 'draft', 'archived']) counts[s] = rows.filter((r) => r.status === s).length;
  // Tree: a parent's monthly cost includes its children; children are listed under it.
  for (const r of rows) r.childCount = rows.filter((x) => x.parentId === r.id).length;
  return { rows, counts, readOnly: user.role !== 'admin' };
}
