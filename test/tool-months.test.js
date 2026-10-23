// Chi phí Tools/AI theo tháng (demo data, today 23/10/2026): kinds Hằng tháng / Theo mức dùng / Hằng năm / Một lần,
// USD tools, actual vs planned per month, "Đổi giá từ tháng…", data fixes of past months and the missing-actual reminder.
process.env.AWP_TODAY = '2026-10-23';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { round } from '../shared/format.js';
import { periodCosts } from '../shared/cost-timeline.js';
import { loadTimeline } from '../server/database.js';
import { fullMonth, startTestServer } from './helpers/test-server.js';

let t;
let ids;
before(async () => {
  t = await startTestServer();
  const data = await costs();
  ids = Object.fromEntries([...data.settings.tools.map((x) => [x.name, x.id]), ...data.scopeOptions.map((p) => [p.name, p.id])]);
});
after(() => t.stop());

const costs = async (month) => fullMonth((await t.api('admin', 'GET', `/api/team-costs${month ? `?month=${month}` : ''}`)).data);
const cell = (data, tool, month) => data.monthly.rows.find((r) => r.name === tool).cells.find((c) => c.month === month);
const row = (data, project) => data.table.rows.find((r) => r.name === project);
const toolOf = (r, name) => round(r.detail.tools.find((x) => x.name === name)?.amount ?? 0);

