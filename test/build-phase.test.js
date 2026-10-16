// Giai đoạn "Xây dựng" vs trạng thái "Nháp" (demo data): a build-phase product is running — direct staff, its share of
// the Dự án's shared staff and team overhead count like any running product; only P&L and the composite score differ.
// A draft has no cost and takes no share. Plus "Việc cần xử lý" (Admin).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { round } from '../shared/format.js';
import { startTestServer } from './helpers/test-server.js';

let t;
let ids;
let month;
before(async () => {
  t = await startTestServer();
  const meta = (await t.api('admin', 'GET', '/api/meta')).data;
  ids = Object.fromEntries(meta.projects.map((p) => [p.name, p.id]));
  month = meta.firstOpenDate.slice(0, 7);
});
after(() => t.stop());

const staff = (ov) => ov.members.map((m) => [m.name, m.role, round(m.effortPct), m.shared ? `chia từ ${m.fromName}` : 'trực tiếp', m.monthlyCost == null ? null : round(m.monthlyCost)]);

test('6. Game A (Xây dựng): Đỗ Vy 50% trực tiếp 9.000.000 + Võ Nam 50% chia từ ABC Game Studio 12.000.000 = 21.000.000', async () => {
  const ov = (await t.api('admin', 'GET', `/api/projects/${ids['Game A']}/overview?period=month`)).data;
  assert.equal(ov.project.phase, 'build');
  assert.deepEqual(staff(ov), [['Đỗ Vy', 'Game Artist', 50, 'trực tiếp', 9_000_000], ['Võ Nam', 'Game Developer', 50, 'chia từ ABC Game Studio', 12_000_000]]);
  assert.equal(round(ov.members.reduce((s, m) => s + m.monthlyCost, 0)), 21_000_000);
  assert.ok(ov.project.costMonthly > 21_000_000, 'plus the team overhead by effective FTE');
  assert.equal(ov.project.budget.inBuild, true);
  assert.equal(ov.project.cumulative.since, '2026-04-01');
  assert.ok(ov.project.cumulative.value > 0);
  const viewer = (await t.api('viewer', 'GET', `/api/projects/${ids['Game A']}/overview?period=month`)).data;
  assert.ok(viewer.members.every((m) => m.monthlyCost === undefined), 'per-person cost is Admin only');
});

test('7. Game B receives 12.000.000 of Nam', async () => {
  const ov = (await t.api('admin', 'GET', `/api/projects/${ids['Game B']}/overview?period=month`)).data;
  assert.deepEqual(staff(ov), [['Đỗ Vy', 'Game Artist', 30, 'trực tiếp', 5_400_000], ['Võ Nam', 'Game Developer', 50, 'chia từ ABC Game Studio', 12_000_000]]);
});

test('8–9. Game A is in the team cost table and in ABC Game Studio\'s total; the composite score counts Game B only', async () => {
  const rows = (await t.api('admin', 'GET', `/api/team-costs?month=${month}`)).data.table.rows;
  const a = rows.find((r) => r.name === 'Game A');
  assert.equal(round(a.direct), 21_000_000);
  assert.ok(a.overhead > 0 && a.teamPct > 0);
  const abc = (await t.api('admin', 'GET', `/api/projects/${ids['ABC Game Studio']}/overview?period=month`)).data;
  const kids = Object.fromEntries(abc.children.map((c) => [c.name, c]));
  assert.ok(kids['Game A'].cost > 0);
  assert.equal(round(abc.project.cost), round(kids['Game A'].cost + kids['Game B'].cost));
  assert.equal(abc.project.score, kids['Game B'].score);
  assert.equal(abc.project.scoreUsed, 1);
  const dash = (await t.api('admin', 'GET', '/api/dashboard?period=month')).data;
  assert.equal(round(dash.rows.find((r) => r.name === 'ABC Game Studio').cost), round(abc.project.cost));
  // Kịch bản A numbers of Zell App are kept.
  const zell = dash.rows.find((r) => r.name === 'Zell App');
  assert.equal(round(zell.cost), 92_000_000);
  assert.equal(zell.revenue, 96_200_000);
});

test('10. a draft product has no cost, takes no share of the shared staff and is not on the Dashboard', async () => {
  const d = await t.api('admin', 'POST', '/api/projects', {
    info: { name: 'Game Nháp', color: '#64748B', platforms: ['playables'], parentId: ids['ABC Game Studio'], phase: 'build' },
    baselines: { list: [{ metricKey: 'feature_progress', weight: 100, targetMonthly: 50, source: 'manual', period: 'month' }], thresholds: { green: 80, red: 50 } },
    staffing: { rows: [], manualAllocPct: 0 }, activate: false });
  assert.equal(d.status, 201, d.data.error);
  const st = (await t.api('admin', 'GET', `/api/projects/${ids['ABC Game Studio']}/staffing?date=${month}-01`)).data;
  const share = Object.fromEntries(st.parentCost.children.map((c) => [c.name, round(c.parentShared)]));
  assert.deepEqual(share, { 'Game A': 12_000_000, 'Game B': 12_000_000, 'Game Nháp': 0 });
  const dash = (await t.api('admin', 'GET', '/api/dashboard?period=month')).data;
  assert.ok(!dash.projects.some((p) => p.name === 'Game Nháp'));
  assert.ok(!(await t.api('admin', 'GET', '/api/meta')).data.projects.some((p) => p.name === 'Game Nháp'));
  const rows = (await t.api('admin', 'GET', `/api/team-costs?month=${month}`)).data.table.rows;
  assert.ok(!rows.some((r) => r.name === 'Game Nháp' && r.total > 0));
});

test('5. no "Việc cần xử lý": a failed connection shows on the product overview, for Admins only', async () => {
  assert.equal((await t.api('admin', 'GET', '/api/todos')).status, 404);
  const id = (await t.api('admin', 'GET', '/api/meta')).data.projects.find((p) => p.name === 'Mindfulness Bell').id;
  const admin = (await t.api('admin', 'GET', `/api/projects/${id}/overview?period=month`)).data;
  assert.deepEqual(admin.connectionErrors, ['App Store Connect']);
  const viewer = (await t.api('viewer', 'GET', `/api/projects/${id}/overview?period=month`)).data;
  assert.ok(!('connectionErrors' in viewer));
});
