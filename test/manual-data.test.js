// Projects without connectors: manual values, overdue data, build phase budget, CSV upload, source switch.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { round } from '../shared/format.js';

process.env.AWP_TODAY = '2026-10-16';
let t;
let ids;
before(async () => {
  const { startTestServer } = await import('./helpers/test-server.js');
  t = await startTestServer();
  const meta = (await t.api('admin', 'GET', '/api/meta')).data;
  ids = Object.fromEntries(meta.projects.map((p) => [p.name, p.id]));
});
after(() => t.stop());

test('B6. Game B (con của ABC Game Studio): manual October values → 85,9% Tốt; ABC Game Studio composite 85,9% (Game A Xây dựng bỏ qua)', async () => {
  const { data } = await t.api('admin', 'GET', `/api/projects/${ids['Game B']}/overview?period=month`);
  const b = Object.fromEntries(data.project.baselines.map((x) => [x.metricKey, x]));
  assert.deepEqual([b.revenue.actual, b.plays.actual, b.players.actual, b.play_time.actual], [3_200_000, 120_000, 45_000, 6.5]);
  assert.deepEqual([b.revenue.pct, b.plays.pct, b.players.pct, b.play_time.pct], [64.0, 120.0, 90.0, 81.3]);
  assert.deepEqual([b.revenue.status, b.plays.status, b.players.status, b.play_time.status], ['yellow', 'green', 'green', 'green']);
  assert.equal(b.revenue.name, 'Doanh thu');
  assert.equal(b.revenue.source, 'manual');
  assert.equal(b.plays.source, 'manual');
  assert.equal(b.plays.manual.period.label, 'Tháng 10/2026');
  assert.equal(data.project.score, 85.9);
  assert.equal(data.project.status, 'green');
  const abc = (await t.api('admin', 'GET', `/api/projects/${ids['ABC Game Studio']}/overview?period=month`)).data;
  assert.equal(abc.folder, true);
  assert.equal(abc.project.score, 85.9);
  assert.equal(abc.project.status, 'green');
  assert.deepEqual(abc.project.counts, { green: 1, build: 1 });
  assert.equal(abc.project.scoreUsed, 1);
  const mk = (await t.api('admin', 'GET', `/api/projects/${ids['Game B']}/marketing?period=month`)).data;
  assert.ok(mk.youtube.views.value > 0);
  assert.equal(mk.channelTotal, 0); // iOS + Android without store data yet
  assert.equal(mk.blog, null);
  assert.match(mk.note, /có thể bằng 0/);
});

test('3. Game A (Xây dựng, con của ABC Game Studio): "đã dùng 64% ngân sách", budget condition safe', async () => {
  const id = ids['Game A'];
  const { data } = await t.api('admin', 'GET', `/api/projects/${id}/overview?period=month`);
  assert.equal(data.project.phase, 'build');
  assert.equal(data.project.budget.spend, 96_000_000);
  assert.equal(round(data.project.budget.usedPct), 64);
  const dash = (await t.api('admin', 'GET', '/api/dashboard?period=month')).data;
  assert.equal(dash.projects.find((p) => p.id === id).phase, 'build');
  const sl = (await t.api('admin', 'GET', `/api/projects/${id}/stoploss`)).data;
  const c = sl.conditions.find((x) => x.key === 'budget_overrun');
  assert.equal(c.met, false);
  assert.equal(c.warning, false);
  assert.match(c.detail, /96\.000\.000 ₫ \/ 150\.000\.000 ₫ \(64,0% ngưỡng\)/);
  assert.equal(sl.display.status, 'safe');
});

test('manual values: saving keeps history with who and when', async () => {
  const id = ids['Game B'];
  const form = (await t.api('admin', 'GET', `/api/projects/${id}/manual`)).data;
  assert.deepEqual(form.items.map((i) => i.metricKey).sort(), ['play_time', 'players', 'plays', 'revenue']);
  const rev = form.items.find((i) => i.metricKey === 'revenue');
  assert.deepEqual([rev.name, rev.platform], ['Doanh thu – YouTube Playables', 'playables']);
  const r = await t.api('admin', 'POST', `/api/projects/${id}/manual`, { entries: [{ metricKey: 'plays', periodType: 'month', periodStart: '2026-10-01', value: 121_000 }] });
  assert.equal(r.status, 200);
  const h = (await t.api('admin', 'GET', `/api/projects/${id}/manual/plays/history`)).data.history;
  assert.equal(h[0].value, 121_000);
  assert.equal(h[0].enteredBy, 'Khánh Mai');
  assert.ok(h.find((x) => x.value === 120_000).replacedAt, 'previous value kept as history');
  await t.api('admin', 'POST', `/api/projects/${id}/manual`, { entries: [{ metricKey: 'plays', periodType: 'month', periodStart: '2026-10-01', value: 120_000 }] });
});

