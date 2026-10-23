// Project management: effective-dated staffing, lifecycle transitions, info edits, wizard creation.
// Every mutation validates against the timeline, writes config versions and an audit trail.

import {
  PROJECT_STATUSES, availableEffort, impactPreview, latestVersion, stateAt, validateTimeline, withVersions,
} from '../../shared/cost-timeline.js';
import { formatDate, formatNumber, formatVnd } from '../../shared/format.js';
import { platformLabel, productTypeFor } from '../../shared/release-platforms.js';
import { firstOpenDate as openDateFor } from '../../shared/closing.js';
import { WORKING_DAYS } from '../../shared/system-config.js';
import { todayIso } from '../clock.js';
import {
  addVersion, createProjectRow, getProject, listMembers, loadTimeline, tx,
} from '../database.js';
import { logChange } from './audit-log.js';
import { httpError, saveConnection, SOURCES } from './connection-service.js';
import { validateBaselines, writeBaselines } from './baseline-service.js';
import {
  assertParentAllowed, auditParentSplit, cleanTemplate, currentChildren, DELETE_PROJECT_TIP, liveProducts, parentCostInfo, parentSplitErrors, parseParentSplit,
} from './parent-service.js';

const FAR_FUTURE = '9999-12-31';

/** Allowed lifecycle actions from the latest scheduled status. */
export const TRANSITIONS = {
  draft: ['activate', 'delete'],
  active: ['pause', 'archive'],
  paused: ['resume', 'archive'],
  archived: ['restore', 'delete'],
};
const ACTION_RESULT = { activate: 'active', pause: 'paused', resume: 'active', archive: 'archived', restore: 'paused' };
export const ACTION_LABELS = {
  activate: 'Kích hoạt', pause: 'Tạm dừng', resume: 'Tiếp tục', archive: 'Lưu trữ', restore: 'Khôi phục', delete: 'Xóa',
};

export const today = () => todayIso();
/** Closed months (see shared/closing.js) are read-only; nothing may take effect there. */
export const firstOpenDate = () => openDateFor(today());

export function assertOpenDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw httpError(422, 'Vui lòng chọn ngày hiệu lực.');
  if (date < firstOpenDate()) throw httpError(422, `Không thể áp dụng vào tháng đã chốt sổ. Chọn từ ${formatDate(firstOpenDate())} trở đi.`);
}

/** Current status (today) plus the latest scheduled one, if different. */
export function projectStatus(timeline, projectId) {
  const now = latestVersion(timeline, 'status', projectId, today());
  const last = latestVersion(timeline, 'status', projectId, FAR_FUTURE);
  return {
    status: now?.data.status ?? last?.data.status ?? null,
    since: now?.effectiveDate ?? null,
    latest: last?.data.status ?? null,
    latestDate: last?.effectiveDate ?? null,
    pending: last && now && last.seq !== now.seq ? { status: last.data.status, date: last.effectiveDate } : null,
  };
}

// ---------- Staffing ----------

function normalizeRows(rows) {
  return (rows || []).map((r) => ({
    memberId: Number(r.memberId), effortPct: Number(r.effortPct),
    monthlyCost: r.monthlyCost == null || r.monthlyCost === '' ? null : Number(r.monthlyCost),
  }));
}

/** Versions a staffing save would write: staffing + any salary changes (+ the parent split setting), all from `date`. */
function staffingVersions(timeline, projectId, date, rows, split = null) {
  const st = stateAt(timeline, date);
  const extra = [{ entity: 'staffing', entityId: projectId, effectiveDate: date,
    data: { rows: rows.map(({ memberId, effortPct }) => ({ memberId, effortPct })) } }];
  if (split) extra.push({ entity: 'parent_split', entityId: projectId, effectiveDate: date, data: split });
  for (const r of rows) {
    const m = st.members.find((x) => x.id === r.memberId);
    if (m && r.monthlyCost != null && r.monthlyCost !== m.monthlyCost) {
      extra.push({ entity: 'member_cost', entityId: r.memberId, effectiveDate: date, data: { monthlyCost: r.monthlyCost } });
    }
  }
  return extra;
}

