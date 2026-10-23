// Người dùng & phân quyền: view scope, safety rules, invites, audit log, "Xem với vai trò…".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers/test-server.js';

let t;
before(async () => { t = await startTestServer(); });
after(() => t.stop());

test('quan.do (Viewer · Game B) sees only Game B; Game A → "Bạn không có quyền truy cập"; Dashboard adds Game B only', async () => {
  const { api } = t;
  const all = (await api('admin', 'GET', '/api/meta')).data.projects;
  const id = (name) => all.find((p) => p.name === name).id;
  const meta = (await api('viewerGameB', 'GET', '/api/meta')).data;
  assert.deepEqual(meta.projects.map((p) => p.name), ['Game B']);
  const dash = (await api('viewerGameB', 'GET', '/api/dashboard?period=month')).data;
  assert.deepEqual(dash.projects.map((p) => p.name), ['Game B']);
  assert.equal(dash.scoped, true);
  assert.equal(dash.team.cost, dash.projects[0].cost, 'totals = Game B only');
  assert.equal(dash.team.revenue, dash.projects[0].revenue);
  assert.equal(dash.team.unallocated, null);
  assert.equal(dash.costShare, null);
  const blocked = await api('viewerGameB', 'GET', `/api/projects/${id('Game A')}/overview?period=month`);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.error, 'Bạn không có quyền truy cập');
  assert.equal((await api('viewerGameB', 'GET', `/api/projects/${id('Game A')}/stoploss`)).status, 403);
  assert.deepEqual((await api('viewerGameB', 'GET', '/api/stoploss')).data.rows.map((r) => r.name), ['Game B']);
  for (const url of ['/api/projects', '/api/team-costs', '/api/members', '/api/users']) {
    const r = await api('viewerGameB', 'GET', url);
    assert.equal(r.status, 403, url);
    assert.equal(r.data.error, 'Bạn không có quyền truy cập');
  }
  assert.equal((await api('viewerGameB', 'GET', `/api/projects/${id('Game B')}/overview?period=month`)).status, 200);
});

test('thanh.chau (Viewer · Game A) sees only Game A; Dashboard adds Game A only', async () => {
  const { api } = t;
  const all = (await api('admin', 'GET', '/api/meta')).data.projects;
  const id = (name) => all.find((p) => p.name === name).id;
  assert.deepEqual((await api('viewerGameA', 'GET', '/api/meta')).data.projects.map((p) => p.name), ['Game A']);
  const dash = (await api('viewerGameA', 'GET', '/api/dashboard?period=month')).data;
  assert.deepEqual(dash.projects.map((p) => p.name), ['Game A']);
  assert.equal(dash.team.cost, dash.projects[0].cost);
  assert.equal((await api('viewerGameA', 'GET', `/api/projects/${id('Game B')}/overview?period=month`)).status, 403);
});

test('the last active Admin cannot be deleted, locked or demoted; nobody acts on themselves', async () => {
  const { api } = t;
  const { data } = await api('admin', 'GET', '/api/users');
  const me = data.users.find((u) => u.id === data.me);
  assert.ok(me.locks.delete && me.locks.lock && me.locks.demote);
  const huy = data.users.find((u) => u.email === 'huy.tran@abcdigital.io');
  assert.equal(huy.locks.delete, null);
  assert.equal((await api('admin', 'POST', `/api/users/${me.id}/lock`, { locked: true })).status, 422);
  const demote = await api('admin', 'PUT', `/api/users/${me.id}`, { name: me.name, email: me.email, role: 'viewer' });
  assert.equal(demote.status, 422);
  assert.equal((await api('admin', 'DELETE', `/api/users/${me.id}`, { confirmEmail: me.email })).status, 422);
});

test('adding a user creates an invite; invite activates the account; actions are logged', async () => {
  const { api, login, apiAs } = t;
  const bad = await api('admin', 'POST', '/api/users', { name: 'X', email: 'huy.tran@abcdigital.io', role: 'viewer' });
  assert.match(bad.data.error, /đã được dùng/);
  const r = await api('admin', 'POST', '/api/users', { name: 'Vũ Mai', email: 'mai.vu@abcdigital.io', role: 'admin' });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.status, 'invited');
  assert.match(r.data.inviteLink, /#\/invite\/[a-f0-9]+$/);
  assert.equal((await login('mai.vu@abcdigital.io')).status, 401, 'invited accounts cannot sign in yet');
  const token = r.data.inviteLink.split('/').pop();
  const accept = await fetch(r.data.inviteLink.split('/#')[0] + '/api/invite/accept', { method: 'POST', body: JSON.stringify({ token }) });
  assert.equal(accept.status, 200);
  const mai = await login('mai.vu@abcdigital.io');
  assert.equal(typeof mai, 'string');
  // Mai (Admin) edits a member, then gets deleted: history keeps "Vũ Mai (đã xóa)".
  const members = (await apiAs(mai, 'GET', '/api/members')).data.members;
  const m = members[0];
  await apiAs(mai, 'PUT', `/api/members/${m.id}`, { ...m, role: `${m.role} (cập nhật)` });
  const id = r.data.user.id;
  assert.equal((await api('admin', 'DELETE', `/api/users/${id}`, { confirmEmail: 'sai@x.io' })).status, 422);
  assert.equal((await api('admin', 'DELETE', `/api/users/${id}`, { confirmEmail: 'mai.vu@abcdigital.io' })).status, 200);
  assert.equal((await apiAs(mai, 'GET', '/api/meta')).status, 401, 'deleted user is signed out on next request');
  const hist = (await api('admin', 'GET', '/api/team-history')).data.history;
  assert.ok(hist.some((h) => h.actor === 'Vũ Mai (đã xóa)'));
  const log = (await api('admin', 'GET', '/api/users/log')).data.log;
  assert.ok(log.some((h) => h.field === 'Thêm Vũ Mai' && h.actor === 'Khánh Mai'));
  assert.ok(log.some((h) => h.field === 'Xóa Vũ Mai'));
});

