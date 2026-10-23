// End-to-end API checks against a temporary database seeded with the sample configuration.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { round } from '../shared/format.js';
import { nextMonth, startTestServer } from './helpers/test-server.js';

let api;
let stop;

before(async () => {
  ({ api, stop } = await startTestServer({ scenario: 'A' }));
});

after(() => stop());

test('month: revenue, cost, profit, score and colors match acceptance numbers', async () => {
  const { data } = await api('admin', 'GET', '/api/dashboard?period=month');
  const [zen, mb] = data.projects;
  assert.equal(zen.revenue, 62_400_000);
  assert.equal(round(zen.cost), 51_311_111);
  assert.equal(round(zen.profit), 11_088_889);
  assert.equal(zen.score, 99.1);
  assert.equal(zen.status, 'green');
  assert.deepEqual(zen.baselines.map((b) => b.pct), [104.0, 95.0, 102.7, 93.0, 100.0]);
  assert.equal(mb.revenue, 33_800_000);
  assert.equal(round(mb.profit), -6_888_889);
  assert.deepEqual(mb.baselines.map((b) => b.pct), [84.5, 80.0, 46.7, 70.6, 55.6]);
  assert.deepEqual(mb.baselines.map((b) => b.status), ['green', 'yellow', 'red', 'yellow', 'yellow']);
  assert.equal(mb.score, 71.6);
  assert.equal(mb.status, 'yellow');
  assert.equal(round(data.team.unallocated), 8_000_000);
});

test('period cost uses the conversion table (week = 5/21)', async () => {
  const { data } = await api('admin', 'GET', '/api/dashboard?period=week');
  assert.equal(round(data.projects[0].cost), round(51_311_111.11 * 5 / 21));
  assert.equal(data.range.days, 7);
});

test('every period filter responds on every page', async () => {
  for (const period of ['day', '3days', 'week', 'month', 'quarter', 'year']) {
    for (const url of ['/api/dashboard', '/api/projects/1/overview', '/api/projects/2/marketing']) {
      const { status } = await api('viewer', 'GET', `${url}?period=${period}`);
      assert.equal(status, 200, `${url} ${period}`);
    }
  }
});

test('viewer never receives per-person cost', async () => {
  const ov = await api('viewer', 'GET', '/api/projects/1/overview?period=month');
  assert.ok(ov.data.members.length > 0);
  assert.ok(ov.data.members.every((m) => !('monthlyCost' in m)));
  assert.ok(!('costDirect' in ov.data.project));
  for (const url of ['/api/members', '/api/team-costs', '/api/projects/1/edit', '/api/projects/1/staffing', '/api/projects/1/history']) {
    assert.equal((await api('viewer', 'GET', url)).status, 403, url);
  }
  assert.equal((await api('viewer', 'GET', '/api/projects')).status, 403, 'Viewer has no Cấu hình');
  const adminOv = await api('admin', 'GET', '/api/projects/1/overview?period=month');
  assert.equal(adminOv.data.members[0].monthlyCost, 12_500_000);
});

test('over-allocation blocks save and names the person', async () => {
  const { data: meta } = await api('admin', 'GET', '/api/meta');
  const rows = [{ memberId: 1, effortPct: 50 }, { memberId: 2, effortPct: 90 }, { memberId: 3, effortPct: 40 }, { memberId: 4, effortPct: 50 }];
  const { status, data } = await api('admin', 'PUT', '/api/projects/1/staffing', { effectiveDate: meta.firstOpenDate, rows });
  assert.equal(status, 422);
  assert.match(data.error, /Trần Lan.*Vượt 20%/);
});

test('Tools/AI change applies from its effective month only', async () => {
  const { data: meta } = await api('admin', 'GET', '/api/meta');
  const month = meta.firstOpenDate.slice(0, 7);
  const next = nextMonth(month);
  const zen = (t) => t.data.table.rows.find((r) => r.name === 'Dự án Test 1');
  const before = await api('admin', 'GET', `/api/team-costs?month=${month}`);
  assert.deepEqual(before.data.settings.tools.map((t) => [t.name, t.monthlyCost, t.appliesTo]), [['Tools & AI', 20_000_000, []]]);
  const tools = (cost) => [{ ...before.data.settings.tools[0], monthlyCost: cost }];
  const r = await api('admin', 'PUT', '/api/team-costs', { effectiveDate: `${next}-01`, tools: tools(40_000_000) });
  assert.equal(r.status, 200, r.data.error);
  const cur = await api('admin', 'GET', `/api/team-costs?month=${month}`);
  const nxt = await api('admin', 'GET', `/api/team-costs?month=${next}`);
  assert.equal(round(zen(cur).total), round(zen(before).total));
  // Tools/AI 40M × 2,0/3,6 = 22.222.222 → Dự án Test 1: 40.200.000 + 22.222.222
  assert.equal(round(zen(nxt).tools), 22_222_222);
  assert.equal(round(zen(nxt).total), 62_422_222);
  assert.equal(nxt.data.table.teamTotal, 120_000_000);
  await api('admin', 'PUT', '/api/team-costs', { effectiveDate: `${next}-01`, tools: tools(20_000_000) });
});

