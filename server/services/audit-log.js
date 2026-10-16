// Change history: who changed what (old → new), when, effective from which date, and why.
// Entries made by a signed-in user keep the account id; deleted accounts show as "Tên (đã xóa)".

import { currentUserId } from '../request-context.js';

export function logChange(db, { projectId = null, actor, action, field = null, oldValue = null, newValue = null, effectiveDate = null, reason = null }) {
  db.prepare(`INSERT INTO audit_log (project_id, actor, actor_user_id, at, action, field, old_value, new_value, effective_date, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(projectId, actor, currentUserId(), new Date().toISOString(), action, field,
    oldValue == null ? null : String(oldValue), newValue == null ? null : String(newValue), effectiveDate, reason || null);
}

export function listHistory(db, projectId, { action = null } = {}) {
  const where = [projectId == null ? 'a.project_id IS NULL' : 'a.project_id = ?'];
  const args = projectId == null ? [] : [projectId];
  if (action) { where.push('a.action = ?'); args.push(action); }
  return db.prepare(`SELECT a.*, u.deleted_at AS actor_deleted FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
    WHERE ${where.join(' AND ')} ORDER BY a.at DESC, a.id DESC`).all(...args)
    .map((r) => ({ id: r.id, actor: r.actor_deleted ? `${r.actor} (đã xóa)` : r.actor, at: r.at, action: r.action, field: r.field,
      oldValue: r.old_value, newValue: r.new_value, effectiveDate: r.effective_date, reason: r.reason }));
}
