// REST API — sign-in, invites, "Xem với vai trò…" and "Người dùng & phân quyền" (Admin only).

import { acceptInvite, destroySession, getUser, setViewAs, signIn } from './auth.js';
import { listHistory } from './services/audit-log.js';
import { httpError } from './services/connection-service.js';
import {
  createUser, deleteUser, inviteLink, listUsers, resendInvite, setLocked, updateUser, usersPayload,
} from './services/user-service.js';

export function buildUserRoutes({ db }) {
  const requireRealAdmin = (user) => {
    if (user.realRole !== 'admin') throw httpError(403, 'Bạn không có quyền truy cập');
  };
  return [
    ['POST', '/api/session', ({ body }) => {
      const r = signIn(db, body.email);
      if (r.error) throw httpError(401, r.error);
      return { status: 200, headers: { 'Set-Cookie': r.cookie }, body: { ok: true } };
    }, 'public'],
    ['POST', '/api/invite/accept', ({ body }) => {
      const r = acceptInvite(db, body.token);
      if (r.error) throw httpError(400, r.error);
      return { status: 200, headers: { 'Set-Cookie': r.cookie }, body: { ok: true, name: r.name } };
    }, 'public'],
    ['GET', '/api/session', ({ req }) => ({ user: getUser(req, db) }), 'public'],
    ['DELETE', '/api/session', ({ req }) => ({ status: 200, headers: { 'Set-Cookie': destroySession() }, body: { ok: true } }), 'public'],

    // Prototype only: an Admin previews the UI as a Viewer (all projects, or as a specific Viewer account).
    ['GET', '/api/view-as', ({ user }) => {
      requireRealAdmin(user);
      return { current: user.viewAs, viewers: listUsers(db).filter((u) => u.role === 'viewer' && u.status === 'active')
        .map((u) => ({ id: u.id, name: u.name, scope: u.scope })) };
    }, 'user'],
    ['POST', '/api/view-as', ({ req, user, body }) => {
      requireRealAdmin(user);
      const cookie = setViewAs(req, body.mode === 'viewer-all' ? { role: 'viewer' } : body.userId ? { userId: Number(body.userId) } : null);
      return { status: 200, headers: cookie ? { 'Set-Cookie': cookie } : {}, body: { ok: true } };
    }, 'user'],

    ['GET', '/api/users', ({ user }) => usersPayload(db, user), 'admin'],
    ['POST', '/api/users', ({ user, body, origin }) => {
      const { user: created, token } = createUser(db, user, body);
      return { status: 201, body: { user: created, inviteLink: inviteLink(origin, token) } };
    }, 'admin'],
    ['PUT', '/api/users/:id', ({ user, params, body }) => ({ user: updateUser(db, user, Number(params.id), body) }), 'admin'],
    ['POST', '/api/users/:id/lock', ({ user, params, body }) => ({ user: setLocked(db, user, Number(params.id), body.locked !== false) }), 'admin'],
    ['POST', '/api/users/:id/resend', ({ user, params, origin }) => {
      const { token } = resendInvite(db, user, Number(params.id));
      return { inviteLink: inviteLink(origin, token) };
    }, 'admin'],
    ['DELETE', '/api/users/:id', ({ user, params, body }) => deleteUser(db, user, Number(params.id), body.confirmEmail), 'admin'],
    ['GET', '/api/users/log', () => ({ log: listHistory(db, null, { action: 'Người dùng' }) }), 'admin'],
  ];
}