function staffingErrors(db, timeline, projectId, date, rows, { requireMember, split = null }) {
  const members = listMembers(db);
  const errors = [];
  const seen = new Set();
  for (const r of rows) {
    const m = members.find((x) => x.id === r.memberId);
    if (!m) { errors.push({ message: 'Nhân sự không tồn tại.' }); continue; }
    if (seen.has(r.memberId)) errors.push({ message: `${m.name} bị chọn trùng.` });
    seen.add(r.memberId);
    if (!(r.effortPct >= 0 && r.effortPct <= 100)) errors.push({ message: `Effort của ${m.name} phải trong khoảng 0–100%.` });
    if (r.monthlyCost != null && !(r.monthlyCost >= 0)) errors.push({ message: `Chi phí nhân sự của ${m.name} không hợp lệ.` });
  }
  if (requireMember && !rows.length) {
    // A Dự án needs no staff of its own; a child may be staffed only by its parent's shared staff.
    const st = stateAt(timeline, date);
    const pid = st.parentOf?.[projectId];
    const isFolder = timeline.projects.find((p) => p.id === projectId)?.kind === 'folder';
    if (!isFolder && !(pid != null && st.staffing[pid]?.rows.length)) errors.push({ message: 'Sản phẩm cần ít nhất 1 nhân sự (trực tiếp hoặc nhân sự chung của dự án).' });
  }
  if (errors.length) return errors;
  const next = withVersions(timeline, staffingVersions(timeline, projectId, date, rows, split));
  errors.push(...validateTimeline(next, date, { focusProjectId: projectId }));
  errors.push(...parentSplitErrors(next, projectId, date, split));
  return errors;
}

/**
 * Member list with salary and free effort on `date` for the staffing editor.
 * Free effort = 100% − effort on OTHER running projects (the edited project itself is not subtracted).
 */
export function staffingContext(db, projectId, date) {
  const timeline = loadTimeline(db);
  const st = stateAt(timeline, date);
  const projectName = Object.fromEntries(timeline.projects.map((p) => [p.id, p.name]));
  const staffing = st.staffing[projectId] ?? { rows: [] };
  return {
    date, workingDays: WORKING_DAYS,
    status: st.statuses[projectId],
    rows: staffing.rows,
    members: listMembers(db).map((m) => {
      const cur = st.members.find((x) => x.id === m.id);
      return { id: m.id, name: m.name, role: m.role, monthlyCost: cur?.monthlyCost ?? 0,
        available: availableEffort(st, m.id, projectId),
        allocations: st.assignments.filter((a) => a.memberId === m.id && a.projectId !== projectId && a.effortPct > 0)
          .map((a) => ({ projectId: a.projectId, name: projectName[a.projectId], effortPct: a.effortPct })) };
    }),
    fromParent: sharedFromParent(timeline, st, projectId),
    // A Dự án's staff is "Nhân sự chung" of its children.
    parentCost: isFolderId(timeline, projectId) ? parentCostInfo(timeline, st, projectId) : null,
    versions: staffingHistory(timeline, projectId),
  };
}

const isFolderId = (timeline, id) => timeline.projects.find((p) => p.id === id)?.kind === 'folder';

/** Read-only "Chia từ nhân sự chung của dự án": this child's share of its parent's staff on the state's date. */
function sharedFromParent(timeline, st, projectId) {
  const parentId = st.parentOf?.[projectId] ?? null;
  if (parentId == null) return null;
  const parent = timeline.projects.find((p) => p.id === parentId);
  const pc = st.costs.projects[projectId];
  const sc = st.costs.parents[parentId];
  const share = pc?.parentShare ?? 0;
  return {
    parentId, name: parent?.name, method: st.parentSplit[parentId]?.method ?? 'even', share,
    cost: pc?.parentShared ?? 0, fte: pc?.parentFte ?? 0, warnings: (sc?.warnings ?? []).filter((w) => !w.projectId || w.projectId === projectId),
    rows: (sc?.sharedRows ?? []).map((r) => ({ name: st.members.find((m) => m.id === r.memberId)?.name, effortPct: r.effortPct * share, monthly: r.monthly * share })),
  };
}