test('Tools/AI input is validated', async () => {
  const { data: meta } = await api('admin', 'GET', '/api/meta');
  const put = (tools) => api('admin', 'PUT', '/api/team-costs', { effectiveDate: meta.firstOpenDate, tools });
  assert.equal((await put([{ name: '', monthlyCost: 1 }])).status, 422);
  assert.equal((await put([{ name: 'X', monthlyCost: -1 }])).status, 422);
  assert.equal((await put([{ name: 'X', monthlyCost: 1, appliesTo: [9999] }])).status, 422);
});

test('Kịch bản A: Chi phí team per project, unallocated rows and daily figures', async () => {
  const { data } = await api('admin', 'GET', '/api/team-costs');
  const t = data.table;
  assert.deepEqual(t.rows.map((r) => r.name), ['Dự án Test 1', 'Dự án Test 2']);
  const [zen, mb] = t.rows;
  assert.deepEqual([zen.salary, zen.tools, zen.total].map((v) => round(v)), [40_200_000, 11_111_111, 51_311_111]);
  assert.equal(round(zen.teamPct, 1), 51.3);
  assert.equal(round(zen.total / t.workingDays), 2_443_386);
  assert.deepEqual([mb.salary, mb.tools, mb.total].map((v) => round(v)), [31_800_000, 8_888_889, 40_688_889]);
  assert.equal(round(mb.teamPct, 1), 40.7);
  assert.equal(round(mb.total / t.workingDays), 1_937_566);
  assert.equal(round(t.unallocatedSalary), 8_000_000);
  assert.equal(round(t.unallocatedSalaryPct, 1), 8.0);
  assert.equal(t.unallocatedTools, 0);
  assert.equal(t.teamTotal, 100_000_000);
  assert.equal(t.workingDays, 21);
  assert.equal(round(t.teamTotal / t.workingDays), 4_761_905);
  assert.equal(round(zen.teamPct + mb.teamPct + t.unallocatedSalaryPct + t.unallocatedToolsPct, 6), 100);
  assert.deepEqual(data.payroll, { total: 80_000_000, count: 4 });
  // Detail of a project: each person and each tool it gets.
  assert.equal(zen.detail.members.length, 4);
  assert.deepEqual(zen.detail.tools.map((x) => [x.name, round(x.amount)]), [['Tools & AI', 11_111_111]]);
  // No more fixed team cost, overhead allocation mode, working days or exchange rate in the settings.
  const text = JSON.stringify(data.settings);
  for (const k of ['fixedMonthlyCost', 'allocationMode', 'workingDays', 'usdVndRate']) assert.ok(!text.includes(k), k);
});

test('A6. Dự án Test 1 + Test 2: Tổng chi phí 92.000.000, Tổng doanh thu 96.200.000, Lời 4.200.000, Lương chưa phân bổ 8.000.000', async () => {
  const { data } = await api('admin', 'GET', '/api/dashboard?period=month');
  const cost = data.projects.reduce((s, p) => s + p.cost, 0);
  const revenue = data.projects.reduce((s, p) => s + p.revenue, 0);
  assert.equal(round(cost), 92_000_000);
  assert.equal(revenue, 96_200_000);
  assert.equal(round(revenue - cost), 4_200_000);
  assert.equal(round(data.team.unallocated), 8_000_000);
});

test('connection secrets are never returned', async () => {
  const save = await api('admin', 'PUT', '/api/projects/2/connections/google_play', {
    config: { packageName: 'io.abcdigital.test2', bucket: 'gs://pubsite_prod_rev_123' },
    secret: '{"private_key":"-----BEGIN PRIVATE KEY-----SECRET"}', secretName: 'play.json' });
  assert.equal(save.data.connection.status, 'connected');
  const { data } = await api('admin', 'GET', '/api/projects/2/edit');
  assert.ok(!JSON.stringify(data).includes('SECRET'));
  const hist = await api('admin', 'GET', '/api/projects/2/history');
  assert.ok(!JSON.stringify(hist.data).includes('SECRET'));
});

