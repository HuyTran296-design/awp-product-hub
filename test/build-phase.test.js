// Giai đoạn "Xây dựng" vs trạng thái "Nháp" (demo data): a build-phase project is running — its staff and Tools/AI count
// like any running project; only P&L and the ranking differ. A draft has no cost.
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

const staff = (ov) => ov.members.map((m) => [m.name, m.role, round(m.effortPct), m.monthlyCost == null ? null : round(m.monthlyCost)]);

test('C. Game A lương 21.000.000 (Vy 9.000.000 + Nam 12.000.000); Game B 17.400.000 (Vy 5.400.000 + Nam 12.000.000)', async () => {
  const a = (await t.api('admin', 'GET', `/api/projects/${ids['Game A']}/overview?period=month`)).data;
  assert.equal(a.project.phase, 'build');
  assert.deepEqual(staff(a), [['Võ Nam', 'Game Developer', 50, 12_000_000], ['Đỗ Vy', 'Game Artist', 50, 9_000_000]]);
  assert.equal(round(a.members.reduce((s, m) => s + m.monthlyCost, 0)), 21_000_000);
  assert.ok(a.project.costMonthly > 21_000_000, 'plus Tools/AI by FTE');
  assert.equal(a.project.cumulative.since, '2026-04-01');
  const b = (await t.api('admin', 'GET', `/api/projects/${ids['Game B']}/overview?period=month`)).data;
  assert.deepEqual(staff(b), [['Võ Nam', 'Game Developer', 50, 12_000_000], ['Đỗ Vy', 'Game Artist', 30, 5_400_000]]);
  const viewer = (await t.api('viewer', 'GET', `/api/projects/${ids['Game A']}/overview?period=month`)).data;
  assert.ok(viewer.members.every((m) => m.monthlyCost === undefined), 'per-person cost is Admin only');
});

test('C. giving Nam 10% more on a new project → "Vượt 10% (Nam đã dùng 100%: Game A 50%, Game B 50%)"', async () => {
  const nam = (await t.api('admin', 'GET', '/api/members')).data.members.find((m) => m.name === 'Võ Nam').id;
  const r = await t.api('admin', 'POST', '/api/projects/preview', { info: { name: 'Game C' }, activationDate: `${month}-01`,
    staffing: { rows: [{ memberId: nam, effortPct: 10 }] } });
  assert.match(r.data.errors[0], /Vượt 10% \(Nam đã dùng 100%: Game A 50%, Game B 50%\)/);
});

test('Đang xây dựng: Game A is listed apart from the ranking, its cost still counts in the team total', async () => {
  const dash = (await t.api('admin', 'GET', '/api/dashboard?period=month')).data;
  assert.deepEqual(dash.projects.map((p) => [p.name, p.phase]).sort(), [['Game A', 'build'], ['Game B', 'growth']]);
  const rows = (await t.api('admin', 'GET', `/api/team-costs?month=${month}`)).data.table.rows;
  const a = rows.find((r) => r.name === 'Game A');
  assert.equal(round(a.salary), 21_000_000);
  assert.ok(a.tools > 0 && a.teamPct > 0);
});

test('a draft project has no cost and is not on the Dashboard', async () => {
  const d = await t.api('admin', 'POST', '/api/projects', {
    info: { name: 'Game Nháp', color: '#64748B', platforms: ['playables'], phase: 'build' },
    baselines: { list: [{ metricKey: 'feature_progress', weight: 100, targetMonthly: 50, source: 'manual', period: 'month' }], thresholds: { green: 80, red: 50 } },
    staffing: { rows: [] }, activate: false });
  assert.equal(d.status, 201, d.data.error);
  const dash = (await t.api('admin', 'GET', '/api/dashboard?period=month')).data;
  assert.ok(!dash.projects.some((p) => p.name === 'Game Nháp'));
  assert.ok(!(await t.api('admin', 'GET', '/api/meta')).data.projects.some((p) => p.name === 'Game Nháp'));
  const rows = (await t.api('admin', 'GET', `/api/team-costs?month=${month}`)).data.table.rows;
  assert.ok(!rows.some((r) => r.name === 'Game Nháp' && r.total > 0));
});

test('no "Việc cần xử lý"; no Store connection errors in the demo data', async () => {
  assert.equal((await t.api('admin', 'GET', '/api/todos')).status, 404);
  const admin = (await t.api('admin', 'GET', `/api/projects/${ids['Game B']}/overview?period=month`)).data;
  assert.deepEqual(admin.connectionErrors, []);
  const viewer = (await t.api('viewer', 'GET', `/api/projects/${ids['Game B']}/overview?period=month`)).data;
  assert.ok(!('connectionErrors' in viewer));
});
