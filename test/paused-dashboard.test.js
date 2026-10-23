// A project paused from the current month: still on the Dashboard (badge "Tạm dừng"), revenue counted,
// cost only for the days before the pause; earlier periods unchanged; archived projects disappear.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { round } from '../shared/format.js';
import { startTestServer } from './helpers/test-server.js';

let api;
let stop;
before(async () => { ({ api, stop } = await startTestServer({ scenario: 'A' })); });
after(() => stop());

test('paused project stays on the dashboard with zero cost from the pause date', async () => {
  const { data: meta } = await api('admin', 'GET', '/api/meta');
  const before = (await api('admin', 'GET', '/api/dashboard?period=day')).data.projects.find((p) => p.id === 2);
  const r = await api('admin', 'POST', '/api/projects/2/lifecycle', { action: 'pause', effectiveDate: meta.firstOpenDate });
  assert.equal(r.status, 200, r.data.error);
  const dash = (await api('admin', 'GET', '/api/dashboard?period=day')).data;
  const mb = dash.projects.find((p) => p.id === 2);
  assert.equal(mb.lifecycle, 'paused');
  assert.equal(mb.cost, 0);
  assert.equal(mb.revenue, before.revenue);
  assert.ok(mb.profit > 0, 'revenue with zero cost → Lời');
  assert.equal(mb.score, before.score, 'score still computed');
  // Zen Bell takes the whole "Tools & AI" (20.000.000): 40.200.000 + 20.000.000 per month.
  const zen = dash.projects.find((p) => p.id === 1);
  assert.equal(round(zen.cost * 21), 60_200_000);
  const sidebar = (await api('viewer', 'GET', '/api/meta')).data.projects;
  assert.equal(sidebar.find((p) => p.id === 2).status, 'paused');
});

test('archived project is hidden from the dashboard', async () => {
  const { data: meta } = await api('admin', 'GET', '/api/meta');
  const r = await api('admin', 'POST', '/api/projects/2/lifecycle', { action: 'archive', effectiveDate: meta.firstOpenDate });
  assert.equal(r.status, 200, r.data.error);
  const dash = (await api('admin', 'GET', '/api/dashboard?period=day')).data;
  assert.ok(!dash.projects.some((p) => p.id === 2));
  const sync = await api('admin', 'POST', '/api/projects/2/connections/ga4/sync');
  assert.equal(sync.status, 409);
});
