// Dự án & Sản phẩm: Zell App = Zen Bell + Mindfulness Bell, ABC Game Studio = Game A + Game B (+ Game C in kịch bản C).
// Every Sản phẩm belongs to one Dự án, a Dự án has no data of its own, its shared staff is always split down (or unallocated),
// a Dự án with products cannot be deleted, Viewer scope through a Dự án.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { round } from '../shared/format.js';
import { applyAbcStudioScenario } from '../server/demo/abc-studio-scenario.js';
import { nextMonth, startTestServer } from './helpers/test-server.js';

const idsOf = async (t) => Object.fromEntries((await t.api('admin', 'GET', '/api/projects')).data.rows.map((r) => [r.name, r.id]));
const BASELINE = { list: [{ metricKey: 'revenue', weight: 100, targetMonthly: 20_000_000 }], thresholds: { green: 80, red: 50 } };

test('H1. sample tree: ABC Game Studio (2) ▸ Game A, Game B · Zell App (2) ▸ Mindfulness Bell, Zen Bell; Dự án vs Sản phẩm', async () => {
  const t = await startTestServer();
  try {
    const meta = (await t.api('admin', 'GET', '/api/meta')).data;
    const by = Object.fromEntries(meta.projects.map((p) => [p.name, p]));
    const kids = (name) => meta.projects.filter((p) => p.parentId === by[name].id).map((p) => p.name).sort();
    assert.deepEqual(kids('ABC Game Studio'), ['Game A', 'Game B']);
    assert.deepEqual(kids('Zell App'), ['Mindfulness Bell', 'Zen Bell']);
    for (const n of ['ABC Game Studio', 'Zell App']) { assert.equal(by[n].kind, 'folder', n); assert.equal(by[n].parentId, null); }
    for (const n of ['Game A', 'Game B', 'Zen Bell', 'Mindfulness Bell']) assert.equal(by[n].kind, 'project', n);
    assert.equal(by['Game B'].color, '#6B7F2A');
    const list = (await t.api('admin', 'GET', '/api/projects')).data.rows;
    const abc = list.find((r) => r.name === 'ABC Game Studio');
    assert.equal(abc.connections, null, 'Kết nối "—"');
    assert.equal(abc.phase, null, 'Giai đoạn "—"');
    assert.deepEqual(abc.platforms, ['playables', 'ios', 'android'], 'platforms = union of the children');
    assert.equal(list.find((r) => r.name === 'Game B').phaseLabel, 'Tăng trưởng');
    assert.equal(list.find((r) => r.name === 'Game A').phaseLabel, 'Xây dựng');
  } finally { t.stop(); }
});

test('A6/I1/I2. Zell App (dự án) summary: 92.000.000, 96.200.000, Lời 4.200.000, 86,9% Tốt; 2 children, no baselines, no Marketing', async () => {
  const t = await startTestServer({ scenario: 'A' });
  try {
    const dash = (await t.api('admin', 'GET', '/api/dashboard?period=month')).data;
    assert.deepEqual(dash.rows.map((p) => p.name).sort(), ['ABC Game Studio', 'Zell App']);
    const zell = dash.rows.find((p) => p.name === 'Zell App');
    assert.equal(round(zell.cost), 92_000_000);
    assert.equal(round(zell.teamPct, 1), 92.0);
    assert.equal(zell.revenue, 96_200_000);
    assert.equal(round(zell.profit), 4_200_000);
    assert.equal(zell.score, 86.9);
    assert.equal(zell.status, 'green');
    assert.deepEqual(zell.counts, { green: 1, yellow: 1 });
    // Root rows + unallocated = team cost (children are not counted twice).
    assert.equal(round(dash.rows.reduce((s, p) => s + p.cost, 0) + dash.team.unallocated), round(dash.team.cost));
    assert.ok(Math.abs(dash.costShare.reduce((s, x) => s + x.pct, 0) - 100) < 1e-6);
    const ov = (await t.api('admin', 'GET', `/api/projects/${zell.id}/overview?period=month`)).data;
    assert.equal(ov.folder, true);
    assert.equal(round(ov.project.cost), 92_000_000);
    assert.equal(ov.project.revenue, 96_200_000);
    assert.equal(ov.project.score, 86.9);
    assert.deepEqual(ov.project.baselines, []);
    assert.deepEqual(ov.children.map((c) => c.name).sort(), ['Mindfulness Bell', 'Zen Bell']);
    assert.ok(Math.abs(ov.costShare.reduce((s, x) => s + x.pct, 0) - 100) < 1e-6);
    assert.ok(ov.chart.buckets.length > 0);
    assert.equal((await t.api('admin', 'GET', `/api/projects/${zell.id}/marketing?period=month`)).status, 422);
    const zen = ov.children.find((c) => c.name === 'Zen Bell');
    const zenOv = (await t.api('admin', 'GET', `/api/projects/${zen.id}/overview?period=month`)).data;
    assert.equal(zenOv.project.parentId, zell.id);
    assert.equal(zenOv.project.baselines.length, 5);
  } finally { t.stop(); }
});