test('demo Tools/AI list: kinds, currencies, months and scope', async () => {
  const data = await costs();
  const names = Object.fromEntries(data.scopeOptions.map((p) => [p.id, p.name]));
  assert.deepEqual(data.settings.tools.map((x) => [x.name, x.kind, x.amount, x.currency, x.startMonth, x.appliesTo.map((id) => names[id])]), [
    ['Claude & ChatGPT', 'usage', 12_000_000, 'VND', null, []],
    ['Google Workspace & Slack', 'monthly', 6_000_000, 'VND', null, []],
    ['Unity & asset game', 'annual', 72_000_000, 'VND', '2026-01', ['Game A', 'Game B']],
    ['Tài khoản App Store & Google Play', 'monthly', 4_000_000, 'VND', null, []],
    ['Figma', 'monthly', 45, 'USD', '2026-11', []],
    ['Bộ asset nhân vật', 'one_time', 18_000_000, 'VND', '2026-11', ['Game A']],
  ]);
  assert.equal(data.settings.tools.find((x) => x.name === 'Bộ asset nhân vật').spreadMonths, 6);
  assert.deepEqual(data.monthly.months, ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepEqual(data.monthly.missing, []);
});

test('L1. 10/2026: Tools/AI 14.200.000 (thực tế) + 6.000.000 + 6.000.000 + 4.000.000 = 30.200.000; team 72.200.000', async () => {
  const data = await costs('2026-10');
  const c = cell(data, 'Claude & ChatGPT', '2026-10');
  assert.equal(c.actual, 14_200_000);
  assert.equal(c.value, 14_200_000);
  for (const name of ['Google Workspace & Slack', 'Unity & asset game', 'Tài khoản App Store & Google Play']) assert.equal(cell(data, name, '2026-10').actual, null, name);
  assert.equal(data.monthly.totals.find((x) => x.month === '2026-10').value, 30_200_000);
  assert.equal(data.table.toolsTotal, 30_200_000);
  assert.equal(data.table.payrollTotal, 42_000_000);
  assert.equal(data.table.teamTotal, 72_200_000);
  assert.equal(data.table.toolsIncludePlanned, true, 'Google, Unity, App Store are still planned');
});

test('L2. Claude & ChatGPT 10/2026 14.200.000 by FTE → Game A 7.888.889 · Game B 6.311.111', async () => {
  const data = await costs('2026-10');
  assert.equal(toolOf(row(data, 'Game A'), 'Claude & ChatGPT'), 7_888_889);
  assert.equal(toolOf(row(data, 'Game B'), 'Claude & ChatGPT'), 6_311_111);
});

test('L3. Unity Hằng năm 72.000.000 → 6.000.000/tháng (dự kiến) → Game A 3.333.333 · Game B 2.666.667', async () => {
  const data = await costs('2026-10');
  const c = cell(data, 'Unity & asset game', '2026-10');
  assert.equal(c.planned, 6_000_000);
  assert.equal(c.actual, null);
  assert.equal(cell(data, 'Unity & asset game', '2026-04').value, 6_000_000);
  assert.equal(toolOf(row(data, 'Game A'), 'Unity & asset game'), 3_333_333);
  assert.equal(toolOf(row(data, 'Game B'), 'Unity & asset game'), 2_666_667);
});

test('L4. Figma 45 USD → 1.170.000 ₫ from 11/2026; earlier months empty', async () => {
  const data = await costs();
  assert.equal(cell(data, 'Figma', '2026-11').value, 1_170_000);
  for (const m of ['2026-09', '2026-10']) assert.deepEqual([cell(data, 'Figma', m).active, cell(data, 'Figma', m).value], [false, 0]);
});

test('L5. Bộ asset nhân vật 18.000.000 / 6 tháng → 3.000.000 from 11/2026 to 04/2027, Game A only', async () => {
  for (const m of ['2026-11', '2027-01', '2027-04']) {
    const data = await costs(m);
    assert.equal(toolOf(row(data, 'Game A'), 'Bộ asset nhân vật'), 3_000_000, m);
    assert.equal(toolOf(row(data, 'Game B'), 'Bộ asset nhân vật'), 0, m);
  }
  for (const m of ['2026-10', '2027-05']) assert.equal(toolOf(row(await costs(m), 'Game A'), 'Bộ asset nhân vật'), 0, m);
});

test('L6. period 17/09–16/10/2026: Claude & ChatGPT = (10.500.000 × 14 + 14.200.000 × 16) ÷ 30 = 12.473.333', () => {
  const per = periodCosts(loadTimeline(t.app.db), '2026-09-17', '2026-10-16');
  const claude = Object.values(per.projects).reduce((s, p) => s + (p.detail.tools[ids['Claude & ChatGPT']]?.amount ?? 0), 0);
  assert.equal(round(claude), 12_473_333);
  // A constant month keeps the monthly figure: 01–30/09 = 42.000.000 + 26.500.000.
  assert.equal(round(periodCosts(loadTimeline(t.app.db), '2026-09-01', '2026-09-30').teamTotal), 68_500_000);
});

test('L7. actual Claude 09/2026 10.500.000 → 11.000.000: cost and P&L of 09/2026 recomputed, history "cũ → mới"', async () => {
  const before = await costs('2026-09');
  const pl = async () => (await t.app.stopLoss.monthlySeries(ids['Game B'], '2026-09-01', loadTimeline(t.app.db))).find((x) => x.month === '2026-09');
  const plBefore = await pl();
  const r = await t.api('admin', 'PUT', '/api/team-costs/actuals', { toolId: ids['Claude & ChatGPT'], month: '2026-09', amount: 11_000_000, viewMonth: '2026-09' });
  assert.equal(r.status, 200, r.data.error);
  assert.equal(cell(r.data, 'Claude & ChatGPT', '2026-09').actual, 11_000_000);
  assert.equal(round(row(r.data, 'Game A').total - row(before, 'Game A').total), 277_778);
  assert.equal(round(row(r.data, 'Game B').total - row(before, 'Game B').total), 222_222);
  const plAfter = await pl();
  assert.equal(round(plBefore.profit - plAfter.profit), 222_222, 'lời/lỗ 09/2026 of Game B');
  const h = r.data.history.find((x) => x.field === 'Số thực tế Claude & ChatGPT tháng 9/2026');
  assert.ok(h, 'logged');
  assert.deepEqual([h.oldValue, h.newValue], ['10.500.000 ₫', '11.000.000 ₫']);
});

test('L8. "Đổi giá từ tháng 12/2026" Google Workspace & Slack → 6.600.000: 11/2026 keeps 6.000.000', async () => {
  const r = await t.api('admin', 'POST', `/api/team-costs/tools/${ids['Google Workspace & Slack']}/prices`, { fromMonth: '2026-12', amount: 6_600_000 });
  assert.equal(r.status, 200, r.data.error);
  const share = async (m) => (await costs(m)).table.rows.reduce((s, x) => s + toolOf(x, 'Google Workspace & Slack'), 0);
  assert.equal(await share('2026-11'), 6_000_000);
  assert.equal(await share('2026-12'), 6_600_000);
  assert.equal(await share('2027-03'), 6_600_000);
  assert.deepEqual(r.data.settings.tools.find((x) => x.name === 'Google Workspace & Slack').prices, [{ fromMonth: '2026-12', amount: 6_600_000 }]);
  assert.ok(r.data.history.some((h) => h.field === 'Đổi giá Google Workspace & Slack' && h.newValue === '6.600.000 ₫/tháng'));
  // Not in a closed month, not for Hằng năm.
  assert.equal((await t.api('admin', 'POST', `/api/team-costs/tools/${ids['Google Workspace & Slack']}/prices`, { fromMonth: '2026-09', amount: 1 })).status, 422);
  assert.equal((await t.api('admin', 'POST', `/api/team-costs/tools/${ids['Unity & asset game']}/prices`, { fromMonth: '2026-12', amount: 1 })).status, 422);
});

test('L9. on 04/11/2026 without the 10/2026 actual: "Ước tính" + reminder; back to none once entered', async () => {
  process.env.AWP_TODAY = '2026-11-04';
  try {
    assert.deepEqual((await costs()).monthly.missing, []);
    const clear = await t.api('admin', 'PUT', '/api/team-costs/actuals', { toolId: ids['Claude & ChatGPT'], month: '2026-10', amount: null });
    assert.equal(clear.status, 200, clear.data.error);
    const c = cell(clear.data, 'Claude & ChatGPT', '2026-10');
    assert.deepEqual([c.actual, c.value, c.missing], [null, 12_000_000, true]);
    assert.deepEqual(clear.data.monthly.missing.map((x) => [x.name, x.month]), [['Claude & ChatGPT', '2026-10']]);
    assert.equal(cell(clear.data, 'Google Workspace & Slack', '2026-10').missing, false, 'only Theo mức dùng');
    process.env.AWP_TODAY = '2026-11-03';
    assert.deepEqual((await costs()).monthly.missing, [], 'not yet due on day 3');
    process.env.AWP_TODAY = '2026-11-04';
    await t.api('admin', 'PUT', '/api/team-costs/actuals', { toolId: ids['Claude & ChatGPT'], month: '2026-10', amount: 14_200_000 });
    assert.deepEqual((await costs()).monthly.missing, []);
  } finally {
    process.env.AWP_TODAY = '2026-10-23';
  }
});

test('a tool with cost in a closed month cannot be removed; "Đến tháng" stops it and keeps the old months', async () => {
  const data = await costs();
  const without = data.settings.tools.filter((x) => x.name !== 'Tài khoản App Store & Google Play');
  const r = await t.api('admin', 'PUT', '/api/team-costs', { tools: without });
  assert.equal(r.status, 422);
  assert.match(r.data.error, /Đến tháng/);
  const stopped = data.settings.tools.map((x) => (x.name === 'Tài khoản App Store & Google Play' ? { ...x, endMonth: '2026-11' } : x));
  const s = await t.api('admin', 'PUT', '/api/team-costs', { tools: stopped });
  assert.equal(s.status, 200, s.data.error);
  const total = async (m) => (await costs(m)).table.rows.reduce((sum, x) => sum + toolOf(x, 'Tài khoản App Store & Google Play'), 0);
  assert.equal(await total('2026-09'), 4_000_000);
  assert.equal(await total('2026-11'), 4_000_000);
  assert.equal(await total('2026-12'), 0);
  // A new tool starting in an open month can still be removed.
  assert.equal(s.data.settings.tools.find((x) => x.name === 'Figma').canDelete, true);
  assert.equal(s.data.settings.tools.find((x) => x.name === 'Claude & ChatGPT').canDelete, false);
});

test('Tools/AI input is validated', async () => {
  const put = (tool) => t.api('admin', 'PUT', '/api/team-costs', { tools: [...(t.lastTools ?? []), tool] });
  t.lastTools = (await costs()).settings.tools;
  assert.equal((await put({ name: '', kind: 'monthly', amount: 1 })).status, 422);
  assert.equal((await put({ name: 'X', kind: 'monthly', amount: -1 })).status, 422);
  assert.equal((await put({ name: 'X', kind: 'weekly', amount: 1 })).status, 422);
  assert.equal((await put({ name: 'X', kind: 'monthly', amount: 1, currency: 'EUR' })).status, 422);
  assert.equal((await put({ name: 'X', kind: 'annual', amount: 1 })).status, 422, 'Hằng năm needs a start month');
  assert.equal((await put({ name: 'X', kind: 'one_time', amount: 1, startMonth: '2026-11', spreadMonths: 0 })).status, 422);
  assert.equal((await put({ name: 'X', kind: 'monthly', amount: 1, startMonth: '2026-11', endMonth: '2026-10' })).status, 422);
  assert.equal((await put({ name: 'X', kind: 'monthly', amount: 1, appliesTo: [9999] })).status, 422);
  const a = (body) => t.api('admin', 'PUT', '/api/team-costs/actuals', body);
  assert.equal((await a({ toolId: ids.Figma, month: '2026-10', amount: 40 })).status, 422, 'Figma is not used in 10/2026');
  assert.equal((await a({ toolId: ids['Claude & ChatGPT'], month: '2026-10', amount: -5 })).status, 422);
  assert.equal((await t.api('viewer', 'PUT', '/api/team-costs/actuals', { toolId: ids.Figma, month: '2026-11', amount: 40 })).status, 403);
});