/** Saved staffing versions of a project, newest first. */
function staffingHistory(timeline, projectId) {
  const names = Object.fromEntries(timeline.members.map((m) => [m.id, m.name]));
  return timeline.versions.filter((v) => v.entity === 'staffing' && v.entityId === projectId)
    .sort((a, b) => (b.effectiveDate.localeCompare(a.effectiveDate)) || b.seq - a.seq)
    .map((v) => ({ effectiveDate: v.effectiveDate, createdAt: v.createdAt, createdBy: v.createdBy,
      rows: v.data.rows.map((r) => ({ ...r, name: names[r.memberId] ?? 'Nhân sự đã xóa' })),
      fte: v.data.rows.reduce((s, r) => s + r.effortPct, 0) / 100 }));
}

export function previewStaffing(db, projectId, body) {
  const date = body.effectiveDate;
  assertOpenDate(date);
  const rows = normalizeRows(body.rows);
  const split = parseParentSplit(body.parentSplit);
  const timeline = loadTimeline(db);
  const status = stateAt(timeline, FAR_FUTURE).statuses[projectId];
  const extra = staffingVersions(timeline, projectId, date, rows, split);
  const after = stateAt(withVersions(timeline, extra), date);
  return {
    preview: impactPreview(timeline, extra, date),
    errors: staffingErrors(db, timeline, projectId, date, rows, { requireMember: status === 'active', split }).map((e) => e.message),
    parentCost: isFolderId(timeline, projectId) ? parentCostInfo(timeline, after, projectId) : null,
  };
}

export function saveStaffing(db, projectId, body, actor) {
  const date = body.effectiveDate;
  assertOpenDate(date);
  const rows = normalizeRows(body.rows);
  const split = parseParentSplit(body.parentSplit);
  const timeline = loadTimeline(db);
  const status = stateAt(timeline, FAR_FUTURE).statuses[projectId];
  const errors = staffingErrors(db, timeline, projectId, date, rows, { requireMember: status === 'active', split });
  if (errors.length) throw httpError(422, errors[0].message, errors);
  const before = stateAt(timeline, date);
  const extra = staffingVersions(timeline, projectId, date, rows, split);
  tx(db, () => {
    for (const v of extra) addVersion(db, { ...v, actor });
    auditStaffing(db, projectId, before, rows, date, actor, body.reason);
    if (split) auditParentSplit(db, projectId, before, split, date, actor, body.reason);
  });
  return staffingContext(db, projectId, date);
}

function auditStaffing(db, projectId, before, rows, date, actor, reason) {
  const old = before.staffing[projectId] ?? { rows: [] };
  const name = (id) => before.members.find((m) => m.id === id)?.name ?? `#${id}`;
  const log = (field, o, n) => logChange(db, { projectId, actor, action: 'Nhân sự & chi phí', field, oldValue: o, newValue: n, effectiveDate: date, reason });
  let changed = false;
  for (const r of rows) {
    const prev = old.rows.find((x) => x.memberId === r.memberId);
    if (!prev) { log(`Thêm ${name(r.memberId)}`, '—', `${formatNumber(r.effortPct)}%`); changed = true; }
    else if (prev.effortPct !== r.effortPct) { log(`Effort ${name(r.memberId)}`, `${formatNumber(prev.effortPct)}%`, `${formatNumber(r.effortPct)}%`); changed = true; }
    const m = before.members.find((x) => x.id === r.memberId);
    if (m && r.monthlyCost != null && r.monthlyCost !== m.monthlyCost) {
      log(`Chi phí nhân sự/tháng ${m.name}`, formatVnd(m.monthlyCost), formatVnd(r.monthlyCost)); changed = true;
    }
  }
  for (const prev of old.rows) {
    if (!rows.some((r) => r.memberId === prev.memberId)) { log(`Bỏ ${name(prev.memberId)}`, `${formatNumber(prev.effortPct)}%`, '—'); changed = true; }
  }
  if (!changed) log('Phiên bản nhân sự', null, 'Lưu lại không thay đổi');
}