test('H2 / I4. "Thuộc dự án" is required and lists Dự án only; a Dự án with products cannot be deleted', async () => {
  const t = await startTestServer();
  try {
    const ids = await idsOf(t);
    const meta = (await t.api('admin', 'GET', '/api/meta')).data;
    const opts = (await t.api('admin', 'GET', '/api/parent-options')).data.options;
    assert.deepEqual(opts.map((o) => `${o.name} · ${o.children}`), ['ABC Game Studio · 2', 'Zell App · 2']);
    const body = (parentId) => ({ info: { name: 'Game X', color: '#C4302B', platforms: ['playables', 'ios', 'android'], parentId, phase: 'growth' },
      baselines: BASELINE, staffing: { rows: [{ memberId: 1, effortPct: 10 }], manualAllocPct: 0 }, activate: true, activationDate: meta.firstOpenDate });
    const none = await t.api('admin', 'POST', '/api/projects', body(null));
    assert.equal(none.status, 422);
    assert.equal(none.data.error, 'Hãy chọn dự án cho sản phẩm.');
    assert.equal((await t.api('admin', 'POST', '/api/projects', body(ids['Zen Bell']))).status, 422, 'a Sản phẩm cannot hold products');
    const a = await t.api('admin', 'POST', '/api/projects', body(ids['ABC Game Studio']));
    assert.equal(a.status, 201, a.data.error);
    assert.equal((await t.api('admin', 'POST', `/api/projects/${ids['Game A']}/move`, { parentId: null, effectiveDate: meta.firstOpenDate })).data.error,
      'Hãy chọn dự án cho sản phẩm.');
    assert.equal((await t.api('admin', 'POST', `/api/projects/${ids['Zell App']}/move`, { parentId: ids['ABC Game Studio'], effectiveDate: meta.firstOpenDate })).status, 422);
    const edit = (await t.api('admin', 'GET', `/api/projects/${ids['Zen Bell']}/edit`)).data;
    assert.equal((await t.api('admin', 'PUT', `/api/projects/${ids['Zen Bell']}/info`, { ...edit.project, kind: 'folder' })).status, 422);
    assert.equal((await t.api('admin', 'PUT', `/api/projects/${ids['Zell App']}/baselines`, { baselines: BASELINE.list, thresholds: BASELINE.thresholds })).status, 422);
    // I4: Zell App still has 2 products → Xóa is locked with a tooltip and refused by the API.
    const zell = (await t.api('admin', 'GET', `/api/projects/${ids['Zell App']}/edit`)).data;
    const del = zell.actions.find((x) => x.action === 'delete');
    assert.equal(del.locked, true);
    assert.equal(del.tip, 'Hãy chuyển hoặc lưu trữ các sản phẩm trước khi xóa dự án');
    const r = await t.api('admin', 'POST', `/api/projects/${ids['Zell App']}/lifecycle`, { action: 'delete', confirmName: 'Zell App' });
    assert.equal(r.status, 422);
    assert.equal(r.data.error, 'Hãy chuyển hoặc lưu trữ các sản phẩm trước khi xóa dự án.');
    // A Sản phẩm still needs archiving first.
    const zenDel = edit.actions.find((x) => x.action === 'delete');
    assert.equal(zenDel.tip, 'Hãy lưu trữ sản phẩm trước khi xóa');
    // A Dự án without products can be deleted while running.
    const empty = await t.api('admin', 'POST', '/api/projects', { info: { kind: 'folder', name: 'Dự án trống', color: '#2B59C3' }, activate: true, activationDate: meta.firstOpenDate });
    assert.equal(empty.status, 201, empty.data.error);
    const eDel = await t.api('admin', 'POST', `/api/projects/${empty.data.project.id}/lifecycle`, { action: 'delete', confirmName: 'Dự án trống' });
    assert.equal(eDel.status, 200, eDel.data.error);
  } finally { t.stop(); }
});

