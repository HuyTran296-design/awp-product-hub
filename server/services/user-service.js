// "Người dùng & phân quyền": login accounts with role (Admin/Viewer), view scope and status.
// Safety rules: at least one active Admin must remain; nobody may delete, lock or demote themselves.
// Every change is written to the audit log (action "Người dùng").

import crypto from 'node:crypto';
import { listProjects, mapUser, tx } from '../database.js';
import { logChange } from './audit-log.js';
import { httpError } from './connection-service.js';

export const ROLE_LABELS = { admin: 'Admin', viewer: 'Viewer' };
export const STATUS_LABELS = { active: 'Đang hoạt động', invited: 'Đã mời – chờ kích hoạt', locked: 'Đã khóa' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function listUsers(db) {
  return db.prepare('SELECT * FROM users WHERE deleted_at IS NULL ORDER BY id').all().map(mapUser);
}

function getUserRow(db, id) {
  const u = mapUser(db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(id));
  if (!u) throw httpError(404, 'Không tìm thấy người dùng');
  return u;
}

const activeAdmins = (db) => listUsers(db).filter((u) => u.role === 'admin' && u.status === 'active');

/** Why an action is not allowed on `target` for `me` (or null). Shared by the API and the UI. */
export function lockReason(db, me, target, action) {
  if (!['delete', 'lock', 'demote'].includes(action)) return null;
  const reasons = [];
  if (target.role === 'admin' && target.status === 'active' && activeAdmins(db).length <= 1) {
    reasons.push('Phải luôn còn ít nhất 1 Admin đang hoạt động — đây là Admin cuối cùng.');
  }
  if (target.id === me.id) {
    reasons.push({ delete: 'Không thể tự xóa tài khoản của chính mình.', lock: 'Không thể tự khóa tài khoản của chính mình.',
      demote: 'Không thể tự hạ quyền của chính mình.' }[action]);
  }
  return reasons.length ? reasons.join(' ') : null;
}

function parseUser(db, body, existingId = null) {
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const role = body.role === 'admin' ? 'admin' : body.role === 'viewer' ? 'viewer' : null;
  const errors = [];
  if (!name) errors.push('Vui lòng nhập họ tên.');
  if (!EMAIL_RE.test(email)) errors.push('Email không đúng định dạng.');
  if (!role) errors.push('Chọn vai trò Admin hoặc Viewer.');
  const dup = db.prepare('SELECT id FROM users WHERE lower(email) = lower(?) AND deleted_at IS NULL AND id IS NOT ?').get(email, existingId);
  if (dup) errors.push('Email này đã được dùng cho một người dùng khác.');
  const scope = role === 'viewer' && body.scope === 'selected' ? 'selected' : 'all';
  const known = new Set(listProjects(db).map((p) => p.id));
  const projectIds = scope === 'selected' ? [...new Set((body.projectIds || []).map(Number))].filter((id) => known.has(id)) : [];
  if (scope === 'selected' && !projectIds.length) errors.push('Chọn ít nhất 1 dự án trong phạm vi xem.');
  if (errors.length) throw httpError(422, errors[0], errors.map((message) => ({ message })));
  return { name, email, role, scope, projectIds };
}

function scopeText(db, u) {
  if (u.role === 'admin' || u.scope === 'all') return 'Tất cả dự án';
  const names = Object.fromEntries(listProjects(db).map((p) => [p.id, p.name]));
  return u.projectIds.map((id) => names[id] ?? `#${id}`).join(', ');
}

const log = (db, actor, field, o, n) => logChange(db, { actor, action: 'Người dùng', field, oldValue: o, newValue: n });

export function inviteLink(origin, token) {
  return `${origin}/#/invite/${token}`;
}

export function createUser(db, me, body) {
  const u = parseUser(db, body);
  const token = crypto.randomBytes(18).toString('hex');
  const id = tx(db, () => {
    const newId = Number(db.prepare(`INSERT INTO users (name, email, role, scope, project_ids, status, invite_token, created_at)
      VALUES (?, ?, ?, ?, ?, 'invited', ?, ?)`).run(u.name, u.email, u.role, u.scope, JSON.stringify(u.projectIds), token,
      new Date().toISOString()).lastInsertRowid);
    log(db, me.name, `Thêm ${u.name}`, '—', `${u.email} · ${ROLE_LABELS[u.role]} · ${scopeText(db, u)} · ${STATUS_LABELS.invited}`);
    return newId;
  });
  return { user: getUserRow(db, id), token };
}

export function updateUser(db, me, id, body) {
  const old = getUserRow(db, id);
  const next = parseUser(db, body, id);
  if (old.role === 'admin' && next.role === 'viewer') {
    const why = lockReason(db, me, old, 'demote');
    if (why) throw httpError(422, why);
  }
  tx(db, () => {
    db.prepare('UPDATE users SET name = ?, email = ?, role = ?, scope = ?, project_ids = ? WHERE id = ?')
      .run(next.name, next.email, next.role, next.scope, JSON.stringify(next.projectIds), id);
    if (old.name !== next.name) log(db, me.name, 'Họ tên', old.name, next.name);
    if (old.email !== next.email) log(db, me.name, `Email ${next.name}`, old.email, next.email);
    if (old.role !== next.role) log(db, me.name, `Vai trò ${next.name}`, ROLE_LABELS[old.role], ROLE_LABELS[next.role]);
    if (scopeText(db, old) !== scopeText(db, next)) log(db, me.name, `Phạm vi xem ${next.name}`, scopeText(db, old), scopeText(db, next));
  });
  return getUserRow(db, id);
}

export function setLocked(db, me, id, locked) {
  const u = getUserRow(db, id);
  if (locked) {
    const why = lockReason(db, me, u, 'lock');
    if (why) throw httpError(422, why);
    if (u.status === 'locked') return u;
  } else if (u.status !== 'locked') return u;
  // Unlocking returns to "Đã mời" if the invitation was never accepted.
  const pendingInvite = db.prepare('SELECT invite_token FROM users WHERE id = ?').get(id).invite_token;
  const next = locked ? 'locked' : pendingInvite ? 'invited' : 'active';
  tx(db, () => {
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(next, id);
    log(db, me.name, `Trạng thái ${u.name}`, STATUS_LABELS[u.status], STATUS_LABELS[next]);
  });
  return getUserRow(db, id);
}

export function resendInvite(db, me, id) {
  const u = getUserRow(db, id);
  if (u.status !== 'invited') throw httpError(409, 'Chỉ gửi lại lời mời cho tài khoản "Đã mời".');
  const token = crypto.randomBytes(18).toString('hex');
  tx(db, () => {
    db.prepare('UPDATE users SET invite_token = ? WHERE id = ?').run(token, id);
    log(db, me.name, `Gửi lại lời mời ${u.name}`, null, u.email);
  });
  return { user: u, token };
}

export function deleteUser(db, me, id, confirmEmail) {
  const u = getUserRow(db, id);
  const why = lockReason(db, me, u, 'delete');
  if (why) throw httpError(422, why);
  if (String(confirmEmail || '').trim().toLowerCase() !== u.email.toLowerCase()) throw httpError(422, 'Email nhập vào không khớp.');
  tx(db, () => {
    db.prepare('UPDATE users SET deleted_at = ?, invite_token = NULL WHERE id = ?').run(new Date().toISOString(), id);
    log(db, me.name, `Xóa ${u.name}`, `${u.email} · ${ROLE_LABELS[u.role]}`, '—');
  });
  return { ok: true };
}

/** Rows for the users page, with per-action lock reasons for the current Admin. */
export function usersPayload(db, me) {
  // Scope picker: one checkbox per project, sorted by name.
  const projects = listProjects(db).map(({ id, name, color }) => ({ id, name, color })).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  return {
    me: me.id, projects,
    users: listUsers(db).map((u) => ({
      ...u, scopeText: scopeText(db, u),
      locks: Object.fromEntries(['delete', 'lock', 'demote'].map((a) => [a, lockReason(db, me, u, a)])),
    })),
  };
}
