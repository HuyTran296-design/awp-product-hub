// SQLite storage (built-in node:sqlite): schema, sample configuration seed, typed accessors.
// Cost-affecting configuration (member cost, staffing, project status) is effective-dated in config_versions;
// Chi phí Tools/AI lives in tools (config incl. price versions) and tool_actuals (invoice amount per month).
// See shared/cost-timeline.js and shared/tool-costs.js for how a date's / month's cost is resolved.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { addMonths } from '../shared/closing.js';
import { manualPlatformOf, METRIC_CATALOG } from '../shared/metric-catalog.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  is_admin INTEGER NOT NULL DEFAULT 0   -- "Quyền Admin" (Nhân sự page)
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  product_type TEXT NOT NULL DEFAULT 'mobile_app',
  platforms TEXT NOT NULL,            -- JSON array: ["ios","android","web","blog"]
  created_at TEXT NOT NULL,
  deleted_at TEXT,                    -- permanently deleted: metrics/connections/baselines removed, cost history kept
  launch_date TEXT,                   -- "Ngày ra mắt dự kiến"
  build_budget REAL,                  -- "Ngân sách giai đoạn Xây dựng (VND)"
  sample_data INTEGER NOT NULL DEFAULT 1        -- 0: no generated sample data
);
CREATE TABLE IF NOT EXISTS project_phases (   -- effective-dated: Xây dựng / Ra mắt / Tăng trưởng / Ổn định
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK (phase IN ('build', 'launch', 'growth', 'stable')),
  effective_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS baseline_sources (  -- effective-dated data source of a baseline
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('auto', 'manual', 'csv')),
  manual_period TEXT NOT NULL DEFAULT 'month' CHECK (manual_period IN ('day', 'week', 'month')),
  effective_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS manual_values (     -- every save is kept; the current value has replaced_at NULL
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'all',        -- 'all' or a platform without connector (revenue: 'playables')
  period_type TEXT NOT NULL CHECK (period_type IN ('day', 'week', 'month')),
  period_start TEXT NOT NULL,
  value REAL NOT NULL,
  entered_by TEXT NOT NULL,
  entered_at TEXT NOT NULL,
  replaced_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_manual_current ON manual_values (project_id, metric_key, period_start) WHERE replaced_at IS NULL;
CREATE TABLE IF NOT EXISTS config_versions (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL CHECK (entity IN ('member_cost', 'staffing', 'status')),
  entity_id INTEGER NOT NULL,
  effective_date TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_versions_entity ON config_versions (entity, entity_id, effective_date);
CREATE TABLE IF NOT EXISTS tools (           -- Chi phí Tools/AI; "Xóa" sets removedFrom so earlier months keep their cost
  id TEXT PRIMARY KEY,
  sort INTEGER NOT NULL,
  data TEXT NOT NULL                    -- JSON { name, versions: [{ fromMonth, kind, currency, amount, appliesTo }], removedFrom }
);
CREATE TABLE IF NOT EXISTS tool_actuals (    -- "Thực tế": invoice amount of a tool in a month (tool currency)
  tool_id TEXT NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
  month TEXT NOT NULL,                  -- YYYY-MM
  amount REAL NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('VND', 'USD')),
  entered_by TEXT NOT NULL,
  entered_at TEXT NOT NULL,
  PRIMARY KEY (tool_id, month)
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER,                 -- NULL for team-level changes
  actor TEXT NOT NULL,
  actor_user_id INTEGER,              -- users.id when a signed-in user acted
  at TEXT NOT NULL,
  action TEXT NOT NULL,
  field TEXT,
  old_value TEXT,
  new_value TEXT,
  effective_date TEXT,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_log (project_id, at);
CREATE TABLE IF NOT EXISTS baseline_configs (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  metric_key TEXT NOT NULL,
  weight REAL NOT NULL CHECK (weight >= 0 AND weight <= 100),
  target_monthly REAL NOT NULL,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (project_id, metric_key)
);
CREATE TABLE IF NOT EXISTS thresholds (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  green REAL NOT NULL,
  red REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS connections (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('ga4', 'app_store', 'google_play', 'youtube')),
  config_json TEXT NOT NULL DEFAULT '{}',   -- non-secret identifiers only
  secret_enc TEXT,                          -- AES-256-GCM ciphertext, never sent to the browser
  secret_name TEXT,
  status TEXT NOT NULL DEFAULT 'not_configured' CHECK (status IN ('connected', 'error', 'not_configured')),
  message TEXT,
  sync_time TEXT NOT NULL DEFAULT '06:00',
  last_checked_at TEXT,
  last_synced_at TEXT,
  PRIMARY KEY (project_id, source)
);
CREATE TABLE IF NOT EXISTS metric_daily (
  project_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  platform TEXT NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY (project_id, metric_key, platform, date)
);
CREATE TABLE IF NOT EXISTS users (          -- login accounts (separate from cost "Nhân sự")
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
  scope TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'selected')),
  project_ids TEXT NOT NULL DEFAULT '[]',  -- JSON, used when scope = 'selected'
  status TEXT NOT NULL CHECK (status IN ('active', 'invited', 'locked')),
  invite_token TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT                          -- soft delete: history keeps "Tên (đã xóa)"
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (lower(email)) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stoploss_policies (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stoploss_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  created_on TEXT NOT NULL,             -- server "today" when created
  evaluated_through TEXT NOT NULL,      -- last closed month evaluated (YYYY-MM)
  met_keys TEXT NOT NULL,               -- JSON array of satisfied condition keys
  snapshot TEXT NOT NULL,               -- JSON: conditions, last 6 months P&L, proposed action
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'executed', 'extended', 'dismissed')),
  decision TEXT                         -- JSON: who, when, reason, action/effective date or review date
);
CREATE TABLE IF NOT EXISTS promo_sources (     -- "Nguồn promote": sub-sources of the channel "Promote từ nền tảng khác"
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,                   -- tracking code: utm_source / ct / referrer utm_source
  source_project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,  -- picked from another project: shows its name
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, code)
);
CREATE TABLE IF NOT EXISTS baseline_versions (  -- targets, weights & thresholds "Hiệu lực từ tháng"; baseline_configs = the version before the first one
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  effective_date TEXT NOT NULL,         -- first day of a month
  data TEXT NOT NULL,                   -- JSON { list: [{ metricKey, weight, targetMonthly }], thresholds: { green, red } }
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_baseline_versions ON baseline_versions (project_id, effective_date);
CREATE TABLE IF NOT EXISTS blog_posts (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  PRIMARY KEY (project_id, slug)
);
`;

/** Versions seeded with this date apply to all history. */
export const BEGINNING = '2000-01-01';
export const SYSTEM_ACTOR = 'Khánh Mai'; // author of the sample data history (the sample Admin)
/** Data model of this version: Tools/AI cost by month. A database of an older model is backed up and recreated. */
const DATA_MODEL = 'tools-phien-ban-thang';

export { PRODUCT_TYPES } from '../shared/product-types.js';

export const DEFAULT_PLATFORMS = ['ios', 'android', 'web', 'blog'];
export const DEFAULT_BASELINES = [
  ['revenue', 100, 30_000_000], ['dau', 80, 5_000], ['downloads', 50, 2_000],
  ['retention_d7', 60, 15], ['store_rating', 40, 4.5],
];
const GAME_PLATFORMS = ['playables', 'ios', 'android'];

/** Stop-loss of Game B: cumulative / consecutive loss and low health, review when triggered. */
const GAME_B_STOPLOSS = {
  enabled: true, startDate: null, warnPct: 70, cumulativeLoss: { on: true, amount: 60_000_000 }, consecutiveLoss: { on: true, months: 6 },
  lowHealth: { on: true, below: 50, months: 2 }, milestones: [], budgetOverrun: { on: false, pct: 100 }, lateLaunch: { on: false, days: 30 },
  triggerCount: 1, action: { type: 'review', effortPct: 50 },
};

/**
 * Demo data: two game projects, two people (lương 42.000.000/tháng) and six tools; Tools/AI 10/2026 = 30.200.000.
 * A tool's startMonth (seed only) is the month its first version applies from; none = since the beginning.
 * effort: { 'Võ Nam': %, 'Đỗ Vy': % }; manual: { metricKey: { 'YYYY-MM': value } } — monthly values entered by hand.
 */
const DEMO = {
  members: [['Võ Nam', 'Game Developer', 24_000_000], ['Đỗ Vy', 'Game Artist', 18_000_000]],
  projects: [
    {
      // "Xây dựng": budget, launch date, manual baselines, budget stop-loss (spec F: đã dùng 64% ngân sách).
      slug: 'game-a', name: 'Game A', color: '#8A6D1F', platforms: GAME_PLATFORMS, phase: 'build', since: '2026-04-01',
      launchDate: '2027-03-31', buildBudget: 150_000_000, effort: { 'Võ Nam': 50, 'Đỗ Vy': 50 },
      baselines: [
        ['feature_progress', 100, 70, 'manual', 'month'], ['waitlist', 60, 2_000, 'manual', 'month'],
        ['beta_testers', 60, 150, 'manual', 'month'], ['budget_burn', 80, 1, 'manual', 'month'],
      ],
      manual: {
        feature_progress: { '2026-09': 55, '2026-10': 62 },
        waitlist: { '2026-09': 1_520, '2026-10': 1_850 },
        beta_testers: { '2026-09': 95, '2026-10': 120 },
        budget_burn: { '2026-04': 10_000_000, '2026-05': 24_000_000, '2026-06': 38_000_000, '2026-07': 52_000_000,
          '2026-08': 67_000_000, '2026-09': 82_000_000, '2026-10': 96_000_000 },
      },
      stopLoss: {
        enabled: true, startDate: null, warnPct: 70,
        cumulativeLoss: { on: false, amount: 60_000_000 }, consecutiveLoss: { on: false, months: 6 },
        lowHealth: { on: false, below: 50, months: 2 }, milestones: [],
        budgetOverrun: { on: true, pct: 100 }, lateLaunch: { on: true, days: 30 },
        triggerCount: 1, action: { type: 'review', effortPct: 50 },
      },
    },
    {
      // "Tăng trưởng"; monthly figures entered by hand (spec B6: 85,9% "Tốt" in 10/2026).
      slug: 'game-b', name: 'Game B', color: '#6B7F2A', platforms: GAME_PLATFORMS, phase: 'growth', since: '2026-03-01',
      effort: { 'Võ Nam': 50, 'Đỗ Vy': 30 },
      baselines: [
        ['revenue', 100, 5_000_000, 'manual', 'month'], ['plays', 60, 100_000, 'manual', 'month'],
        ['players', 80, 50_000, 'manual', 'month'], ['play_time', 40, 8, 'manual', 'month'],
      ],
      manual: {
        revenue: { '2026-08': 1_900_000, '2026-09': 2_900_000, '2026-10': 3_200_000 },
        plays: { '2026-08': 82_000, '2026-09': 98_000, '2026-10': 120_000 },
        players: { '2026-08': 33_000, '2026-09': 39_500, '2026-10': 45_000 },
        play_time: { '2026-08': 5.8, '2026-09': 6.1, '2026-10': 6.5 },
      },
      stopLoss: GAME_B_STOPLOSS,
    },
  ],
  // appliesTo: [] = Tất cả dự án, else project slugs; actuals: { 'YYYY-MM': amount } entered from the invoices.
  tools: [
    { name: 'Claude & ChatGPT', kind: 'usage', amount: 12_000_000,
      actuals: { '2026-08': 11_200_000, '2026-09': 10_500_000, '2026-10': 14_200_000 } },
    { name: 'Google Workspace & Slack', kind: 'monthly', amount: 6_000_000 },
    { name: 'Unity & asset game', kind: 'annual', amount: 72_000_000, startMonth: '2026-01', appliesTo: ['game-a', 'game-b'] },
    { name: 'Tài khoản App Store & Google Play', kind: 'monthly', amount: 4_000_000 },
    { name: 'Figma', kind: 'monthly', amount: 45, currency: 'USD', startMonth: '2026-11' },
    { name: 'Bộ asset nhân vật', kind: 'one_time', amount: 18_000_000, startMonth: '2026-11', appliesTo: ['game-a'] },
  ],
};

/**
 * Test-only configuration (kịch bản A, B, D, E of the calculation tests): never part of the demo data.
 * 4 people (80.000.000) + one tool "Tools & AI" 20.000.000 for all projects = 100.000.000/tháng.
 */
const TEST_SCENARIO_A = {
  members: [['Nguyễn Minh', 'Product Manager', 25_000_000], ['Trần Lan', 'iOS Developer', 22_000_000],
    ['Lê Tuấn', 'Android Developer', 20_000_000], ['Phạm Hà', 'Marketing & Content', 13_000_000]],
  projects: [
    {
      slug: 'du-an-test-1', name: 'Dự án Test 1', color: '#0F6E66',
      effort: { 'Nguyễn Minh': 50, 'Trần Lan': 60, 'Lê Tuấn': 40, 'Phạm Hà': 50 },
      baselines: [
        ['revenue', 100, 60_000_000], ['dau', 80, 11_000], ['downloads', 50, 4_500],
        ['retention_d7', 60, 20], ['store_rating', 40, 4.7],
      ],
    },
    {
      slug: 'du-an-test-2', name: 'Dự án Test 2', color: '#5A3FC0',
      effort: { 'Nguyễn Minh': 40, 'Trần Lan': 30, 'Lê Tuấn': 50, 'Phạm Hà': 40 },
      baselines: [
        ['revenue', 100, 40_000_000], ['dau', 80, 7_500], ['downloads', 50, 3_000],
        ['retention_d7', 60, 17], ['crash_rate_android', 40, 1.0],
      ],
      // Stop-loss sample of the brief (tracking from 01/05/2026, pause when triggered).
      stopLoss: {
        enabled: true, startDate: '2026-05-01', warnPct: 70,
        cumulativeLoss: { on: true, amount: 60_000_000 },
        consecutiveLoss: { on: true, months: 6 },
        lowHealth: { on: true, below: 50, months: 2 },
        milestones: [{ id: 'm1', on: true, date: '2026-12-31', kind: 'revenue_ratio', value: 80 }],
        triggerCount: 1, action: { type: 'pause', effortPct: 50 },
      },
    },
  ],
  tools: [{ name: 'Tools & AI', kind: 'monthly', amount: 20_000_000 }],
};

export function openDatabase(file) {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    replaceOlderModel(file);
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  setAppSetting(db, 'data_model', DATA_MODEL);
  return db;
}

/**
 * A database of an older model (Dự án → Sản phẩm, sample products) is not migrated: it is copied to data/backups/
 * and removed, so the app starts on fresh demo data.
 */
function replaceOlderModel(file) {
  if (!fs.existsSync(file)) return;
  const old = new DatabaseSync(file);
  let model = null;
  try {
    model = old.prepare("SELECT value FROM app_settings WHERE key = 'data_model'").get()?.value ?? null;
  } catch { /* no app_settings table: an empty or very old database */ }
  const empty = !old.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'projects'").get();
  if (model === JSON.stringify(DATA_MODEL) || empty) { old.close(); return; }
  const dir = path.join(path.dirname(file), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  old.exec(`VACUUM INTO '${path.join(dir, `${path.basename(file, '.db')}-${stamp}-truoc-${DATA_MODEL}.db`).replace(/'/g, "''")}'`);
  old.close();
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
}

