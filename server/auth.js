// Prototype authentication: email sign-in (no password), invite links, signed-cookie sessions (HttpOnly).
// The session cookie carries only the user id and the "Xem với vai trò…" choice, signed with HMAC-SHA256, so any
// server instance can read it (serverless). Role, scope and status are re-read on every request, so a role change,
// a lock or a deletion takes effect on the user's next page load.
// "Xem với vai trò…" (prototype only): an Admin may preview the app as a Viewer; the real role is kept.

import crypto from 'node:crypto';
import { mapUser } from './database.js';

const COOKIE = 'awp_sid';
const MAX_AGE = 604800; // 7 days
// AWP_SESSION_SECRET keeps sessions valid across restarts and server instances; without it a restart signs everyone out.
const SECRET = process.env.AWP_SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

/** Cookie for the session { userId, viewAs: null | { userId } | { role: 'viewer' } }. */
function sessionCookie(session) {
  const data = Buffer.from(JSON.stringify({ ...session, exp: Date.now() + MAX_AGE * 1000 })).toString('base64url');
  return `${COOKIE}=${data}.${sign(data)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}`;
}

function readSession(req) {
  const header = req.headers.cookie || '';
  const raw = header.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const [data, mac] = (raw || '').split('.');
  if (!data || !mac) return null;
  const expected = sign(data);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const s = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    return s.exp > Date.now() ? s : null;
  } catch { return null; }
}

const newSession = (userId) => sessionCookie({ userId, viewAs: null });

/** Email sign-in for active accounts. Returns { cookie } or { error }. */
export function signIn(db, email) {
  const row = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?) AND deleted_at IS NULL').get(String(email || '').trim());
  if (!row) return { error: 'Không tìm thấy tài khoản với email này.' };
  if (row.status === 'locked') return { error: 'Tài khoản đã bị khóa. Liên hệ Admin.' };
  if (row.status === 'invited') return { error: 'Tài khoản chưa kích hoạt — hãy mở link mời Admin đã gửi.' };
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
  return { cookie: newSession(row.id) };
}

/** Accept an invite link: activates the account and signs in. */
export function acceptInvite(db, token) {
  const row = token && db.prepare("SELECT * FROM users WHERE invite_token = ? AND status = 'invited' AND deleted_at IS NULL").get(token);
  if (!row) return { error: 'Link mời không hợp lệ hoặc đã được dùng.' };
  db.prepare("UPDATE users SET status = 'active', invite_token = NULL, last_login_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
  return { cookie: newSession(row.id), name: row.name };
}

export function destroySession() {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

/**
 * Effective user for this request, or null (signed out, locked, deleted).
 * { id, name, email, role, scope, projectIds, realRole, viewAs }
 */
export function getUser(req, db) {
  const s = readSession(req);
  if (!s) return null;
  const real = mapUser(db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(s.userId));
  if (!real || real.status !== 'active') return null;
  const user = { ...real, realRole: real.role, viewAs: null };
  if (real.role === 'admin' && s.viewAs) {
    if (s.viewAs.userId) {
      const v = mapUser(db.prepare("SELECT * FROM users WHERE id = ? AND role = 'viewer' AND deleted_at IS NULL").get(s.viewAs.userId));
      if (v) Object.assign(user, { role: 'viewer', scope: v.scope, projectIds: v.projectIds, viewAs: { userId: v.id, label: `${v.name} (Viewer)` } });
    } else {
      Object.assign(user, { role: 'viewer', scope: 'all', projectIds: [], viewAs: { label: 'Viewer · tất cả dự án & sản phẩm' } });
    }
  }
  return user;
}

/** Admin-only (real role) preview as a Viewer; null returns to the own role. Returns the new session cookie. */
export function setViewAs(req, viewAs) {
  const s = readSession(req);
  return s ? sessionCookie({ userId: s.userId, viewAs }) : null;
}