// ---------- Lifecycle ----------

/** "dự án" (a Dự án) or "sản phẩm" (a Sản phẩm), for messages. */
export const nounOf = (project) => (project?.isFolder ? 'dự án' : 'sản phẩm');
export const DELETED_NAME = { folder: 'Dự án đã xóa', project: 'Sản phẩm đã xóa' };

function lifecyclePlan(db, projectId, body) {
  const project = getProject(db, projectId);
  if (!project) throw httpError(404, 'Không tìm thấy dự án hoặc sản phẩm');
  const timeline = loadTimeline(db);
  const st = projectStatus(timeline, projectId);
  const action = body.action;
  // A Dự án can be deleted from any status once it has no products left (archived ones do not count).
  const folderDelete = project.isFolder && action === 'delete';
  if (!folderDelete && !(TRANSITIONS[st.latest] || []).includes(action)) {
    if (action === 'delete' && ['active', 'paused'].includes(st.latest)) throw httpError(422, 'Hãy lưu trữ sản phẩm trước khi xóa.');
    throw httpError(422, `Không thể "${ACTION_LABELS[action] ?? action}" khi ${nounOf(project)} đang ở trạng thái ${PROJECT_STATUSES[st.latest] ?? '—'}.`);
  }
  const kids = currentChildren(db, projectId, timeline, today());
  // Deletion never reaches back before the last scheduled status change, so earlier periods keep their cost.
  if (action === 'delete') {
    if (project.isFolder && liveProducts(db, projectId, timeline, today()).length) throw httpError(422, `${DELETE_PROJECT_TIP}.`);
    const date = st.latestDate && st.latestDate > today() ? st.latestDate : today();
    return { project, timeline, st, action, date, extra: [] };
  }
  const date = body.effectiveDate;
  assertOpenDate(date);
  if (st.latestDate && date < st.latestDate) {
    throw httpError(422, `Ngày hiệu lực phải từ ${formatDate(st.latestDate)} trở đi (sau lần đổi trạng thái gần nhất).`);
  }
  const extra = [{ entity: 'status', entityId: projectId, effectiveDate: date, data: { status: ACTION_RESULT[action] } }];
  // A parent's pause / archive / resume / restore may apply to its children ("Áp dụng cho tất cả N sản phẩm?").
  const eligible = kids.filter((p) => (CHILD_FROM[action] ?? []).includes(latestVersion(timeline, 'status', p.id, FAR_FUTURE)?.data.status));
  const applyToChildren = Boolean(body.applyToChildren) && eligible.length > 0;
  if (applyToChildren) {
    for (const p of eligible) extra.push({ entity: 'status', entityId: p.id, effectiveDate: date, data: { status: ACTION_RESULT[action] } });
  }
  const errors = [];
  if (action === 'resume' || action === 'activate') {
    const rows = body.rows ? normalizeRows(body.rows) : stateAt(timeline, date).staffing[projectId].rows;
    extra.push(...staffingVersions(timeline, projectId, date, rows));
    errors.push(...staffingErrors(db, withVersions(timeline, [extra[0]]), projectId, date, rows, { requireMember: true }));
  }
  return { project, timeline, st, action, date, extra, errors: errors.map((e) => e.message), eligible, applyToChildren, children: kids };
}

/** Children whose latest status allows following the parent's action. */
const CHILD_FROM = { pause: ['active'], archive: ['active', 'paused'], resume: ['paused'], restore: ['archived'] };

export function previewLifecycle(db, projectId, body) {
  const plan = lifecyclePlan(db, projectId, body);
  const preview = impactPreview(plan.timeline, plan.extra, plan.date);
  return { action: plan.action, date: plan.date, preview, errors: plan.errors ?? [],
    children: (plan.children ?? []).length, eligible: (plan.eligible ?? []).map((p) => ({ id: p.id, name: p.name })) };
}