test('I3. "Thêm dự án" ABC Web Studio without products: shared staff 20% → warning + cost in "Chưa phân bổ"', async () => {
  const t = await startTestServer();
  try {
    const meta = (await t.api('admin', 'GET', '/api/meta')).data;
    const date = meta.firstOpenDate;
    const before = (await t.api('admin', 'GET', `/api/team-costs?month=${date.slice(0, 7)}`)).data.table;
    const m = await t.api('admin', 'POST', '/api/members', { name: 'Hà My', role: 'Web Developer', monthlyCost: 20_000_000, effectiveDate: date });
    assert.equal(m.status, 201, m.data.error);
    const my = m.data.members.find((x) => x.name === 'Hà My').id;
    const r = await t.api('admin', 'POST', '/api/projects', {
      info: { kind: 'folder', name: 'ABC Web Studio', color: '#2B59C3', icon: '🌐', description: 'Website', thresholds: { green: 80, red: 50 } },
      staffing: { rows: [{ memberId: my, effortPct: 20 }] }, parentSplit: { method: 'even' }, activate: true, activationDate: date });
    assert.equal(r.status, 201, r.data.error);
    assert.equal(r.data.project.kind, 'folder');
    const st = (await t.api('admin', 'GET', `/api/projects/${r.data.project.id}/staffing?date=${date}`)).data;
    assert.equal(st.parentCost.noRunningChild, 'Dự án chưa có sản phẩm để chia chi phí');
    assert.equal(round(st.parentCost.unallocated), 4_000_000);
    const after = (await t.api('admin', 'GET', `/api/team-costs?month=${date.slice(0, 7)}`)).data.table;
    assert.equal(round(after.unallocatedShared), 4_000_000);
    assert.equal(round(after.unallocated - before.unallocated), 20_000_000, 'all of Hà My is unallocated (80% free + 20% shared)');
    assert.ok(!after.rows.some((x) => x.name === 'ABC Web Studio'));
    const ov = (await t.api('admin', 'GET', `/api/projects/${r.data.project.id}/overview?period=month`)).data;
    assert.equal(ov.noRunningChild, true);
    assert.equal(ov.project.score, null);
    assert.equal(ov.project.cost, 0);
    const opts = (await t.api('admin', 'GET', '/api/parent-options')).data.options.map((o) => o.name);
    assert.deepEqual(opts, ['ABC Game Studio', 'ABC Web Studio', 'Zell App']);
  } finally { t.stop(); }
});

test('I5. Viewer thanh.chau@abcdigital.io (scope: dự án Zell App) sees the Zell App summary with Zen Bell + Mindfulness Bell only', async () => {
  const t = await startTestServer();
  try {
    const cookie = await t.login('thanh.chau@abcdigital.io');
    assert.equal(typeof cookie, 'string');
    const meta = (await t.apiAs(cookie, 'GET', '/api/meta')).data;
    assert.deepEqual(meta.projects.map((p) => p.name).sort(), ['Mindfulness Bell', 'Zell App', 'Zen Bell']);
    const zell = meta.projects.find((p) => p.name === 'Zell App');
    const ov = (await t.apiAs(cookie, 'GET', `/api/projects/${zell.id}/overview?period=month`)).data;
    assert.deepEqual(ov.children.map((c) => c.name).sort(), ['Mindfulness Bell', 'Zen Bell']);
    assert.ok(ov.sharedStaff.every((m) => m.monthlyCost === undefined));
    const abc = (await t.api('admin', 'GET', '/api/meta')).data.projects.find((p) => p.name === 'ABC Game Studio');
    assert.equal((await t.apiAs(cookie, 'GET', `/api/projects/${abc.id}/overview?period=month`)).status, 403);
  } finally { t.stop(); }
});

