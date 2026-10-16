// Acceptance: effective-dated staffing, pause/archive/delete lifecycle, change history.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { round } from '../shared/format.js';
import { nextMonth, startTestServer } from './helpers/test-server.js';

let api;
let stop;
let month; // current (open) month, e.g. 2026-10
let next; // e.g. 2026-11
const SAMPLE_ROWS = [{ memberId: 1, effortPct: 50 }, { memberId: 2, effortPct: 60 }, { memberId: 3, effortPct: 40 }, { memberId: 4, effortPct: 50 }];

before(async () => {
  ({ api, stop } = await startTestServer({ scenario: 'A' }));
  const { data } = await api('admin', 'GET', '/api/meta');
  month = data.firstOpenDate.slice(0, 7);
  next = nextMonth(month);
});
after(() => stop());

const row = (preview, name) => preview.rows.find((r) => r.name === name);

test('1. preview: Minh 50% → 60% on Zen Bell from next month', async () => {
  const rows = SAMPLE_ROWS.map((r) => (r.memberId === 1 ? { ...r, effortPct: 60 } : r));
  const { data } = await api('admin', 'POST', '/api/projects/1/staffing/preview', { effectiveDate: `${next}-01`, rows, manualAllocPct: 50 });
  assert.deepEqual(data.errors, []);
  const zen = row(data.preview, 'Zen Bell').after;
  assert.equal(round(zen.direct), 42_700_000);
  assert.equal(round(zen.fte, 1), 2.1);
  assert.equal(round(zen.overhead), 11_351_351);
  assert.equal(round(zen.total), 54_051_351);
  assert.equal(round(zen.teamPct, 1), 54.1);
  const mb = row(data.preview, 'Mindfulness Bell').after;
  assert.equal(round(mb.overhead), 8_648_649);
  assert.equal(round(mb.total), 40_448_649);
  assert.equal(round(mb.teamPct, 1), 40.4);
  assert.equal(round(data.preview.unallocated.after.total), 5_500_000);
  assert.equal(round(data.preview.unallocated.after.teamPct, 1), 5.5);
});

test('2. preview: pause Mindfulness Bell from next month', async () => {
  const { data } = await api('admin', 'POST', '/api/projects/2/lifecycle/preview', { action: 'pause', effectiveDate: `${next}-01` });
  assert.deepEqual(data.errors, []);
  const zen = row(data.preview, 'Zen Bell').after;
  assert.equal(round(zen.overhead), 20_000_000);
  assert.equal(round(zen.total), 60_200_000);
  assert.equal(round(zen.teamPct, 1), 60.2);
  assert.equal(row(data.preview, 'Mindfulness Bell').after.total, 0);
  assert.ok(data.revenueMonthly.value > 0, 'revenue still counted → Lời');
  assert.equal(round(data.preview.unallocated.after.total), 39_800_000);
  assert.equal(round(data.preview.unallocated.after.teamPct, 1), 39.8);
});

test('1b. saving the effort change leaves the current month untouched', async () => {
  const cur0 = await api('admin', 'GET', `/api/team-costs?month=${month}`);
  const dash0 = await api('admin', 'GET', '/api/dashboard?period=month');
  const rows = SAMPLE_ROWS.map((r) => (r.memberId === 1 ? { ...r, effortPct: 60 } : r));
  const save = await api('admin', 'PUT', '/api/projects/1/staffing', { effectiveDate: `${next}-01`, rows, manualAllocPct: 50 });
  assert.equal(save.status, 200);
  assert.ok(save.data.versions.length >= 2, 'a new staffing version is listed');
  const cur = await api('admin', 'GET', `/api/team-costs?month=${month}`);
  assert.deepEqual(cur.data.table.rows.map((r) => round(r.total)), cur0.data.table.rows.map((r) => round(r.total)));
  const dash = await api('admin', 'GET', '/api/dashboard?period=month');
  assert.deepEqual(dash.data.projects.map((p) => round(p.cost)), dash0.data.projects.map((p) => round(p.cost)));
  const nxt = await api('admin', 'GET', `/api/team-costs?month=${next}`);
  assert.equal(round(nxt.data.table.rows.find((r) => r.name === 'Zen Bell').total), 54_051_351);
});

test('closed months cannot be edited', async () => {
  const { status } = await api('admin', 'PUT', '/api/projects/1/staffing', { effectiveDate: '2020-01-01', rows: SAMPLE_ROWS });
  assert.equal(status, 422);
});