export function applyLifecycle(db, projectId, body, actor, { dataSource }) {
  const plan = lifecyclePlan(db, projectId, body);
  if (plan.errors?.length) throw httpError(422, plan.errors[0], plan.errors.map((message) => ({ message })));
  const { project, action, date } = plan;
  const reason = body.reason;

  if (action === 'delete') {
    if (plan.st.latest === 'draft') {
      tx(db, () => {
        db.prepare("DELETE FROM config_versions WHERE entity IN ('staffing', 'status') AND entity_id = ?").run(projectId);
        db.prepare('DELETE FROM metric_daily WHERE project_id = ?').run(projectId);
        db.prepare('DELETE FROM audit_log WHERE project_id = ?').run(projectId);
        db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
        logChange(db, { actor, action: `Xóa ${nounOf(project)} nháp`, field: project.isFolder ? 'Dự án' : 'Sản phẩm', oldValue: project.name, newValue: '—', reason });
      });
      return { deleted: true };
    }
    if (String(body.confirmName ?? '').trim() !== project.name) throw httpError(422, `Tên ${nounOf(project)} nhập vào không khớp.`);
    tx(db, () => {
      for (const t of ['metric_daily', 'blog_posts', 'connections', 'baseline_configs', 'thresholds']) {
        db.prepare(`DELETE FROM ${t} WHERE project_id = ?`).run(projectId);
      }
      // Cost history stays (versions are kept); the project is shown as "Dự án đã xóa" in earlier periods.
      db.prepare('UPDATE projects SET deleted_at = ?, name = ? WHERE id = ?').run(new Date().toISOString(), DELETED_NAME[project.kind], projectId);
      addVersion(db, { entity: 'status', entityId: projectId, effectiveDate: date, data: { status: 'deleted' }, actor });
      logChange(db, { projectId, actor, action: 'Xóa vĩnh viễn', field: 'Trạng thái', oldValue: `${PROJECT_STATUSES.archived} (${project.name})`,
        newValue: `Đã xóa — giữ chi phí các kỳ trước dưới tên "${DELETED_NAME[project.kind]}"`, effectiveDate: date, reason });
    });
    return { deleted: true };
  }

  const before = stateAt(plan.timeline, date);
  tx(db, () => {
    for (const v of plan.extra.filter((x) => !(x.entity === 'status' && x.entityId !== projectId))) addVersion(db, { ...v, actor });
    logChange(db, { projectId, actor, action: ACTION_LABELS[action], field: 'Trạng thái',
      oldValue: PROJECT_STATUSES[plan.st.latest], newValue: PROJECT_STATUSES[ACTION_RESULT[action]], effectiveDate: date,
      reason: plan.children?.length ? `${reason || ''}${plan.applyToChildren ? ` (áp dụng cho ${plan.eligible.length} sản phẩm)` : ' (không áp dụng cho sản phẩm)'}`.trim() : reason });
    if (plan.applyToChildren) {
      for (const p of plan.eligible) applyLifecycle(db, p.id, { action, effectiveDate: date, reason: `Theo dự án ${project.name}${reason ? `: ${reason}` : ''}` }, actor, {});
    }
    if (action === 'resume' || action === 'activate') {
      const staffing = plan.extra.find((v) => v.entity === 'staffing').data;
      const rows = staffing.rows.map((r) => ({ ...r, monthlyCost: plan.extra.find((v) => v.entity === 'member_cost' && v.entityId === r.memberId)?.data.monthlyCost ?? null }));
      auditStaffing(db, projectId, before, rows, date, actor, reason);
    }
  });
  return { ok: true, applied: plan.applyToChildren ? plan.eligible.length : 0 };
}

// ---------- Info & creation ----------