test('moving Mindfulness Bell to ABC Game Studio next month keeps this month with Zell App', async () => {
  const t = await startTestServer();
  try {
    const ids = await idsOf(t);
    const meta = (await t.api('admin', 'GET', '/api/meta')).data;
    const next = `${nextMonth(meta.firstOpenDate.slice(0, 7))}-01`;
    const r = await t.api('admin', 'POST', `/api/projects/${ids['Mindfulness Bell']}/move`, { parentId: ids['ABC Game Studio'], effectiveDate: next, reason: 'Gộp vào ABC' });
    assert.equal(r.status, 200, r.data.error);
    const dash = (await t.api('admin', 'GET', '/api/dashboard?period=month')).data;
    assert.equal(round(dash.rows.find((p) => p.name === 'Zell App').cost), 92_000_000);
    const later = (await t.api('admin', 'GET', `/api/projects/${ids['Zell App']}/staffing?date=${next}`)).data;
    assert.deepEqual(later.parentCost.children.map((c) => c.name), ['Zen Bell']);
    const hist = (await t.api('admin', 'GET', `/api/projects/${ids['Zell App']}/history`)).data.history;
    assert.ok(hist.some((h) => h.action === 'Thuộc dự án' && h.field === 'Sản phẩm Mindfulness Bell' && h.newValue === 'ABC Game Studio'));
  } finally { t.stop(); }
});

let t;
let s;
let month;
let next;
before(async () => {
  t = await startTestServer();
  month = (await t.api('admin', 'GET', '/api/meta')).data.firstOpenDate.slice(0, 7);
  next = nextMonth(month);
  s = await applyAbcStudioScenario((m, u, b) => t.api('admin', m, u, b), `${month}-01`);
});
after(() => t?.stop());

const personnel = async (ym) => {
  const rows = (await t.api('admin', 'GET', `/api/team-costs?month=${ym}`)).data.table.rows;
  return Object.fromEntries(rows.map((r) => [r.name, round(r.direct)]));
};

test('C. ABC Game Studio: Nam (nhân sự chung) split evenly over Game A/B/C, Vy direct → A 17M · B 13,4M · C 8M', async () => {
  const p = await personnel(month);
  assert.equal(p['Game A'], 17_000_000);
  assert.equal(p['Game B'], 13_400_000);
  assert.equal(p['Game C'], 8_000_000);
  assert.ok(!('ABC Game Studio' in p));
  const st = (await t.api('admin', 'GET', `/api/projects/${s.parentId}/staffing?date=${month}-01`)).data;
  assert.equal(round(st.parentCost.sharedCost), 24_000_000);
  assert.equal(round(st.parentCost.children.reduce((sum, c) => sum + c.parentShared, 0)), 24_000_000);
  assert.equal(st.parentCost.unallocated, 0);
  const ov = (await t.api('admin', 'GET', `/api/projects/${s.parentId}/overview?period=month`)).data;
  assert.deepEqual(ov.sharedStaff.map((m) => [m.name, m.effortPct, m.monthlyCost]), [['Võ Nam', 100, 24_000_000]]);
});

test('"Theo FTE trực tiếp" → A 15M, B 9M, C 0 with a warning', async () => {
  const prev = await t.api('admin', 'POST', `/api/projects/${s.parentId}/staffing/preview`, {
    effectiveDate: `${month}-01`, rows: [{ memberId: s.nam, effortPct: 100 }], manualAllocPct: 0, parentSplit: { method: 'fte' } });
  const share = Object.fromEntries(prev.data.parentCost.children.map((c) => [c.name, round(c.parentShared)]));
  assert.deepEqual(share, { 'Game A': 15_000_000, 'Game B': 9_000_000, 'Game C': 0 });
  assert.ok(prev.data.parentCost.warnings.some((w) => w.message === 'Game C không có nhân sự trực tiếp nên không nhận chi phí chung'));
});

