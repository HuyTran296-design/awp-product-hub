// Viewer scope: "Tất cả dự án", or selected projects. A parent project in scope includes all of its children,
// also children added later.

import { listProjects, loadTimeline } from './database.js';
import { FAR_FUTURE, parentOf } from './services/parent-service.js';
import { todayIso } from './clock.js';

/** Project ids the user may see (null = all). */
export function visibleProjectIds(db, user) {
  if (user.role === 'admin' || user.scope === 'all') return null;
  const ids = new Set(user.projectIds);
  const timeline = loadTimeline(db);
  for (const p of listProjects(db)) {
    if (ids.has(parentOf(timeline, p.id, todayIso())) || ids.has(parentOf(timeline, p.id, FAR_FUTURE))) ids.add(p.id);
  }
  return ids;
}