export function parseInfo(body) {
  const name = String(body.name || '').trim();
  if (!name) throw httpError(422, 'Vui lòng nhập tên sản phẩm.');
  if (Object.values(DELETED_NAME).includes(name)) throw httpError(422, 'Tên này được dành riêng.');
  const color = /^#[0-9a-f]{6}$/i.test(body.color || '') ? body.color : '#2B59C3';
  // "Nền tảng phát hành" (multi-select) replaces the product type; Blog is a marketing extra.
  const platforms = ['ios', 'android', 'web', 'playables', 'blog'].filter((p) => (body.platforms || []).includes(p));
  if (!platforms.some((p) => p !== 'blog')) throw httpError(422, 'Chọn ít nhất 1 nền tảng phát hành.');
  const productType = productTypeFor(platforms);
  const launchDate = /^\d{4}-\d{2}-\d{2}$/.test(body.launchDate || '') ? body.launchDate : null;
  const buildBudget = body.buildBudget === '' || body.buildBudget == null ? null : Number(body.buildBudget);
  if (buildBudget != null && !(buildBudget > 0)) throw httpError(422, 'Ngân sách giai đoạn Xây dựng phải lớn hơn 0.');
  return { name, color, productType, platforms, launchDate, buildBudget };
}

/** "Thông tin" of a Dự án: name, description, color, icon and the color thresholds of the composite score. */
export function parseFolderInfo(body) {
  const name = String(body.name || '').trim();
  if (!name) throw httpError(422, 'Vui lòng nhập tên dự án.');
  if (Object.values(DELETED_NAME).includes(name)) throw httpError(422, 'Tên này được dành riêng.');
  const color = /^#[0-9a-f]{6}$/i.test(body.color || '') ? body.color : '#2B59C3';
  const description = String(body.description ?? '').trim().slice(0, 300);
  const icon = String(body.icon ?? '').trim().slice(0, 8) || null;
  const green = Number(body.thresholds?.green ?? 80);
  const red = Number(body.thresholds?.red ?? 50);
  if (!(green > 0 && green <= 100 && red >= 0 && red < green)) throw httpError(422, 'Ngưỡng màu không hợp lệ: cần 0 ≤ Báo động < Tốt ≤ 100.');
  return { name, color, description, icon, thresholds: { green, red } };
}

function updateFolderInfo(db, project, body, actor) {
  const info = parseFolderInfo(body);
  const th = db.prepare('SELECT green, red FROM thresholds WHERE project_id = ?').get(project.id) ?? { green: 80, red: 50 };
  tx(db, () => {
    db.prepare('UPDATE projects SET name = ?, color = ?, description = ?, icon = ? WHERE id = ?')
      .run(info.name, info.color, info.description, info.icon, project.id);
    db.prepare('INSERT INTO thresholds (project_id, green, red) VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET green = excluded.green, red = excluded.red')
      .run(project.id, info.thresholds.green, info.thresholds.red);
    const log = (field, o, n) => logChange(db, { projectId: project.id, actor, action: 'Thông tin', field, oldValue: o, newValue: n, reason: body.reason });
    if (project.name !== info.name) log('Tên dự án', project.name, info.name);
    if ((project.description ?? '') !== info.description) log('Mô tả', project.description || '—', info.description || '—');
    if (project.color.toLowerCase() !== info.color.toLowerCase()) log('Màu', project.color, info.color);
    if ((project.icon ?? null) !== info.icon) log('Icon', project.icon ?? '—', info.icon ?? '—');
    if (th.green !== info.thresholds.green || th.red !== info.thresholds.red) {
      log('Ngưỡng màu điểm tổng hợp', `Tốt > ${formatNumber(th.green)}% · Báo động < ${formatNumber(th.red)}%`,
        `Tốt > ${formatNumber(info.thresholds.green)}% · Báo động < ${formatNumber(info.thresholds.red)}%`);
    }
  });
  return getProject(db, project.id);
}