test('Nam is already 100% in ABC Game Studio → adding 10% to Zen Bell is refused', async () => {
  const zen = (await t.api('admin', 'GET', `/api/projects/1/staffing?date=${month}-01`)).data;
  const rows = [...zen.rows, { memberId: s.nam, effortPct: 10 }];
  const r = await t.api('admin', 'PUT', '/api/projects/1/staffing', { effectiveDate: `${month}-01`, rows, manualAllocPct: zen.manualAllocPct });
  assert.equal(r.status, 422);
  assert.match(r.data.error, /Vượt 10% \(Nam đã dùng 100% ở ABC Game Studio\)/);
});

test('pausing Game B next month moves its share of Nam to Game A and Game C from that date only', async () => {
  const r = await t.api('admin', 'POST', `/api/projects/${s.ids['Game B']}/lifecycle`, { action: 'pause', effectiveDate: `${next}-01` });
  assert.equal(r.status, 200, r.data.error);
  const nov = (await t.api('admin', 'GET', `/api/projects/${s.parentId}/staffing?date=${next}-01`)).data;
  const share = Object.fromEntries(nov.parentCost.children.map((c) => [c.name, round(c.parentShared)]));
  assert.deepEqual(share, { 'Game A': 12_000_000, 'Game B': 0, 'Game C': 12_000_000 });
  assert.equal((await personnel(month))['Game B'], 13_400_000, 'earlier period unchanged');
});

test('C5. "Thêm sản phẩm" Game D in ABC Game Studio uses its "Mẫu cho sản phẩm mới"; Viewer scoped to the Dự án sees it too', async () => {
  const tpl = (await t.api('admin', 'GET', '/api/parent-options')).data.options.find((o) => o.id === s.parentId).template;
  assert.deepEqual(tpl.platforms, ['playables', 'ios', 'android']);
  assert.deepEqual(tpl.baselines.map((b) => b.metricKey), ['revenue', 'plays', 'downloads']);
  assert.equal((await t.api('admin', 'PUT', '/api/projects/1/child-template', tpl)).status, 422, 'only a Dự án has a template');
  const add = await t.api('admin', 'POST', '/api/users', { name: 'Hoàng Linh', email: 'linh.hoang@abcdigital.io', role: 'viewer', scope: 'selected', projectIds: [s.parentId] });
  assert.equal(add.status, 201, add.data.error);
  await fetch(`${t.base}/api/invite/accept`, { method: 'POST', body: JSON.stringify({ token: add.data.inviteLink.split('/').pop() }) });
  const cookie = await t.login('linh.hoang@abcdigital.io');
  const d = await t.api('admin', 'POST', '/api/projects', {
    info: { name: 'Game D', color: '#B45309', platforms: tpl.platforms, parentId: s.parentId, phase: 'growth' },
    baselines: { list: tpl.baselines, thresholds: tpl.thresholds }, staffing: { rows: [], manualAllocPct: 0 }, activate: true, activationDate: `${month}-01` });
  assert.equal(d.status, 201, d.data.error);
  const meta = (await t.apiAs(cookie, 'GET', '/api/meta')).data;
  assert.deepEqual(meta.projects.map((p) => p.name).sort(), ['ABC Game Studio', 'Game A', 'Game B', 'Game C', 'Game D']);
  const dash = (await t.apiAs(cookie, 'GET', '/api/dashboard?period=month')).data;
  assert.deepEqual(dash.rows.map((p) => p.name), ['ABC Game Studio']);
  assert.equal((await t.apiAs(cookie, 'GET', '/api/projects/1/overview?period=month')).status, 403);
});

test('pausing a Dự án can apply to all of its running products', async () => {
  const pv = await t.api('admin', 'POST', `/api/projects/${s.parentId}/lifecycle/preview`, { action: 'pause', effectiveDate: `${next}-01`, applyToChildren: true });
  assert.equal(pv.status, 200, pv.data.error);
  assert.deepEqual(pv.data.eligible.map((p) => p.name).sort(), ['Game A', 'Game C', 'Game D']);
  const r = await t.api('admin', 'POST', `/api/projects/${s.parentId}/lifecycle`, { action: 'pause', effectiveDate: `${next}-01`, applyToChildren: true });
  assert.equal(r.data.applied, 3);
});
