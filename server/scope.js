// Viewer scope: "Tất cả dự án", or selected projects.

/** Project ids the user may see (null = all). */
export function visibleProjectIds(db, user) {
  if (user.role === 'admin' || user.scope === 'all') return null;
  return new Set(user.projectIds);
}
