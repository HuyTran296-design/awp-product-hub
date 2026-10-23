// Stop-loss acceptance through the API on simulated date 04/11/2026 (10/2026 closed on 03/11/2026).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { round } from '../shared/format.js';

process.env.AWP_TODAY = '2026-11-04';
let api;
let stop;
before(async () => {
  const { startTestServer } = await import('./helpers/test-server.js');
  ({ api, stop } = await startTestServer({ scenario: 'A' }));
});
after(() => stop());

test('D. Dự án Test 2: closed months 05–10/2026 give the expected P&L', async () => {
  const { data } = await api('viewer', 'GET', '/api/projects/2/stoploss');
  assert.equal(data.evaluatedThrough, '2026-10');
  assert.deepEqual(data.months.map((m) => [m.month, round(m.profit)]), [
    ['2026-05', -9_000_000], ['2026-06', -8_000_000], ['2026-07', -7_500_000],
    ['2026-08', -6_900_000], ['2026-09', -7_200_000], ['2026-10', -6_888_889]]);
  assert.equal(round(data.cumLoss), 45_488_889);
  assert.equal(round(data.usedPct, 1), 75.8);
  assert.equal(round(data.avg3Loss), 6_996_296);
  assert.match(data.remaining.text, /≈ 2,1 tháng · dự kiến chạm ngưỡng khoảng đầu 01\/2027/);
  const c = Object.fromEntries(data.conditions.map((x) => [x.key, x]));
  assert.equal(c.consecutive_loss.detail, 'Lỗ liên tiếp: 6/6 tháng');
  assert.equal(c.consecutive_loss.met, true);
  assert.equal(c.low_health.met, false);
  assert.equal(data.months.at(-1).score, 71.6);
  assert.equal(c['milestone:m1'].achieving, true);
  assert.match(c['milestone:m1'].detail, /33\.800\.000 ₫ \/ chi phí 40\.688\.889 ₫ = 83,1% → đang đạt/);
  assert.equal(data.display.status, 'triggered');
  assert.equal(data.proposal.status, 'pending');
  assert.equal(data.proposal.snapshot.action.type, 'pause');
  assert.ok(!('policy' in data), 'viewer sees status only');
});

test('exactly one proposal is created; there are no notifications', async () => {
  await api('admin', 'GET', '/api/stoploss');
  const first = (await api('admin', 'GET', '/api/projects/2/stoploss')).data.proposal;
  const again = (await api('admin', 'GET', '/api/projects/2/stoploss')).data.proposal;
  assert.equal(first.status, 'pending');
  assert.equal(again.id, first.id, 'no duplicate proposal');
  assert.equal((await api('admin', 'GET', '/api/notifications')).status, 404);
  assert.equal((await api('admin', 'GET', '/api/todos')).status, 404);
  const p = await api('admin', 'GET', `/api/proposals/${first.id}`);
  assert.ok(p.data.impact.preview.rows.length > 0, 'impact preview for the pause action');
});

test('Dự án Test 1 has no stop-loss; tracking sorts triggered first', async () => {
  const { data } = await api('viewer', 'GET', '/api/stoploss');
  assert.deepEqual(data.rows.map((r) => [r.name, r.status]), [['Dự án Test 2', 'triggered'], ['Dự án Test 1', 'off']]);
});

test('decision requires a reason; viewer cannot decide', async () => {
  const pid = (await api('admin', 'GET', '/api/projects/2/stoploss')).data.proposal.id;
  assert.equal((await api('viewer', 'POST', `/api/proposals/${pid}/decision`, { decision: 'dismiss', reason: 'x' })).status, 403);
  assert.equal((await api('admin', 'POST', `/api/proposals/${pid}/decision`, { decision: 'dismiss', reason: ' ' })).status, 422);
});

