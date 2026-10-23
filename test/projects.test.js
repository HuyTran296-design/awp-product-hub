// One level "Dự án" (demo data Game A, Game B): menu, Quản lý dự án, "Sao chép cấu hình từ dự án…", fresh demo data,
// and a database of the older model (Dự án → Sản phẩm) being backed up and replaced.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../server/database.js';
import { startTestServer } from './helpers/test-server.js';

let t;
let ids;
before(async () => {
  t = await startTestServer();
  ids = Object.fromEntries((await t.api('admin', 'GET', '/api/meta')).data.projects.map((p) => [p.name, p.id]));
});
after(() => t.stop());

test('H1. menu: a flat list Game A · Game B sorted by name, no parent / child fields', async () => {
  const meta = (await t.api('admin', 'GET', '/api/meta')).data;
  assert.deepEqual(meta.projects.map((p) => p.name), ['Game A', 'Game B']);
  for (const p of meta.projects) for (const k of ['parentId', 'kind', 'scheduledParentId']) assert.ok(!(k in p), k);
  assert.ok(!('lockedParents' in meta));
  const a = meta.projects.find((p) => p.name === 'Game A');
  assert.equal(a.color, '#8A6D1F');
  assert.deepEqual(a.platforms, ['playables', 'ios', 'android']);
});

test('Quản lý dự án: a flat table; Game A Xây dựng (ngân sách 150.000.000), Game B Tăng trưởng', async () => {
  const list = (await t.api('admin', 'GET', '/api/projects')).data;
  assert.deepEqual(list.rows.map((r) => [r.name, r.phase, r.status]), [['Game A', 'build', 'active'], ['Game B', 'growth', 'active']]);
  for (const r of list.rows) for (const k of ['parentId', 'isFolder', 'childCount']) assert.ok(!(k in r), k);
  const edit = (await t.api('admin', 'GET', `/api/projects/${ids['Game A']}/edit`)).data;
  assert.equal(edit.project.buildBudget, 150_000_000);
  assert.ok(!('parentOptions' in edit) && !('children' in edit));
  assert.equal((await t.api('admin', 'GET', '/api/parent-options')).status, 404);
  assert.equal((await t.api('admin', 'PUT', `/api/projects/${ids['Game A']}/child-template`, {})).status, 404);
});

test('fresh demo data: only Game A and Game B, two people, four promote sources, no old names anywhere', async () => {
  const db = t.app.db;
  assert.deepEqual(db.prepare('SELECT name FROM projects ORDER BY name').all().map((r) => r.name), ['Game A', 'Game B']);
  assert.deepEqual(db.prepare('SELECT name FROM members ORDER BY id').all().map((r) => r.name), ['Võ Nam', 'Đỗ Vy']);
  assert.deepEqual(db.prepare('SELECT name FROM promo_sources ORDER BY sort').all().map((r) => r.name),
    ['Từ game Game A', 'Từ TikTok', 'Từ kênh YouTube', 'Từ đối tác / website khác']);
  const old = /Zen Bell|Mindfulness|Zell App|ABC Game Studio|zenbell|sản phẩm/i;
  for (const table of ['projects', 'members', 'promo_sources', 'audit_log', 'config_versions', 'connections', 'blog_posts', 'stoploss_policies']) {
    for (const row of db.prepare(`SELECT * FROM ${table}`).all()) assert.ok(!old.test(JSON.stringify(row)), `${table}: ${JSON.stringify(row).slice(0, 120)}`);
  }
});

test('"Sao chép cấu hình từ dự án…": platforms, baselines, weights, targets, thresholds, stop-loss — no staff, no connections', async () => {
  const cfg = (await t.api('admin', 'GET', `/api/projects/${ids['Game B']}/copy-config`)).data;
  assert.deepEqual(cfg.platforms, ['playables', 'ios', 'android']);
  assert.deepEqual(cfg.baselines.map((b) => [b.metricKey, b.weight, b.targetMonthly, b.source]),
    [['revenue', 100, 5_000_000, 'manual'], ['plays', 60, 100_000, 'manual'], ['players', 80, 50_000, 'manual'], ['play_time', 40, 8, 'manual']]);
  assert.deepEqual(cfg.thresholds, { green: 80, red: 50 });
  assert.equal(cfg.stopLoss.enabled, true);
  assert.ok(!('startDate' in cfg.stopLoss));
  for (const k of ['staffing', 'members', 'connections']) assert.ok(!(k in cfg), k);
  const { data, status } = await t.api('admin', 'POST', '/api/projects', {
    info: { name: 'Game C', color: '#0E7490', platforms: cfg.platforms, phase: 'growth' }, copyFromId: ids['Game B'],
    baselines: { list: cfg.baselines, thresholds: cfg.thresholds }, staffing: { rows: [] }, activate: false });
  assert.equal(status, 201, data.error);
  const c = (await t.api('admin', 'GET', `/api/projects/${data.project.id}/edit`)).data;
  assert.deepEqual(c.baselines.map((b) => b.metricKey), ['revenue', 'plays', 'players', 'play_time']);
  assert.ok(c.connections.every((x) => x.status === 'not_configured'), 'connections are not copied');
  assert.deepEqual((await t.api('admin', 'GET', `/api/projects/${data.project.id}/staffing`)).data.rows, [], 'staff is not copied');
  assert.equal((await t.api('admin', 'GET', `/api/projects/${data.project.id}/stoploss`)).data.policy.enabled, true);
});

test('a database of the older model (Dự án → Sản phẩm) is backed up and replaced by the new model', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awp-model-'));
  const file = path.join(dir, 'old.db');
  try {
    const old = new DatabaseSync(file);
    old.exec("CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, kind TEXT); INSERT INTO projects VALUES (1, 'Zell App', 'folder');");
    old.close();
    const db = openDatabase(file);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 0);
    assert.ok(!db.prepare('PRAGMA table_info(projects)').all().some((c) => c.name === 'kind'));
    db.close();
    const backups = fs.readdirSync(path.join(dir, 'backups'));
    assert.equal(backups.length, 1);
    const copy = new DatabaseSync(path.join(dir, 'backups', backups[0]));
    assert.equal(copy.prepare('SELECT name FROM projects').get().name, 'Zell App');
    copy.close();
    // Opening it again keeps the data (same model).
    const again = openDatabase(file);
    again.close();
    assert.equal(fs.readdirSync(path.join(dir, 'backups')).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