test('3. delete is locked for a running product; a draft deletes immediately', async () => {
  const locked = await api('admin', 'POST', '/api/projects/1/lifecycle', { action: 'delete' });
  assert.equal(locked.status, 422);
  assert.match(locked.data.error, /Hãy lưu trữ sản phẩm trước khi xóa/);
  const list = await api('admin', 'GET', '/api/projects');
  assert.ok(list.data.rows.find((r) => r.id === 1).actions.find((a) => a.action === 'delete').locked);

  const created = await api('admin', 'POST', '/api/projects', draftBody('Nháp thử'));
  assert.equal(created.status, 201);
  const id = created.data.project.id;
  const del = await api('admin', 'POST', `/api/projects/${id}/lifecycle`, { action: 'delete' });
  assert.equal(del.status, 200);
  assert.equal((await api('admin', 'GET', `/api/projects/${id}/edit`)).status, 404);
});

test('4. permanent delete keeps earlier costs as "Sản phẩm đã xóa"', async () => {
  const created = await api('admin', 'POST', '/api/projects', { ...draftBody('Calm Timer'), activate: true,
    activationDate: `${month}-01`, staffing: { rows: [{ memberId: 4, effortPct: 10 }], manualAllocPct: 0 } });
  assert.equal(created.status, 201, created.data.error);
  const id = created.data.project.id;
  const before = await api('admin', 'GET', `/api/team-costs?month=${month}`);
  const archive = await api('admin', 'POST', `/api/projects/${id}/lifecycle`, { action: 'archive', effectiveDate: `${next}-01`, reason: 'Ngừng thử nghiệm' });
  assert.equal(archive.status, 200, archive.data.error);
  const wrong = await api('admin', 'POST', `/api/projects/${id}/lifecycle`, { action: 'delete', confirmName: 'calm' });
  assert.equal(wrong.status, 422);
  const del = await api('admin', 'POST', `/api/projects/${id}/lifecycle`, { action: 'delete', confirmName: 'Calm Timer' });
  assert.equal(del.status, 200, del.data.error);

  const after = await api('admin', 'GET', `/api/team-costs?month=${month}`);
  const totals = (t) => Object.fromEntries(t.data.table.rows.map((r) => [r.deleted ? 'deleted' : r.name, round(r.total)]));
  const b = totals(before);
  const a = totals(after);
  assert.equal(a['Zen Bell'], b['Zen Bell']);
  assert.equal(a['Mindfulness Bell'], b['Mindfulness Bell']);
  assert.equal(a.deleted, b['Calm Timer']);
  assert.ok(after.data.table.rows.some((r) => r.name === 'Sản phẩm đã xóa'));
});

test('5. every action appears in the change history', async () => {
  const pause = await api('admin', 'POST', '/api/projects/2/lifecycle', { action: 'pause', effectiveDate: `${next}-01`, reason: 'Tập trung Zen Bell' });
  assert.equal(pause.status, 200, pause.data.error);
  const zen = (await api('admin', 'GET', '/api/projects/1/history')).data.history;
  const effort = zen.find((h) => h.field === 'Effort Nguyễn Minh');
  assert.equal(effort.oldValue, '50%');
  assert.equal(effort.newValue, '60%');
  assert.equal(effort.effectiveDate, `${next}-01`);
  assert.equal(effort.actor, 'Khánh Mai');
  assert.ok(effort.at);
  const mb = (await api('admin', 'GET', '/api/projects/2/history')).data.history;
  const p = mb.find((h) => h.action === 'Tạm dừng');
  assert.equal(p.oldValue, 'Đang chạy');
  assert.equal(p.newValue, 'Tạm dừng');
  assert.equal(p.reason, 'Tập trung Zen Bell');
  const team = (await api('admin', 'GET', '/api/team-history')).data.history;
  assert.ok(team.some((h) => h.action === 'Xóa sản phẩm nháp' && h.oldValue === 'Nháp thử'));
});

test('resume checks free effort of each member', async () => {
  // Zen Bell's Minh is at 60% from next month; resuming MB with Minh at 50% would exceed 100%.
  const bad = await api('admin', 'POST', '/api/projects/2/lifecycle/preview', { action: 'resume', effectiveDate: `${next}-15`,
    rows: [{ memberId: 1, effortPct: 50 }] });
  assert.match(bad.data.errors[0], /Nguyễn Minh.*Vượt 10%/);
});

function draftBody(name) {
  return {
    info: { name, color: '#C2410C', productType: 'mobile_app', platforms: ['ios', 'android'], parentId: 5 },
    baselines: { list: [
      { metricKey: 'revenue', weight: 100, targetMonthly: 10_000_000 }, { metricKey: 'dau', weight: 80, targetMonthly: 1000 },
      { metricKey: 'downloads', weight: 50, targetMonthly: 500 }, { metricKey: 'retention_d7', weight: 60, targetMonthly: 15 },
      { metricKey: 'store_rating', weight: 40, targetMonthly: 4.5 },
    ], thresholds: { green: 80, red: 50 } },
    staffing: { rows: [], manualAllocPct: 0 },
    activate: false,
  };
}