/** The kind (Dự án / Sản phẩm) is fixed at creation: the info form never changes it. */
export function updateInfo(db, projectId, body, actor) {
  const project = getProject(db, projectId);
  if (!project) throw httpError(404, 'Không tìm thấy dự án hoặc sản phẩm');
  if (body.kind && body.kind !== project.kind) throw httpError(422, 'Không thể đổi một sản phẩm thành dự án (hoặc ngược lại) sau khi tạo.');
  if (project.isFolder) return updateFolderInfo(db, project, body, actor);
  const info = parseInfo(body);
  const fmtPlatforms = (l) => l.map((p) => platformLabel(p)).join(', ');
  tx(db, () => {
    db.prepare('UPDATE projects SET name = ?, color = ?, product_type = ?, platforms = ?, launch_date = ?, build_budget = ? WHERE id = ?')
      .run(info.name, info.color, info.productType, JSON.stringify(info.platforms), info.launchDate, info.buildBudget, projectId);
    const log = (field, o, n) => logChange(db, { projectId, actor, action: 'Thông tin', field, oldValue: o, newValue: n, reason: body.reason });
    if (project.name !== info.name) log('Tên sản phẩm', project.name, info.name);
    if (project.color.toLowerCase() !== info.color.toLowerCase()) log('Màu', project.color, info.color);
    if (fmtPlatforms(project.platforms) !== fmtPlatforms(info.platforms)) log('Nền tảng', fmtPlatforms(project.platforms), fmtPlatforms(info.platforms));
    if ((project.launchDate ?? null) !== info.launchDate) log('Ngày ra mắt dự kiến', project.launchDate ? formatDate(project.launchDate) : '—', info.launchDate ? formatDate(info.launchDate) : '—');
    if ((project.buildBudget ?? null) !== info.buildBudget) log('Ngân sách giai đoạn Xây dựng', project.buildBudget ? formatVnd(project.buildBudget) : '—', info.buildBudget ? formatVnd(info.buildBudget) : '—');
  });
  return getProject(db, projectId);
}

/**
 * Wizard: create a project in one transaction — info, connections, baselines, staffing, status.
 * activate=false keeps it as Nháp (draft); otherwise it becomes Đang chạy from effectiveDate.
 */
export function createProject(db, body, actor, { secretKey, dataSource }) {
  if (body.info?.kind === 'folder') return createFolder(db, body, actor);
  const info = parseInfo(body.info || {});
  const baselines = body.baselines?.list ?? [];
  const thresholds = body.baselines?.thresholds ?? { green: 80, red: 50 };
  const bErrors = validateBaselines(baselines, thresholds);
  if (bErrors.length) throw httpError(422, bErrors[0].message, bErrors);
  const rows = normalizeRows(body.staffing?.rows);
  const activate = Boolean(body.activate);
  // Staffing and status take effect on the activation date; a draft's staffing applies once it is activated.
  const date = activate ? body.activationDate : firstOpenDate();
  assertOpenDate(date);

  const slug = `${slugify(info.name)}-${Date.now().toString(36)}`;
  const projectId = tx(db, () => {
    const phase = ['build', 'launch', 'growth', 'stable'].includes(body.info?.phase) ? body.info.phase : 'growth';
    const id = createProjectRow(db, { slug, ...info, phase, since: date, actor,
      baselines: baselines.map((b) => [b.metricKey, b.weight, b.targetMonthly, b.source, b.period]), thresholds });
    const timeline = loadTimeline(db);
    const status = { entity: 'status', entityId: id, effectiveDate: date, data: { status: activate ? 'active' : 'draft' } };
    // "Thuộc dự án": the project becomes its child from the same date.
    const parentId = body.info?.parentId ? Number(body.info.parentId) : null;
    assertParentAllowed(db, timeline, null, parentId, date);
    const membership = parentId != null ? [{ entity: 'membership', entityId: id, effectiveDate: date, data: { parentId } }] : [];
    const errors = staffingErrors(db, withVersions(timeline, [status, ...membership]), id, date, rows, { requireMember: activate });
    if (errors.length) throw httpError(422, errors[0].message, errors);
    for (const v of [status, ...membership, ...staffingVersions(timeline, id, date, rows)]) addVersion(db, { ...v, actor });
    for (const [source, c] of Object.entries(body.connections || {})) {
      if (SOURCES[source] && (Object.values(c.config || {}).some(Boolean) || c.secret)) saveConnection(db, secretKey, id, source, c);
    }
    logChange(db, { projectId: id, actor, action: 'Tạo sản phẩm', field: 'Trạng thái', oldValue: '—',
      newValue: activate ? PROJECT_STATUSES.active : PROJECT_STATUSES.draft, effectiveDate: date });
    auditStaffing(db, id, stateAt(timeline, date), rows, date, actor);
    return id;
  });
  dataSource.generateFor(getProject(db, projectId));
  return getProject(db, projectId);
}