test('extend to 31/01/2027 → "Đã xử lý · Gia hạn tới 31/01/2027", no new proposal before then', async () => {
  const pid = (await api('admin', 'GET', '/api/projects/2/stoploss')).data.proposal.id;
  const r = await api('admin', 'POST', `/api/proposals/${pid}/decision`, { decision: 'extend', reviewDate: '2027-01-31', reason: 'Chờ kết quả chiến dịch Q4' });
  assert.equal(r.status, 200, r.data.error);
  const s = (await api('admin', 'GET', '/api/projects/2/stoploss')).data;
  assert.equal(s.display.label, 'Đã xử lý · Gia hạn tới 31/01/2027');
  assert.equal(s.proposal.id, pid);
  await api('admin', 'GET', '/api/stoploss');
  const again = (await api('admin', 'GET', '/api/projects/2/stoploss')).data;
  assert.equal(again.proposal.id, pid, 'no new proposal while extended');
  const hist = (await api('admin', 'GET', '/api/projects/2/history')).data.history;
  assert.ok(hist.some((h) => h.action === 'Đề xuất cắt lỗ'));
  const d = hist.find((h) => h.action === 'Quyết định cắt lỗ');
  assert.equal(d.newValue, 'Gia hạn tới 31/01/2027');
  assert.equal(d.reason, 'Chờ kết quả chiến dịch Q4');
});

test('a newly satisfied condition re-creates a proposal during the extension', async () => {
  const { data } = await api('admin', 'GET', '/api/projects/2/stoploss');
  const policy = { ...data.policy, cumulativeLoss: { on: true, amount: 40_000_000 } };
  assert.equal((await api('admin', 'PUT', '/api/projects/2/stoploss', policy)).status, 200);
  const s = (await api('admin', 'GET', '/api/projects/2/stoploss')).data;
  assert.equal(s.display.status, 'triggered');
  assert.notEqual(s.proposal.id, data.proposal.id);
  assert.deepEqual(s.proposal.metKeys.sort(), ['consecutive_loss', 'cumulative_loss']);
});

test('executing "Tạm dừng" pauses the project from the chosen date; never automatic', async () => {
  const s = (await api('admin', 'GET', '/api/projects/2/stoploss')).data;
  const lifecycleBefore = (await api('admin', 'GET', '/api/projects/2/edit')).data.status.latest;
  assert.equal(lifecycleBefore, 'active', 'reaching the threshold did not stop the project');
  const r = await api('admin', 'POST', `/api/proposals/${s.proposal.id}/decision`, {
    decision: 'execute', action: { type: 'pause' }, effectiveDate: '2026-12-01', reason: 'Lỗ kéo dài' });
  assert.equal(r.status, 200, r.data.error);
  const edit = (await api('admin', 'GET', '/api/projects/2/edit')).data;
  assert.equal(edit.status.latest, 'paused');
  assert.equal(edit.status.latestDate, '2026-12-01');
  const after = (await api('admin', 'GET', '/api/projects/2/stoploss')).data;
  assert.match(after.display.label, /^Đã xử lý · Tạm dừng từ 01\/12\/2026/);
});

test('a new project copies the stop-loss of "Sao chép cấu hình từ dự án…"; without a copy stop-loss is off', async () => {
  const create = async (name, copyFromId) => (await api('admin', 'POST', '/api/projects', {
    info: { name, color: '#0E7490', platforms: ['ios'] }, ...(copyFromId ? { copyFromId } : {}),
    baselines: { list: [{ metricKey: 'revenue', weight: 100, targetMonthly: 1 }], thresholds: { green: 80, red: 50 } },
    staffing: { rows: [] }, activate: false })).data.project.id;
  const copied = (await api('admin', 'GET', `/api/projects/${await create('Theo Test 2', 2)}/stoploss`)).data;
  assert.equal(copied.policy.enabled, true);
  assert.equal(copied.policy.action.type, 'pause');
  assert.equal(copied.policy.startDate, null, 'tracking starts with the new project');
  const plain = (await api('admin', 'GET', `/api/projects/${await create('Không sao chép')}/stoploss`)).data;
  assert.equal(plain.policy.enabled, false);
  assert.equal((await api('admin', 'GET', '/api/stoploss-default')).status, 404, 'no team default policy');
});
