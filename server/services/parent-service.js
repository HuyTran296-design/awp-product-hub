// Two levels: "Dự án" (projects.kind = 'folder') and "Sản phẩm" (kind = 'project'). Every Sản phẩm belongs to exactly one
// Dự án. A Dự án has no data of its own: its figures are the sum of its products, its "Nhân sự chung" is always split down
// to them, its "Mẫu cho sản phẩm mới" pre-fills the wizard. (In code a Dự án is a "parent"/"folder", a Sản phẩm a "child".)
// Membership and the split setting are effective-dated (config_versions), so earlier periods keep their numbers.

import { NO_RUNNING_CHILD, PARENT_SPLIT_METHODS } from '../../shared/cost-calculator.js';
import { latestVersion, PROJECT_STATUSES, stateAt } from '../../shared/cost-timeline.js';
import { formatNumber } from '../../shared/format.js';
import { getProject, listProjects, loadTimeline, tx } from '../database.js';
import { logChange } from './audit-log.js';
import { httpError } from './connection-service.js';

export const FAR_FUTURE = '9999-12-31';

/** Parent of a project on `date` (null = no Dự án). */
export const parentOf = (timeline, projectId, date) => latestVersion(timeline, 'membership', projectId, date)?.data.parentId ?? null;

/** Live projects that are children of `parentId` on `date` (default: the latest scheduled membership). */
export function childrenOf(db, parentId, timeline = loadTimeline(db), date = FAR_FUTURE) {
  return listProjects(db).filter((p) => parentOf(timeline, p.id, date) === parentId);
}

export const DELETE_PROJECT_TIP = 'Hãy chuyển hoặc lưu trữ các sản phẩm trước khi xóa dự án';

/** Products of a Dự án that block deleting it: today's or scheduled ones that are not archived. */
export function liveProducts(db, projectId, timeline = loadTimeline(db), date) {
  return currentChildren(db, projectId, timeline, date).filter((p) => !['archived', 'deleted'].includes(latestStatus(timeline, p.id)));
}

/** Children today or scheduled later — what makes a Dự án "đang có sản phẩm". */
export function currentChildren(db, projectId, timeline = loadTimeline(db), date) {
  return listProjects(db).filter((p) => parentOf(timeline, p.id, date) === projectId || parentOf(timeline, p.id, FAR_FUTURE) === projectId);
}

const latestStatus = (timeline, id) => latestVersion(timeline, 'status', id, FAR_FUTURE)?.data.status ?? null;