test('locking takes effect on the next request; role change is logged old → new', async () => {
  const { api, login, apiAs } = t;
  const huyCookie = await login('huy.tran@abcdigital.io');
  const huy = (await api('admin', 'GET', '/api/users')).data.users.find((u) => u.email === 'huy.tran@abcdigital.io');
  await api('admin', 'POST', `/api/users/${huy.id}/lock`, { locked: true });
  assert.equal((await apiAs(huyCookie, 'GET', '/api/meta')).status, 401);
  await api('admin', 'POST', `/api/users/${huy.id}/lock`, { locked: false });
  await api('admin', 'PUT', `/api/users/${huy.id}`, { name: huy.name, email: huy.email, role: 'admin' });
  const log = (await api('admin', 'GET', '/api/users/log')).data.log;
  const change = log.find((h) => h.field === `Vai trò ${huy.name}`);
  assert.deepEqual([change.oldValue, change.newValue], ['Viewer', 'Admin']);
  // Two active Admins now: Khánh Mai's own account is still protected, but Huy can be demoted again.
  const users = (await api('admin', 'GET', '/api/users')).data.users;
  assert.equal(users.find((u) => u.id === huy.id).locks.demote, null);
});

test('"Xem với vai trò…" lets an Admin preview the Viewer UI and switch back', async () => {
  const { api } = t;
  await api('admin', 'POST', '/api/view-as', { mode: 'viewer-all' });
  const s = (await api('admin', 'GET', '/api/session')).data.user;
  assert.equal(s.role, 'viewer');
  assert.equal(s.realRole, 'admin');
  assert.equal((await api('admin', 'GET', '/api/members')).status, 403);
  await api('admin', 'POST', '/api/view-as', {});
  assert.equal((await api('admin', 'GET', '/api/members')).status, 200);
  assert.equal((await api('viewerGameB', 'POST', '/api/view-as', { mode: 'viewer-all' })).status, 403);
});

test('sample accounts: Khánh Mai (Admin) and three Viewers with their view scopes', async () => {
  const fresh = await startTestServer(); // earlier tests change roles on the shared server
  try {
    const { api } = fresh;
    const users = (await api('admin', 'GET', '/api/users')).data.users;
    const byEmail = Object.fromEntries(users.map((u) => [u.email, u]));
    for (const [email, name, role, scope] of [['khanh.mai@abcdigital.io', 'Khánh Mai', 'admin', 'Tất cả dự án'],
      ['huy.tran@abcdigital.io', 'Huy Trần', 'viewer', 'Tất cả dự án'], ['quan.do@abcdigital.io', 'Quân Đỗ', 'viewer', 'Game B'],
      ['thanh.chau@abcdigital.io', 'Thành Châu', 'viewer', 'Game A']]) {
      assert.equal(byEmail[email]?.name, name, email);
      assert.equal(byEmail[email].role, role, email);
      assert.equal(byEmail[email].status, 'active', email);
      assert.equal(byEmail[email].scopeText, scope, email);
    }
    assert.equal(users.length, 4);
    // khanh.mai: configuration, per-person cost, Game A and Game B; the only Admin cannot remove themselves.
    const me = (await api('admin', 'GET', '/api/users')).data;
    const mai = me.users.find((u) => u.email === 'khanh.mai@abcdigital.io');
    assert.ok(mai.locks.delete && mai.locks.lock && mai.locks.demote);
    assert.deepEqual((await api('admin', 'GET', '/api/meta')).data.projects.map((p) => p.name), ['Game A', 'Game B']);
    assert.ok((await api('admin', 'GET', '/api/projects/1/overview?period=month')).data.members.every((m) => m.monthlyCost != null));
    // huy.tran: Game A, Game B; no configuration, no per-person cost.
    assert.deepEqual((await api('viewer', 'GET', '/api/meta')).data.projects.map((p) => p.name), ['Game A', 'Game B']);
    assert.equal((await api('viewer', 'GET', '/api/members')).status, 403);
    assert.ok((await api('viewer', 'GET', '/api/projects/1/overview?period=month')).data.members.every((m) => m.monthlyCost === undefined));
  } finally {
    fresh.stop();
  }
});
