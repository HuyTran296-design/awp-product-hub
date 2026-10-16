// 2. November not entered by 03/12/2026 → "Chưa cập nhật", score "Đang thu thập dữ liệu", Admin reminder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.AWP_TODAY = '2026-12-04';
let t;
before(async () => {
  const { startTestServer } = await import('./helpers/test-server.js');
  t = await startTestServer();
});
after(() => t.stop());

test('overdue manual baselines are excluded and Admins are reminded', async () => {
  const meta = (await t.api('admin', 'GET', '/api/meta')).data;
  const id = meta.projects.find((p) => p.name === 'Game B').id;
  const { data } = await t.api('admin', 'GET', `/api/projects/${id}/overview?period=month`);
  assert.equal(data.project.baselines.length, 4);
  assert.ok(data.project.baselines.every((b) => b.stale && b.pct == null));
  assert.equal(data.project.baselines[0].manual.missing.label, 'Tháng 11/2026');
  assert.equal(data.project.score, null);
  assert.equal(data.project.status, null);
  assert.equal((await t.api('admin', 'GET', '/api/notifications')).status, 404, 'no reminders: the baseline card shows "Chưa cập nhật"');
});