export const SAMPLE_USERS = [
  { name: 'Khánh Mai', email: 'khanh.mai@abcdigital.io', role: 'admin' },
  { name: 'Huy Trần', email: 'huy.tran@abcdigital.io', role: 'viewer' },
  { name: 'Quân Đỗ', email: 'quan.do@abcdigital.io', role: 'viewer', scope: ['game-b'] },
  { name: 'Thành Châu', email: 'thanh.chau@abcdigital.io', role: 'viewer', scope: ['game-a'] },
];

export function seedUsers(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return;
  const ins = db.prepare(`INSERT INTO users (name, email, role, scope, project_ids, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?)`);
  const now = new Date().toISOString();
  const idOf = (slug) => db.prepare('SELECT id FROM projects WHERE slug = ? AND deleted_at IS NULL').get(slug)?.id;
  for (const u of SAMPLE_USERS) {
    const ids = (u.scope ?? []).map(idOf).filter(Boolean);
    ins.run(u.name, u.email, u.role, u.scope ? 'selected' : 'all', JSON.stringify(ids), now);
  }
}

export function mapUser(r) {
  return r && {
    id: r.id, name: r.name, email: r.email, role: r.role, scope: r.scope, projectIds: JSON.parse(r.project_ids),
    status: r.status, lastLoginAt: r.last_login_at, createdAt: r.created_at, deleted: Boolean(r.deleted_at),
  };
}