/**
 * Wizard Dự án: info + thresholds, optional shared staff and split method, optional child template.
 * Activation needs neither staff nor baselines.
 */
function createFolder(db, body, actor) {
  const info = parseFolderInfo(body.info || {});
  const rows = normalizeRows(body.staffing?.rows);
  const split = parseParentSplit(body.parentSplit ?? { method: 'even' });
  const activate = Boolean(body.activate);
  const date = activate ? body.activationDate : firstOpenDate();
  assertOpenDate(date);
  const slug = `${slugify(info.name)}-${Date.now().toString(36)}`;
  const projectId = tx(db, () => {
    const id = createProjectRow(db, { slug, name: info.name, color: info.color, kind: 'folder', description: info.description,
      icon: info.icon, thresholds: info.thresholds, since: date, actor });
    const timeline = loadTimeline(db);
    const status = { entity: 'status', entityId: id, effectiveDate: date, data: { status: activate ? 'active' : 'draft' } };
    const errors = staffingErrors(db, withVersions(timeline, [status]), id, date, rows, { requireMember: false, split });
    if (errors.length) throw httpError(422, errors[0].message, errors);
    for (const v of [status, ...staffingVersions(timeline, id, date, rows, split)]) addVersion(db, { ...v, actor });
    if (body.childTemplate) db.prepare('UPDATE projects SET child_template = ? WHERE id = ?').run(JSON.stringify(cleanTemplate(body.childTemplate)), id);
    logChange(db, { projectId: id, actor, action: 'Tạo dự án', field: 'Dự án', oldValue: '—', newValue: info.name, effectiveDate: date });
    logChange(db, { projectId: id, actor, action: 'Tạo dự án', field: 'Trạng thái', oldValue: '—',
      newValue: activate ? PROJECT_STATUSES.active : PROJECT_STATUSES.draft, effectiveDate: date });
    auditStaffing(db, id, stateAt(timeline, date), rows, 0, date, actor);
    return id;
  });
  return getProject(db, projectId);
}

export function slugify(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'du-an';
}

/** Wizard step 5: impact of activating a not-yet-created project with the given staffing. */
export function previewNewProject(db, body) {
  const date = body.activationDate || firstOpenDate();
  assertOpenDate(date);
  const rows = normalizeRows(body.staffing?.rows);
  const base = loadTimeline(db);
  const NEW_ID = -1;
  const folder = body.info?.kind === 'folder';
  const timeline = { ...base, projects: [...base.projects, { id: NEW_ID, name: body.info?.name || (folder ? 'Dự án mới' : 'Sản phẩm mới'), color: body.info?.color || '#2B59C3', kind: folder ? 'folder' : 'project' }] };
  const status = { entity: 'status', entityId: NEW_ID, effectiveDate: date, data: { status: 'active' } };
  const parentId = !folder && body.info?.parentId ? Number(body.info.parentId) : null;
  const membership = parentId != null ? [{ entity: 'membership', entityId: NEW_ID, effectiveDate: date, data: { parentId } }] : [];
  const split = folder ? parseParentSplit(body.parentSplit ?? { method: 'even' }) : null;
  const extra = [status, ...membership, ...staffingVersions(timeline, NEW_ID, date, rows, split)];
  const errors = staffingErrors(db, withVersions(timeline, [status, ...membership]), NEW_ID, date, rows, { requireMember: !folder, split });
  const after = stateAt(withVersions(timeline, extra), date);
  return { preview: impactPreview(timeline, extra, date), errors: errors.map((e) => e.message),
    parentCost: folder ? parentCostInfo(timeline, after, NEW_ID) : null };
}