test('4. CSV: one bad date line is reported; valid lines import', async () => {
  const id = ids['Game B'];
  const csv = 'date,metric_key,platform,value\n2026-10-01,plays,all,3950\n2026-13-02,plays,all,4000\n2026-10-03,players,all,1500\n';
  const pv = (await t.api('admin', 'POST', `/api/projects/${id}/csv/preview`, { csv })).data;
  assert.equal(pv.total, 3);
  assert.equal(pv.valid, 2);
  assert.equal(pv.errors.length, 1);
  assert.equal(pv.errors[0].line, 3);
  assert.match(pv.errors[0].message, /ngày "2026-13-02"/);
  const imp = (await t.api('admin', 'POST', `/api/projects/${id}/csv/import`, { csv, mode: 'skip' })).data;
  assert.equal(imp.written, 2);
  const again = (await t.api('admin', 'POST', `/api/projects/${id}/csv/import`, { csv, mode: 'skip' })).data;
  assert.equal(again.skipped, 2, 'duplicates skipped');
  const tpl = await fetch(`${t.base}/api/csv-template`, { headers: { cookie: t.cookies.admin } });
  assert.match(await tpl.text(), /^date,metric_key,platform,value/);
});

test('5. DAU manual → GA4 from 01/12/2026: earlier data unchanged, chart marker "Đổi nguồn: GA4"', async () => {
  const id = ids['Mindfulness Bell'];
  const edit = (await t.api('admin', 'GET', `/api/projects/${id}/edit`)).data;
  const list = edit.baselines.map((b) => ({ ...b, source: b.metricKey === 'dau' ? 'manual' : b.source }));
  assert.equal((await t.api('admin', 'PUT', `/api/projects/${id}/baselines`, { baselines: list, thresholds: edit.thresholds, sourceDate: '2026-10-01' })).status, 200);
  await t.api('admin', 'POST', `/api/projects/${id}/manual`, { entries: [
    { metricKey: 'dau', periodType: 'month', periodStart: '2026-10-01', value: 6_500 },
    { metricKey: 'dau', periodType: 'month', periodStart: '2026-11-01', value: 6_400 }] });
  const before = (await t.api('admin', 'GET', `/api/projects/${id}/overview?period=month`)).data;
  assert.equal(before.project.baselines.find((b) => b.metricKey === 'dau').actual, 6_500);
  const back = list.map((b) => ({ ...b, source: b.metricKey === 'dau' ? 'auto' : b.source }));
  assert.equal((await t.api('admin', 'PUT', `/api/projects/${id}/baselines`, { baselines: back, thresholds: edit.thresholds, sourceDate: '2026-12-01' })).status, 200);
  const unchanged = (await t.api('admin', 'GET', `/api/projects/${id}/overview?period=month`)).data;
  assert.equal(unchanged.project.baselines.find((b) => b.metricKey === 'dau').actual, 6_500, 'October still uses the manual value');

  // Move the clock past the switch and refresh sample data.
  process.env.AWP_TODAY = '2026-12-10';
  t.app.dataSource.ensureFresh([{ id, slug: 'mindfulness-bell', productType: 'mobile_app' }]);
  const after = (await t.api('admin', 'GET', `/api/projects/${id}/overview?period=month`)).data;
  const dau = after.project.baselines.find((b) => b.metricKey === 'dau');
  assert.deepEqual(dau.sourceChanges, [{ date: '2026-12-01', label: 'Đổi nguồn: GA4' }]);
  assert.equal(dau.source, 'auto');
  const nov = dau.series.filter((d) => d.date < '2026-12-01');
  assert.ok(nov.length && nov.every((d) => d.value === 6_400), 'days before the switch keep the manual value');
  assert.ok(dau.series.filter((d) => d.date >= '2026-12-01').every((d) => d.value !== 6_400));
  process.env.AWP_TODAY = '2026-10-16';
});