export function getAppSetting(db, key, fallback) {
  const r = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return r ? JSON.parse(r.value) : fallback;
}

export function setAppSetting(db, key, value) {
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

/** Run fn inside a transaction (re-entrant: nested calls join the outer transaction). */
export function tx(db, fn) {
  if (db.inTx) return fn();
  db.exec('BEGIN');
  db.inTx = true;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.inTx = false;
  }
}

export function addVersion(db, { entity, entityId = 0, effectiveDate, data, actor }) {
  db.prepare(`INSERT INTO config_versions (entity, entity_id, effective_date, data, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?)`).run(entity, entityId, effectiveDate, JSON.stringify(data), new Date().toISOString(), actor);
}

/**
 * Seed the sample configuration when the DB is empty; versions dated BEGINNING apply to all history.
 * scenario 'A' = the test-only configuration of the calculation tests (Dự án Test 1 / Test 2), otherwise the demo data.
 */
export function seedSampleConfig(db, { seedConnections, seedStopLoss, scenario = null }) {
  if (db.prepare('SELECT COUNT(*) AS n FROM config_versions').get().n > 0) return false;
  const cfg = String(scenario ?? '').toUpperCase() === 'A' ? TEST_SCENARIO_A : DEMO;
  tx(db, () => {
    const v = (entity, entityId, data, effectiveDate = BEGINNING) => addVersion(db, { entity, entityId, effectiveDate, data, actor: SYSTEM_ACTOR });
    const memberIds = {};
    for (const [name, role, cost] of cfg.members) {
      memberIds[name] = Number(db.prepare('INSERT INTO members (name, role) VALUES (?, ?)').run(name, role).lastInsertRowid);
      v('member_cost', memberIds[name], { monthlyCost: cost });
    }
    const ids = {};
    const insM = db.prepare(`INSERT INTO manual_values (project_id, metric_key, platform, period_type, period_start, value, entered_by, entered_at)
      VALUES (?, ?, ?, 'month', ?, ?, ?, ?)`);
    for (const p of cfg.projects) {
      const since = p.since ?? BEGINNING;
      const platforms = p.platforms ?? DEFAULT_PLATFORMS;
      const projectId = createProjectRow(db, { slug: p.slug, name: p.name, color: p.color, platforms, baselines: p.baselines,
        phase: p.phase ?? 'growth', launchDate: p.launchDate ?? null, buildBudget: p.buildBudget ?? null, since });
      ids[p.slug] = projectId;
      v('status', projectId, { status: 'active' }, since);
      v('staffing', projectId, { rows: Object.entries(p.effort).map(([name, effortPct]) => ({ memberId: memberIds[name], effortPct })) }, since);
      for (const [key, months] of Object.entries(p.manual ?? {})) {
        const platform = manualPlatformOf(key, platforms);
        for (const [ym, value] of Object.entries(months)) insM.run(projectId, key, platform, `${ym}-01`, value, SYSTEM_ACTOR,
          new Date(Math.min(Date.parse(`${ym}-28T09:00:00Z`), Date.now())).toISOString());
      }
      seedConnections(projectId, p.slug);
      seedStopLoss(projectId, p.stopLoss ?? null);
    }
    const insA = db.prepare(`INSERT INTO tool_actuals (tool_id, month, amount, currency, entered_by, entered_at) VALUES (?, ?, ?, ?, ?, ?)`);
    cfg.tools.forEach((t, i) => {
      const id = `t${i + 1}`;
      const tool = { name: t.name, removedFrom: null, versions: [{ fromMonth: t.startMonth ?? null, kind: t.kind, currency: t.currency ?? 'VND',
        amount: t.amount, appliesTo: (t.appliesTo ?? []).map((x) => ids[x]) }] };
      saveTool(db, id, i, tool);
      for (const [ym, amount] of Object.entries(t.actuals ?? {})) insA.run(id, ym, amount, tool.versions[0].currency, SYSTEM_ACTOR,
        new Date(Math.min(Date.parse(`${addMonths(ym, 1)}-02T09:00:00Z`), Date.now())).toISOString());
    });
  });
  return true;
}

