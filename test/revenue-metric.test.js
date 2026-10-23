// One "Doanh thu" metric (revenue) with a platform dimension ios / android / playables: catalog, Game B's Playables
// revenue in its P&L and the "Doanh thu – YouTube Playables" entry.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { catalogFor, METRIC_CATALOG, manualPlatformOf } from '../shared/metric-catalog.js';
import { startTestServer } from './helpers/test-server.js';

let t;
let ids;
before(async () => {
  t = await startTestServer();
  ids = Object.fromEntries((await t.api('admin', 'GET', '/api/meta')).data.projects.map((p) => [p.name, p.id]));
});
after(() => t.stop());

test('the catalog has one revenue metric named "Doanh thu" for every release platform', () => {
  const revenue = METRIC_CATALOG.filter((m) => /doanh thu/i.test(m.name));
  assert.deepEqual(revenue.map((m) => [m.key, m.name]), [['revenue', 'Doanh thu']]);
  assert.deepEqual(revenue[0].platforms, ['ios', 'android', 'playables']);
  for (const platforms of [['ios'], ['android'], ['playables'], ['playables', 'ios', 'android']]) {
    assert.equal(catalogFor(platforms).filter((m) => m.key === 'revenue').length, 1, platforms.join('+'));
  }
  assert.equal(manualPlatformOf('revenue', ['playables', 'ios']), 'playables');
  assert.equal(manualPlatformOf('revenue', ['ios', 'android']), 'all');
});

test('Game B: Doanh thu = YouTube Playables (entered by hand) and counts in its P&L', async () => {
  const p = (await t.api('admin', 'GET', `/api/projects/${ids['Game B']}/overview?period=month`)).data.project;
  assert.ok(p.revenue > 0);
  assert.equal(p.revenueByPlatform.ios, 0);
  assert.equal(p.revenueByPlatform.android, 0);
  assert.equal(Math.round(p.revenueByPlatform.playables), Math.round(p.revenue));
  assert.equal(Math.round(p.profit), Math.round(p.revenue - p.cost));
});

test('"Doanh thu – YouTube Playables" saves revenue on the playables platform', async () => {
  const id = ids['Game B'];
  const r = await t.api('admin', 'POST', `/api/projects/${id}/manual`, {
    entries: [{ metricKey: 'revenue', platform: 'playables', periodType: 'month', periodStart: '2026-10-01', value: 4_000_000 }] });
  assert.equal(r.status, 200, r.data.error);
  const h = (await t.api('admin', 'GET', `/api/projects/${id}/manual/revenue/history?platform=playables`)).data.history;
  assert.deepEqual([h[0].value, h[0].platform], [4_000_000, 'playables']);
  const b = (await t.api('admin', 'GET', `/api/projects/${id}/overview?period=month`)).data.project.baselines.find((x) => x.metricKey === 'revenue');
  assert.equal(b.actual, 4_000_000);
  const bad = await t.api('admin', 'POST', `/api/projects/${id}/manual`, {
    entries: [{ metricKey: 'revenue', platform: 'ios', periodType: 'month', periodStart: '2026-10-01', value: 1 }] });
  assert.equal(bad.status, 422);
});
