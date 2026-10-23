// Phân bổ chi phí with Doanh thu and Lãi/Lỗ (demo data, today 23/10/2026, data up to 22/10/2026):
// a closed month (M1), daily = monthly ÷ 21 (M2), the provisional current month (M3) and the month states.
process.env.AWP_TODAY = '2026-10-23';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { round } from '../shared/format.js';
import { startTestServer } from './helpers/test-server.js';

let t;
before(async () => { t = await startTestServer(); });
after(() => t.stop());

const table = async (month) => (await t.api('admin', 'GET', `/api/team-costs?month=${month}`)).data;
const byName = (data) => Object.fromEntries(data.table.rows.map((r) => [r.name, r]));
const r0 = (v) => round(v);

test('M1. 09/2026 (đã chốt): Lương · Tools/AI · Tổng chi phí · % · Doanh thu · Lãi/Lỗ', async () => {
  const data = await table('2026-09');
  assert.equal(data.monthState.status, 'closed');
  const { 'Game A': a, 'Game B': b } = byName(data);
  assert.deepEqual([a.salary, a.tools, a.total, a.revenue, a.profit].map(r0), [21_000_000, 14_722_222, 35_722_222, 0, -35_722_222]);
  assert.equal(round(a.teamPct, 1), 52.1);
  assert.equal(a.investing, true, 'Game A is in "Xây dựng" → "Đang đầu tư"');
  assert.deepEqual([b.salary, b.tools, b.total, b.revenue, b.profit].map(r0), [17_400_000, 11_777_778, 29_177_778, 2_900_000, -26_277_778]);
  assert.equal(round(b.teamPct, 1), 42.6);
  assert.equal(b.investing, false);
  const tb = data.table;
  assert.equal(r0(tb.unallocatedSalary), 3_600_000);
  assert.equal(round(tb.unallocatedSalaryPct, 1), 5.3);
  assert.deepEqual([tb.payrollTotal, tb.toolsTotal, tb.teamTotal, tb.revenueTotal, tb.profitTotal].map(r0), [42_000_000, 26_500_000, 68_500_000, 2_900_000, -65_600_000]);
  // The Lãi/Lỗ column adds up to the team result (the unallocated rows count as −amount).
  assert.equal(r0(a.profit + b.profit - tb.unallocatedSalary - tb.unallocatedTools), -65_600_000);
});

test('M2. 09/2026 Theo ngày (÷ 21): Game B Doanh thu 138.095 · Lãi/Lỗ −1.251.323; team −3.123.810', async () => {
  const data = await table('2026-09');
  const d = data.table.workingDays;
  const b = byName(data)['Game B'];
  assert.equal(d, 21);
  assert.deepEqual([r0(b.revenue / d), r0(b.profit / d), r0(data.table.profitTotal / d)], [138_095, -1_251_323, -3_123_810]);
});

test('M3. 10/2026 with data up to 22/10/2026: "Tạm tính đến 22/10/2026", chi phí × 16/21 = 55.009.524', async () => {
  const data = await table('2026-10');
  assert.deepEqual([data.monthState.status, data.monthState.through, data.monthState.workingDaysElapsed], ['provisional', '2026-10-22', 16]);
  assert.equal(r0(data.table.teamTotal), 55_009_524);
  assert.equal(r0(data.table.teamTotal * 21 / 16), 72_200_000);
  const { 'Game A': a, 'Game B': b } = byName(data);
  assert.equal(r0(a.total + b.total + data.table.unallocatedSalary + data.table.unallocatedTools), 55_009_524);
  assert.ok(b.revenue > 0 && b.revenue < 3_200_000, 'revenue up to 22/10 only');
  assert.equal(r0(data.table.profitTotal), r0(b.revenue - 55_009_524));
});

test('month states: future months have no revenue; a past month waits for its close and for "Theo mức dùng" actuals', async () => {
  const next = await table('2026-11');
  assert.equal(next.monthState.status, 'future');
  assert.equal(next.table.revenueTotal, null);
  assert.ok(next.table.rows.every((r) => r.revenue == null && r.profit == null));
  process.env.AWP_TODAY = '2026-11-02';
  try {
    assert.equal((await table('2026-10')).monthState.status, 'open', 'before day 3 of the next month');
  } finally { process.env.AWP_TODAY = '2026-10-23'; }
  // Without the Claude actual of 09/2026 the month is not closed.
  const tools = (await table('2026-09')).settings.tools;
  const claude = tools.find((x) => x.name === 'Claude & ChatGPT').id;
  await t.api('admin', 'PUT', '/api/team-costs/actuals', { toolId: claude, month: '2026-09', amount: null });
  assert.equal((await table('2026-09')).monthState.status, 'open');
  await t.api('admin', 'PUT', '/api/team-costs/actuals', { toolId: claude, month: '2026-09', amount: 10_500_000 });
  assert.equal((await table('2026-09')).monthState.status, 'closed');
});
