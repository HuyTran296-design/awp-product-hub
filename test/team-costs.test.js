// Chi phí team: Tổng chi phí team = lương nhân sự + Chi phí Tools/AI; each tool is split over the running products in its
// "Áp dụng cho" by effective FTE (demo data K1–K2), what no running product can take is "Tools/AI chưa phân bổ" (K4),
// and the removed settings are gone from the UI (K5). Plus the migration of an older database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { round } from '../shared/format.js';
import { addVersion, BEGINNING, openDatabase, setAppSetting } from '../server/database.js';
import { applyAbcStudioScenario } from '../server/demo/abc-studio-scenario.js';
import { productRows, startTestServer } from './helpers/test-server.js';

let t;
let month;
before(async () => {
  t = await startTestServer();
  month = (await t.api('admin', 'GET', '/api/meta')).data.firstOpenDate.slice(0, 7);
});
after(() => t.stop());

const table = async () => (await t.api('admin', 'GET', `/api/team-costs?month=${month}`)).data;
const toolOf = (row, name) => round(row.detail.tools.find((x) => x.name === name)?.amount ?? 0);

test('demo data: lương 122.000.000 (6 người) + Tools/AI 28.000.000 = 150.000.000/tháng', async () => {
  const data = await table();
  assert.deepEqual(data.payroll, { total: 122_000_000, count: 6 });
  assert.deepEqual(data.settings.tools.map((x) => [x.name, x.monthlyCost]), [
    ['Claude & ChatGPT', 12_000_000], ['Google Workspace & Slack', 6_000_000],
    ['Unity & asset game', 6_000_000], ['Tài khoản App Store & Google Play', 4_000_000]]);
  assert.equal(data.table.teamTotal, 150_000_000);
  assert.equal(data.table.toolsTotal, 28_000_000);
  assert.deepEqual(data.table.tree.map((g) => g.name).sort(), ['ABC Game Studio', 'Zell App']);
  const sum = data.table.tree.reduce((s, g) => s + g.teamPct, 0) + data.table.unallocatedSalaryPct + data.table.unallocatedToolsPct;
  assert.equal(round(sum, 6), 100);
  assert.equal(round(data.table.tree.reduce((s, g) => s + g.total, 0) + data.table.unallocatedSalary + data.table.unallocatedTools), 150_000_000);
});

test('K1. "Unity & asset game" → Game A 3.333.333 (FTE 1,0) · Game B 2.666.667 (FTE 0,8); Zell App products get none', async () => {
  const rows = Object.fromEntries(productRows((await table()).table).map((r) => [r.name, r]));
  assert.equal(round(rows['Game A'].fte, 1), 1.0);
  assert.equal(round(rows['Game B'].fte, 1), 0.8);
  assert.equal(toolOf(rows['Game A'], 'Unity & asset game'), 3_333_333);
  assert.equal(toolOf(rows['Game B'], 'Unity & asset game'), 2_666_667);
  assert.equal(toolOf(rows['Zen Bell'], 'Unity & asset game'), 0);
  assert.equal(toolOf(rows['Mindfulness Bell'], 'Unity & asset game'), 0);
  // Detail of Game A: Đỗ Vy direct, Võ Nam split from the shared staff of ABC Game Studio.
  assert.deepEqual(rows['Game A'].detail.members.map((m) => [m.name, m.kind, round(m.effortPct), round(m.monthly)]),
    [['Đỗ Vy', 'direct', 50, 9_000_000], ['Võ Nam', 'shared', 50, 12_000_000]]);
});

test('K2. "Tài khoản App Store & Google Play" → Zen Bell 2.222.222 · Mindfulness Bell 1.777.778', async () => {
  const rows = Object.fromEntries(productRows((await table()).table).map((r) => [r.name, r]));
  assert.equal(toolOf(rows['Zen Bell'], 'Tài khoản App Store & Google Play'), 2_222_222);
  assert.equal(toolOf(rows['Mindfulness Bell'], 'Tài khoản App Store & Google Play'), 1_777_778);
  assert.equal(toolOf(rows['Game A'], 'Tài khoản App Store & Google Play'), 0);
  const zell = (await table()).table.tree.find((g) => g.name === 'Zell App');
  assert.equal(round(zell.total), round(zell.children.reduce((s, c) => s + c.total, 0)), 'Dự án row = Σ its products');
});

test('K4. "Figma" 2.000.000 for Game C, paused (kịch bản C) → "Tools/AI chưa phân bổ 2.000.000"', async () => {
  const s = await applyAbcStudioScenario((m, u, b) => t.api('admin', m, u, b), `${month}-01`);
  const p = await t.api('admin', 'POST', `/api/projects/${s.ids['Game C']}/lifecycle`, { action: 'pause', effectiveDate: `${month}-01` });
  assert.equal(p.status, 200, p.data.error);
  const before = await table();
  assert.equal(before.table.unallocatedTools, 0);
  const tools = [...before.settings.tools, { name: 'Figma', monthlyCost: 2_000_000, appliesTo: [s.ids['Game C']] }];
  const r = await t.api('admin', 'PUT', '/api/team-costs', { effectiveDate: `${month}-01`, tools });
  assert.equal(r.status, 200, r.data.error);
  assert.equal(round(r.data.table.unallocatedTools), 2_000_000);
  assert.equal(round(r.data.table.unallocatedToolsPct, 1), round(2_000_000 / r.data.table.teamTotal * 100, 1));
  assert.equal(r.data.table.teamTotal, 152_000_000);
  const hist = (await t.api('admin', 'GET', '/api/team-history')).data.history;
  assert.ok(hist.some((h) => h.action === 'Chi phí Tools/AI' && h.field === 'Thêm Figma' && /Game C/.test(h.newValue)));
});

test('K5. the Chi phí team page no longer has the removed settings', () => {
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

test('an older database: the fixed team cost becomes one tool "Tools & AI" (fixed − payroll); the default stop-loss is dropped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awp-team-'));
  const file = path.join(dir, 'old.db');
  try {
    let db = openDatabase(file);
    const v = (entity, entityId, data, effectiveDate = BEGINNING) => addVersion(db, { entity, entityId, effectiveDate, data, actor: 'x' });
    v('team', 0, { fixedMonthlyCost: 100_000_000, workingDays: 21, allocationMode: 'fte', usdVndRate: 26_000 });
    v('team', 0, { fixedMonthlyCost: 70_000_000, workingDays: 21, allocationMode: 'fte', usdVndRate: 26_000 }, '2026-05-01');
    const id = Number(db.prepare("INSERT INTO members (name, role) VALUES ('A', 'Dev')").run().lastInsertRowid);
    v('member_cost', id, { monthlyCost: 80_000_000 });
    setAppSetting(db, 'stoploss_default', { enabled: true });
    db.close();
    db = openDatabase(file);
    const tools = db.prepare("SELECT data FROM config_versions WHERE entity = 'team' ORDER BY seq").all().map((r) => JSON.parse(r.data).tools);
    assert.deepEqual(tools, [[{ id: 't1', name: 'Tools & AI', monthlyCost: 20_000_000, appliesTo: [] }], []]);
    assert.equal(db.prepare("SELECT 1 FROM app_settings WHERE key = 'stoploss_default'").get(), undefined);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
