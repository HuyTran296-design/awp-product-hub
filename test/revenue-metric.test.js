// One "Doanh thu" metric (revenue) with a platform dimension ios / android / playables: catalog, migration of the former
// "Doanh thu chia sẻ quảng cáo", Game B's Playables revenue in its P&L and the "Doanh thu – YouTube Playables" entry.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { catalogFor, METRIC_CATALOG, manualPlatformOf } from '../shared/metric-catalog.js';
import { createProjectRow, openDatabase } from '../server/database.js';
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

test('an older database: ad_revenue_share becomes revenue on the playables platform', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awp-revenue-'));
  const file = path.join(dir, 'old.db');
  try {
    let db = openDatabase(file);
    const id = createProjectRow(db, { slug: 'old-game', name: 'Old Game', color: '#000', platforms: ['playables'],
      baselines: [['ad_revenue_share', 100, 5_000_000, 'manual', 'month']] });
    db.prepare(`INSERT INTO manual_values (project_id, metric_key, period_type, period_start, value, entered_by, entered_at)
      VALUES (?, 'ad_revenue_share', 'month', '2026-09-01', 2600000, 'x', '2026-09-28')`).run(id);
    db.prepare("INSERT INTO metric_daily (project_id, date, metric_key, platform, value) VALUES (?, '2026-09-02', 'ad_revenue_share', 'all', 5)").run(id);
    db.prepare(`INSERT INTO baseline_versions (project_id, effective_date, data, created_at, created_by) VALUES (?, '2026-10-01', ?, 'x', 'x')`)
      .run(id, JSON.stringify({ list: [{ metricKey: 'ad_revenue_share', weight: 100, targetMonthly: 6_000_000 }], thresholds: { green: 80, red: 50 } }));
    db.close();
    db = openDatabase(file);
    const one = (sql) => db.prepare(sql).get(id);
    assert.deepEqual({ ...one('SELECT metric_key, platform, value FROM manual_values WHERE project_id = ?') }, { metric_key: 'revenue', platform: 'playables', value: 2_600_000 });
    assert.deepEqual({ ...one('SELECT metric_key, platform FROM metric_daily WHERE project_id = ?') }, { metric_key: 'revenue', platform: 'playables' });
    assert.equal(one('SELECT metric_key FROM baseline_configs WHERE project_id = ?').metric_key, 'revenue');
    assert.equal(one('SELECT metric_key FROM baseline_sources WHERE project_id = ?').metric_key, 'revenue');
    assert.equal(JSON.parse(one('SELECT data FROM baseline_versions WHERE project_id = ?').data).list[0].metricKey, 'revenue');
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
