// Chi phí team (demo data, 10/2026): Tổng chi phí team = lương nhân sự + Chi phí Tools/AI of the month; each tool is split
// over the running projects in its "Áp dụng cho" by FTE (K1–K2), monthly and daily (K3); the removed settings are gone (K5).
process.env.AWP_TODAY = '2026-10-23';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { round } from '../shared/format.js';
import { fullMonth, startTestServer } from './helpers/test-server.js';

let t;
let month;
before(async () => {
  t = await startTestServer();
  month = (await t.api('admin', 'GET', '/api/meta')).data.firstOpenDate.slice(0, 7);
});
after(() => t.stop());

const table = async () => fullMonth((await t.api('admin', 'GET', `/api/team-costs?month=${month}`)).data);
const toolOf = (row, name) => round(row.detail.tools.find((x) => x.name === name)?.amount ?? 0);
const rowsByName = (data) => Object.fromEntries(data.table.rows.map((r) => [r.name, r]));

test('demo data 10/2026: lương 42.000.000 (2 người) + Tools/AI 30.200.000 = 72.200.000', async () => {
  const data = await table();
  assert.equal(month, '2026-10');
  assert.deepEqual(data.payroll, { total: 42_000_000, count: 2 });
  assert.deepEqual(data.table.rows.map((r) => r.name), ['Game A', 'Game B']);
  assert.equal(data.table.toolsTotal, 30_200_000);
  const sum = data.table.rows.reduce((s, r) => s + r.teamPct, 0) + data.table.unallocatedSalaryPct + data.table.unallocatedToolsPct;
  assert.equal(round(sum, 6), 100);
});

test('K1. "Unity & asset game" 6.000.000 → Game A 3.333.333 (FTE 1,0) · Game B 2.666.667 (FTE 0,8)', async () => {
  const rows = rowsByName(await table());
  assert.equal(round(rows['Game A'].fte, 1), 1.0);
  assert.equal(round(rows['Game B'].fte, 1), 0.8);
  assert.equal(toolOf(rows['Game A'], 'Unity & asset game'), 3_333_333);
  assert.equal(toolOf(rows['Game B'], 'Unity & asset game'), 2_666_667);
  assert.deepEqual(rows['Game A'].detail.members.map((m) => [m.name, round(m.effortPct), round(m.monthly)]),
    [['Võ Nam', 50, 12_000_000], ['Đỗ Vy', 50, 9_000_000]]);
});

test('K2. "Tài khoản App Store & Google Play" 4.000.000 → Game A 2.222.222 · Game B 1.777.778', async () => {
  const rows = rowsByName(await table());
  assert.equal(toolOf(rows['Game A'], 'Tài khoản App Store & Google Play'), 2_222_222);
  assert.equal(toolOf(rows['Game B'], 'Tài khoản App Store & Google Play'), 1_777_778);
});

test('K3. Theo tháng: Tổng chi phí team 72.200.000, Lương chưa phân bổ = Vy 20% = 3.600.000; Theo ngày: 3.438.095', async () => {
  const { table: tb } = await table();
  assert.equal(tb.teamTotal, 72_200_000);
  assert.equal(round(tb.unallocatedSalary), 3_600_000);
  assert.equal(tb.unallocatedTools, 0);
  assert.equal(tb.workingDays, 21);
  assert.equal(round(tb.teamTotal / tb.workingDays), 3_438_095);
});

test('"Áp dụng cho" lists every project; a tool for a paused project goes to "Tools/AI chưa phân bổ"', async () => {
  const data = await table();
  assert.deepEqual(data.scopeOptions.map((p) => p.name), ['Game A', 'Game B']);
  const gameA = data.scopeOptions.find((p) => p.name === 'Game A').id;
  const p = await t.api('admin', 'POST', `/api/projects/${gameA}/lifecycle`, { action: 'pause', effectiveDate: `${month}-01` });
  assert.equal(p.status, 200, p.data.error);
  const tools = [...data.settings.tools, { name: 'Notion', kind: 'monthly', amount: 2_000_000, appliesTo: [gameA] }];
  const r = await t.api('admin', 'PUT', '/api/team-costs', { tools, month });
  assert.equal(r.status, 200, r.data.error);
  assert.equal(round(fullMonth(r.data).table.unallocatedTools), 2_000_000, 'only Notion: the other tools go to Game B');
  const hist = (await t.api('admin', 'GET', '/api/team-history')).data.history;
  assert.ok(hist.some((h) => h.action === 'Chi phí Tools/AI' && h.field === 'Thêm Notion' && h.newValue.includes('Game A')));
});

test('K5. the Chi phí team page has no fixed team cost, overhead allocation, working days, exchange rate or default stop-loss', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const banned = /Chi phí cố định|Quỹ chi phí chung|Chi phí chung phân bổ|Cách phân bổ chi phí chung|Số ngày làm việc\/tháng|Tỷ giá USD|Chính sách cắt lỗ mặc định|% chi phí chung|vượt chi phí cố định/i;
  const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.(js|html)$/.test(e.name) ? [p] : [];
  });
  const hits = [];
  for (const f of ['public', 'server', 'shared'].flatMap((d) => files(path.join(root, d)))) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      const code = line.trim().startsWith('//') || line.trim().startsWith('*') ? '' : line.replace(/\s\/\/\s.*$/, '');
      if (banned.test(code)) hits.push(`${path.relative(root, f)}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(hits, []);
});