/**
 * baselines: [[key, weight, target, source?, manualPeriod?]]; source defaults to the metric's native source.
 * Baseline sources and the phase are recorded from `since` (the date the project's history starts).
 */
export function createProjectRow(db, { slug, name, color, productType = 'mobile_app', platforms = [], baselines = DEFAULT_BASELINES,
  thresholds = { green: 80, red: 50 }, phase = 'growth', launchDate = null, buildBudget = null, since = BEGINNING, actor = SYSTEM_ACTOR }) {
  const projectId = Number(db.prepare(`INSERT INTO projects (slug, name, color, product_type, platforms, created_at, launch_date, build_budget)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(slug, name, color, productType, JSON.stringify(platforms),
    new Date().toISOString(), launchDate, buildBudget).lastInsertRowid);
  db.prepare('INSERT INTO thresholds (project_id, green, red) VALUES (?, ?, ?)').run(projectId, thresholds.green, thresholds.red);
  const insB = db.prepare(`INSERT INTO baseline_configs (project_id, metric_key, weight, target_monthly, sort_order)
    VALUES (?, ?, ?, ?, ?)`);
  const insS = db.prepare(`INSERT INTO baseline_sources (project_id, metric_key, source, manual_period, effective_date, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  baselines.forEach(([key, w, t, source, period], i) => {
    insB.run(projectId, key, w, t, i);
    insS.run(projectId, key, source ?? nativeSource(key), period ?? 'month', since, new Date().toISOString(), actor);
  });
  db.prepare('INSERT INTO project_phases (project_id, phase, effective_date, created_at, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(projectId, phase, since, new Date().toISOString(), actor);
  const insC = db.prepare('INSERT INTO connections (project_id, source) VALUES (?, ?)');
  for (const s of ['ga4', 'app_store', 'google_play', 'youtube']) insC.run(projectId, s);
  return projectId;
}

/** Store a tool { name, versions, removedFrom } (see shared/tool-costs.js). */
export function saveTool(db, id, sort, tool) {
  db.prepare('INSERT INTO tools (id, sort, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET sort = excluded.sort, data = excluded.data')
    .run(id, sort, JSON.stringify({ name: tool.name, versions: tool.versions, removedFrom: tool.removedFrom ?? null }));
}

export function listTools(db) {
  return db.prepare('SELECT id, data FROM tools ORDER BY sort, id').all().map((r) => ({ id: r.id, ...JSON.parse(r.data) }));
}

/** Actuals as { "toolId|YYYY-MM": { amount, currency, enteredBy, enteredAt } }. */
export function loadToolActuals(db) {
  return Object.fromEntries(db.prepare('SELECT * FROM tool_actuals').all().map((r) => [`${r.tool_id}|${r.month}`,
    { amount: r.amount, currency: r.currency, enteredBy: r.entered_by, enteredAt: r.entered_at }]));
}

function nativeSource(metricKey) {
  return METRIC_CATALOG.find((m) => m.key === metricKey)?.nativeSource === 'manual' ? 'manual' : 'auto';
}

// ---------- Typed reads ----------

/** Everything needed by shared/cost-timeline.js. Includes deleted projects/members so history is kept. */
export function loadTimeline(db) {
  return {
    versions: db.prepare('SELECT * FROM config_versions ORDER BY seq').all().map((r) => ({
      seq: r.seq, entity: r.entity, entityId: r.entity_id, effectiveDate: r.effective_date,
      data: JSON.parse(r.data), createdAt: r.created_at, createdBy: r.created_by,
    })),
    members: db.prepare('SELECT id, name, role FROM members ORDER BY id').all().map((r) => ({ id: r.id, name: r.name, role: r.role })),
    projects: db.prepare('SELECT id, name, color FROM projects ORDER BY id').all().map((r) => ({ id: r.id, name: r.name, color: r.color })),
    tools: listTools(db),
    toolActuals: loadToolActuals(db),
  };
}

export function listMembers(db, { includeInactive = false } = {}) {
  return db.prepare(`SELECT id, name, role, active, is_admin FROM members ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY id`).all()
    .map((r) => ({ id: r.id, name: r.name, role: r.role, active: Boolean(r.active), isAdmin: Boolean(r.is_admin) }));
}

/** Projects that still exist (not permanently deleted). */
export function listProjects(db) {
  return db.prepare('SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY id').all().map(mapProject);
}

export function getProject(db, id) {
  const r = db.prepare('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL').get(id);
  return r ? mapProject(r) : null;
}

function mapProject(r) {
  return { id: r.id, slug: r.slug, name: r.name, color: r.color, productType: r.product_type,
    platforms: JSON.parse(r.platforms), createdAt: r.created_at, launchDate: r.launch_date, buildBudget: r.build_budget,
    sampleData: r.sample_data !== 0 };
}

/** Baseline version in force on `date` (default: the latest saved, incl. one scheduled for a later month). */
export function baselineVersionAt(db, projectId, date = '9999-12-31') {
  const r = db.prepare(`SELECT * FROM baseline_versions WHERE project_id = ? AND effective_date <= ?
    ORDER BY effective_date DESC, id DESC LIMIT 1`).get(projectId, date);
  return r ? { id: r.id, effectiveDate: r.effective_date, ...JSON.parse(r.data), createdAt: r.created_at, createdBy: r.created_by } : null;
}

/** Baselines (targets & weights) in force on `date`; months keep the targets that applied to them. */
export function getBaselines(db, projectId, date) {
  const v = baselineVersionAt(db, projectId, date);
  if (v) return v.list.map((b) => ({ metricKey: b.metricKey, weight: b.weight, targetMonthly: b.targetMonthly }));
  return db.prepare('SELECT metric_key, weight, target_monthly, sort_order FROM baseline_configs WHERE project_id = ? ORDER BY sort_order')
    .all(projectId).map((r) => ({ metricKey: r.metric_key, weight: r.weight, targetMonthly: r.target_monthly }));
}

export function getThresholds(db, projectId, date) {
  const v = baselineVersionAt(db, projectId, date);
  if (v) return { ...v.thresholds };
  const r = db.prepare('SELECT green, red FROM thresholds WHERE project_id = ?').get(projectId);
  return r ? { green: r.green, red: r.red } : { green: 80, red: 50 };
}

/** Every saved version, newest first, plus the original configuration ("ban đầu"). */
export function listBaselineVersions(db, projectId) {
  const rows = db.prepare('SELECT * FROM baseline_versions WHERE project_id = ? ORDER BY effective_date DESC, id DESC').all(projectId)
    .map((r) => ({ id: r.id, effectiveDate: r.effective_date, ...JSON.parse(r.data), createdAt: r.created_at, createdBy: r.created_by }));
  const base = db.prepare('SELECT metric_key, weight, target_monthly FROM baseline_configs WHERE project_id = ? ORDER BY sort_order').all(projectId)
    .map((r) => ({ metricKey: r.metric_key, weight: r.weight, targetMonthly: r.target_monthly }));
  const th = db.prepare('SELECT green, red FROM thresholds WHERE project_id = ?').get(projectId) ?? { green: 80, red: 50 };
  return [...rows, { id: null, effectiveDate: null, list: base, thresholds: { green: th.green, red: th.red } }];
}
