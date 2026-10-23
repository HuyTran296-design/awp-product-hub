// Free-capacity display data and the 1–5 baseline rule, on a fresh sample database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { nextMonth, startTestServer } from './helpers/test-server.js';

let api;
let stop;
let month;
let next;
before(async () => {
  ({ api, stop } = await startTestServer({ scenario: 'A' }));
  const { data } = await api('admin', 'GET', '/api/meta');
  month = data.firstOpenDate.slice(0, 7);
  next = nextMonth(month);
});
after(() => stop());

test('staffing context: free effort excludes the project being edited', async () => {
  const ctxNew = (await api('admin', 'GET', `/api/staffing-context?date=${month}-01`)).data;
  assert.deepEqual(ctxNew.members.map((m) => m.available), [10, 10, 10, 10]);
  const minh = ctxNew.members.find((m) => m.id === 1);
  assert.deepEqual(minh.allocations.map((a) => `${a.name} ${a.effortPct}`), ['Zen Bell 50', 'Mindfulness Bell 40']);
  const zen = (await api('admin', 'GET', `/api/projects/1/staffing?date=${month}-01`)).data;
  assert.equal(zen.members.find((m) => m.id === 1).available, 60);
});

test('a project with a single baseline can be activated', async () => {
  const body = { info: { name: 'Một baseline', color: '#0E7490', productType: 'mobile_app', platforms: ['ios'], parentId: 5 },
    baselines: { list: [{ metricKey: 'revenue', weight: 100, targetMonthly: 10_000_000 }], thresholds: { green: 80, red: 50 } },
    staffing: { rows: [{ memberId: 3, effortPct: 5 }] }, activate: true, activationDate: `${next}-01` };
  const r = await api('admin', 'POST', '/api/projects', body);
  assert.equal(r.status, 201, r.data.error);
  const zero = await api('admin', 'PUT', `/api/projects/${r.data.project.id}/baselines`, {
    baselines: [{ metricKey: 'revenue', weight: 0, targetMonthly: 1 }], thresholds: { green: 80, red: 50 } });
  assert.equal(zero.status, 422);
  const six = await api('admin', 'PUT', `/api/projects/${r.data.project.id}/baselines`, {
    baselines: ['revenue', 'dau', 'downloads', 'new_users', 'retention_d7', 'store_rating'].map((k) => ({ metricKey: k, weight: 10, targetMonthly: 1 })),
    thresholds: { green: 80, red: 50 } });
  assert.equal(six.status, 422);
});