/** Options of the "Thuộc dự án" picker: Dự án that are not archived/deleted, with their number of products. */
export function parentOptions(db, excludeId = null, date) {
  const timeline = loadTimeline(db);
  const live = listProjects(db);
  return live
    .filter((p) => p.isFolder && p.id !== excludeId && !['archived', 'deleted'].includes(latestStatus(timeline, p.id)))
    .map((p) => ({ id: p.id, name: p.name, color: p.color, children: currentChildren(db, p.id, timeline, date).length,
      template: p.childTemplate }))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

export const NO_PROJECT = 'Hãy chọn dự án cho sản phẩm.';

/** Throws unless the Sản phẩm `projectId` (null = one being created) may belong to the Dự án `parentId` from `date`. */
export function assertParentAllowed(db, timeline, projectId, parentId, date) {
  if (parentId == null) throw httpError(422, NO_PROJECT);
  const parent = getProject(db, parentId);
  if (!parent || !parent.isFolder) throw httpError(422, 'Dự án không tồn tại.');
  if (['archived', 'deleted'].includes(latestStatus(timeline, parentId))) throw httpError(422, `Dự án ${parent.name} đã lưu trữ nên không thể nhận sản phẩm.`);
  if (projectId != null && getProject(db, projectId)?.isFolder) throw httpError(422, 'Dự án không thể thuộc một dự án khác.');
}

/** "Chuyển sang dự án khác" from `effectiveDate`; logged on the product and on both Dự án. */
export function moveProject(db, projectId, body, actor, assertOpenDate) {
  const p = getProject(db, projectId);
  if (!p) throw httpError(404, 'Không tìm thấy sản phẩm');
  if (p.isFolder) throw httpError(422, 'Chỉ sản phẩm mới chuyển được sang dự án khác.');
  const target = body.parentId == null || body.parentId === '' ? null : Number(body.parentId);
  assertOpenDate(body.effectiveDate);
  const timeline = loadTimeline(db);
  assertParentAllowed(db, timeline, projectId, target, body.effectiveDate);
  const from = parentOf(timeline, projectId, FAR_FUTURE);
  if (from === target) throw httpError(422, 'Sản phẩm đã thuộc dự án này.');
  const label = (id) => (id == null ? '—' : getProject(db, id)?.name ?? '—');
  tx(db, () => {
    db.prepare(`INSERT INTO config_versions (entity, entity_id, effective_date, data, created_at, created_by)
      VALUES ('membership', ?, ?, ?, ?, ?)`).run(projectId, body.effectiveDate, JSON.stringify({ parentId: target }), new Date().toISOString(), actor);
    const entry = { actor, action: 'Thuộc dự án', field: `Sản phẩm ${p.name}`, oldValue: label(from), newValue: label(target), effectiveDate: body.effectiveDate, reason: body.reason };
    logChange(db, { projectId, ...entry });
    if (from != null) logChange(db, { projectId: from, ...entry });
    logChange(db, { projectId: target, ...entry });
  });
  return { parentId: target };
}

/** "Mẫu cho sản phẩm mới": platforms, ≤ 5 baselines, thresholds, stop-loss policy. */
export function cleanTemplate(template) {
  return {
    platforms: Array.isArray(template.platforms) ? template.platforms : [],
    baselines: Array.isArray(template.baselines) ? template.baselines.slice(0, 5) : [],
    thresholds: template.thresholds ?? { green: 80, red: 50 },
    stopLoss: template.stopLoss ?? null,
  };
}

/** "Mẫu cho sản phẩm mới" of a Dự án: pre-fills the wizard when a product is created in it. */
export function saveChildTemplate(db, projectId, template, actor) {
  const p = getProject(db, projectId);
  if (!p) throw httpError(404, 'Không tìm thấy dự án');
  if (!p.isFolder) throw httpError(422, 'Chỉ dự án mới có "Mẫu cho sản phẩm mới".');
  const clean = cleanTemplate(template);
  tx(db, () => {
    db.prepare('UPDATE projects SET child_template = ? WHERE id = ?').run(JSON.stringify(clean), projectId);
    logChange(db, { projectId, actor, action: 'Mẫu cho sản phẩm mới', field: 'Cập nhật mẫu',
      oldValue: `${p.childTemplate?.baselines?.length ?? 0} baseline`, newValue: `${clean.baselines.length} baseline · ${clean.platforms.join(', ') || '—'}` });
  });
  return getProject(db, projectId);
}

// ---------- "Nhân sự chung của dự án" ----------

/** Normalized split setting from a request body; null when the body carries none. */
export function parseParentSplit(body) {
  if (!body) return null;
  return {
    method: PARENT_SPLIT_METHODS[body.method] ? body.method : 'even',
    manualPct: Object.fromEntries(Object.entries(body.manualPct ?? {}).map(([k, v]) => [Number(k), Number(v) || 0])),
  };
}

export function parentSplitErrors(timeline, projectId, date, split) {
  if (!split || split.method !== 'manual') return [];
  const st = stateAt(timeline, date);
  const kids = timeline.projects.filter((p) => st.parentOf[p.id] === projectId && st.statuses[p.id] === 'active');
  const total = kids.reduce((s, p) => s + (split.manualPct[p.id] ?? 0), 0);
  return kids.length && Math.abs(total - 100) > 0.01
    ? [{ message: `Tổng % thủ công của các sản phẩm đang chạy phải = 100% (đang là ${formatNumber(total, 1)}%).` }] : [];
}

/** "Nhân sự chung" tab of a Dự án: split setting and what each product receives on `date`. */
export function parentCostInfo(timeline, st, projectId) {
  const kids = timeline.projects.filter((p) => st.parentOf[p.id] === projectId);
  const pc = st.costs.parents[projectId];
  const running = kids.filter((p) => st.statuses[p.id] === 'active');
  return {
    ...st.parentSplit[projectId], methods: PARENT_SPLIT_METHODS,
    children: kids.map((p) => ({ id: p.id, name: p.name, color: p.color, status: st.statuses[p.id], statusLabel: PROJECT_STATUSES[st.statuses[p.id]] ?? '—',
      directFte: st.costs.projects[p.id]?.directFte ?? 0, directOwn: st.costs.projects[p.id]?.directOwn ?? 0,
      parentShared: st.costs.projects[p.id]?.parentShared ?? 0 })),
    sharedCost: pc?.sharedCost ?? 0, unallocated: pc?.unallocated ?? 0, warnings: pc?.warnings ?? [],
    // Shared staff assigned while no child runs: its cost sits in "Chưa phân bổ" of Chi phí team.
    noRunningChild: !running.length ? NO_RUNNING_CHILD : null,
  };
}

export function auditParentSplit(db, projectId, before, split, date, actor, reason) {
  const old = before.parentSplit[projectId];
  const log = (field, o, n) => logChange(db, { projectId, actor, action: 'Nhân sự chung', field, oldValue: o, newValue: n, effectiveDate: date, reason });
  if (old.method !== split.method) log('Cách chia', PARENT_SPLIT_METHODS[old.method], PARENT_SPLIT_METHODS[split.method]);
}

// ---------- Periods ----------

/** Sub-ranges of [from, to] during which `projectId` belonged to `parentId`. */
export function membershipIntervals(timeline, projectId, parentId, from, to) {
  const changes = timeline.versions.filter((v) => v.entity === 'membership' && v.entityId === projectId && v.effectiveDate > from && v.effectiveDate <= to)
    .map((v) => v.effectiveDate);
  const bounds = [...new Set([from, ...changes])].sort();
  const out = [];
  bounds.forEach((start, i) => {
    const end = i + 1 < bounds.length ? prevDay(bounds[i + 1]) : to;
    if (parentOf(timeline, projectId, start) === parentId && start <= end) out.push([start, end]);
  });
  return out;
}

/**
 * Data segments of a project for [from, to]: [[projectId, from, to], …] — the project itself, plus (includeChildren)
 * every child for the days it belonged to the project. A Dự án's figures sum over these segments.
 */
export function scopeSegments(timeline, projectId, from, to, includeChildren = true) {
  const out = [[projectId, from, to]];
  if (!includeChildren) return out;
  for (const p of timeline.projects) {
    if (p.id === projectId) continue;
    for (const [a, b] of membershipIntervals(timeline, p.id, projectId, from, to)) out.push([p.id, a, b]);
  }
  return out;
}

/** Projects that were a child of `projectId` at some day of [from, to] or at `to`. */
export function childIdsIn(timeline, projectId, from, to) {
  return timeline.projects.filter((p) => p.id !== projectId && membershipIntervals(timeline, p.id, projectId, from, to).length).map((p) => p.id);
}

function prevDay(iso) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
