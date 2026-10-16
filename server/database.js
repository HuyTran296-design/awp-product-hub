// SQLite storage (built-in node:sqlite): schema, sample configuration seed, typed accessors.
// Cost-affecting configuration (team settings, member cost, staffing, project status) is effective-dated
// in config_versions; see shared/cost-timeline.js for how a date's configuration is resolved.

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { METRIC_CATALOG } from '../shared/metric-catalog.js';

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
  child_template TEXT,                -- "Mẫu cho sản phẩm mới" (JSON: platforms, baselines, thresholds, stopLoss)
  score_mode TEXT NOT NULL DEFAULT 'children',  -- legacy (a parent's score is always the children's cost-weighted mean)
  sample_data INTEGER NOT NULL DEFAULT 1,       -- 0: no generated sample data (e.g. a parent folder)
  kind TEXT NOT NULL DEFAULT 'project',         -- folder = "Dự án" (upper level, no own data) | project = "Sản phẩm" (belongs to one Dự án)
  description TEXT,                   -- "Mô tả" (Dự án)
  icon TEXT                           -- icon of a Dự án (emoji)
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
  -- membership = "Thuộc dự án" of a Sản phẩm; parent_split = how "Nhân sự chung của dự án" is split. group_* are legacy rows, migrated on open.
  entity TEXT NOT NULL CHECK (entity IN ('team', 'member_cost', 'staffing', 'status', 'membership', 'parent_split', 'group_staffing', 'group_status')),
  entity_id INTEGER NOT NULL,
  effective_date TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_versions_entity ON config_versions (entity, entity_id, effective_date);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER,                 -- NULL for team-level changes
  group_id INTEGER,                   -- legacy (project groups were migrated to parent projects)
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
  group_ids TEXT NOT NULL DEFAULT '[]',    -- legacy: migrated into project_ids (a parent includes its children)
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
  group_id INTEGER,                     -- legacy
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

export { PRODUCT_TYPES } from '../shared/product-types.js';

const SAMPLE_MEMBERS = [
  ['Nguyễn Minh', 'Product Manager', 25_000_000],
  ['Trần Lan', 'iOS Developer', 22_000_000],
  ['Lê Tuấn', 'Android Developer', 20_000_000],
  ['Phạm Hà', 'Marketing & Content', 13_000_000],
];

/** "Mẫu cho sản phẩm mới" of Zell App (also the template of its migrated predecessor, the group "Zell App"). */
const ZELL_TEMPLATE = {
  platforms: ['ios', 'android', 'web', 'blog'],
  baselines: [
    { metricKey: 'revenue', weight: 100, targetMonthly: 40_000_000, source: 'auto', period: 'month' },
    { metricKey: 'dau', weight: 80, targetMonthly: 7_500, source: 'auto', period: 'month' },
    { metricKey: 'downloads', weight: 50, targetMonthly: 3_000, source: 'auto', period: 'month' },
    { metricKey: 'retention_d7', weight: 60, targetMonthly: 17, source: 'auto', period: 'month' },
    { metricKey: 'store_rating', weight: 40, targetMonthly: 4.5, source: 'auto', period: 'month' },
  ],
  thresholds: { green: 80, red: 50 },
  stopLoss: null,
};
/** "Mẫu cho sản phẩm mới" of ABC Game Studio: games on YouTube Playables + iOS + Android. */
const ABC_TEMPLATE = {
  platforms: ['playables', 'ios', 'android'],
  baselines: [
    { metricKey: 'revenue', weight: 100, targetMonthly: 20_000_000, source: 'auto', period: 'month' },
    { metricKey: 'plays', weight: 60, targetMonthly: 80_000, source: 'manual', period: 'month' },
    { metricKey: 'downloads', weight: 50, targetMonthly: 1_500, source: 'auto', period: 'month' },
  ],
  thresholds: { green: 80, red: 50 },
  stopLoss: null,
};

/** Game B: baselines entered by hand (ad revenue share, plays, players, average play time). */
const GAME_B_BASELINES = [
  ['ad_revenue_share', 100, 5_000_000, 'manual', 'month'], ['plays', 60, 100_000, 'manual', 'month'],
  ['players', 80, 50_000, 'manual', 'month'], ['play_time', 40, 8, 'manual', 'month'],
];
const GAME_B_MANUAL = {
  ad_revenue_share: { '2026-08': 1_900_000, '2026-09': 2_600_000, '2026-10': 3_200_000 },
  plays: { '2026-08': 82_000, '2026-09': 98_000, '2026-10': 120_000 },
  players: { '2026-08': 33_000, '2026-09': 39_500, '2026-10': 45_000 },
  play_time: { '2026-08': 5.8, '2026-09': 6.1, '2026-10': 6.5 },
};

/** Parent-level stop-loss: available but off in the sample (the children have their own policies). */
const FOLDER_STOPLOSS_OFF = {
  enabled: false, startDate: null, warnPct: 70, cumulativeLoss: { on: true, amount: 60_000_000 }, consecutiveLoss: { on: true, months: 6 },
  lowHealth: { on: true, below: 50, months: 2 }, milestones: [], budgetOverrun: { on: false, pct: 100 }, lateLaunch: { on: false, days: 30 },
  triggerCount: 1, action: { type: 'review', effortPct: 50 },
};

const SAMPLE_PROJECTS = [
  {
    slug: 'zen-bell', name: 'Zen Bell', color: '#0F6E66', parent: 'zell-app',
    effort: [50, 60, 40, 50],
    baselines: [
      ['revenue', 100, 60_000_000], ['dau', 80, 11_000], ['downloads', 50, 4_500],
      ['retention_d7', 60, 20], ['store_rating', 40, 4.7],
    ],
  },
  {
    slug: 'mindfulness-bell', name: 'Mindfulness Bell', color: '#5A3FC0', parent: 'zell-app',
    effort: [40, 30, 50, 40],
    baselines: [
      ['revenue', 100, 40_000_000], ['dau', 80, 7_500], ['downloads', 50, 3_000],
      ['retention_d7', 60, 17], ['crash_rate_android', 40, 1.0],
    ],
    // Stop-loss sample from the brief (tracking from 01/05/2026, pause when triggered).
    stopLoss: {
      enabled: true, startDate: '2026-05-01', warnPct: 70,
      cumulativeLoss: { on: true, amount: 60_000_000 },
      consecutiveLoss: { on: true, months: 6 },
      lowHealth: { on: true, below: 50, months: 2 },
      milestones: [{ id: 'm1', on: true, date: '2026-12-31', kind: 'revenue_ratio', value: 80 }],
      triggerCount: 1, action: { type: 'pause', effortPct: 50 },
    },
  },
];

/**
 * Projects without store connectors (no internal staffing → FTE 0, so the sample cost structure above is unchanged).
 * manual: { metricKey: { 'YYYY-MM': value } } — monthly values entered by hand.
 */
SAMPLE_PROJECTS.push(
  {
    // Dự án of the games: no data of its own, figures = Σ Game A + Game B.
    slug: 'game-playables-mau', name: 'ABC Game Studio', color: '#C2410C', kind: 'folder', icon: '🎮', sampleData: false,
    description: 'Các game trên YouTube Playables, iOS và Android', childTemplate: ABC_TEMPLATE, effort: [],
    stopLoss: { ...FOLDER_STOPLOSS_OFF },
  },
  {
    // Child of ABC Game Studio in the "Xây dựng" phase (budget, launch date, manual baselines, budget stop-loss).
    slug: 'game-a', name: 'Game A', color: '#C4302B', productType: 'mobile_app', parent: 'game-playables-mau',
    platforms: ['playables', 'ios', 'android'], phase: 'build', since: '2026-04-01', launchDate: '2027-03-31', buildBudget: 150_000_000, effort: [],
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
    // Dự án of the products Zen Bell + Mindfulness Bell: its figures are their sum.
    slug: 'zell-app', name: 'Zell App', color: '#0369A1', kind: 'folder', icon: '🔔', effort: [], sampleData: false,
    description: 'Ứng dụng chuông thiền Zen Bell và Mindfulness Bell', childTemplate: ZELL_TEMPLATE,
    stopLoss: { ...FOLDER_STOPLOSS_OFF },
  },
  {
    // Growth-phase child of ABC Game Studio; monthly figures entered by hand (spec: 85,9% "Tốt" in 10/2026).
    slug: 'game-b', name: 'Game B', color: '#6B7F2A', productType: 'mobile_app', parent: 'game-playables-mau',
    platforms: ['playables', 'ios', 'android'], phase: 'growth', since: '2026-03-01', effort: [],
    baselines: GAME_B_BASELINES,
    manual: GAME_B_MANUAL,
  }
);

export const DEFAULT_PLATFORMS = ['ios', 'android', 'web', 'blog'];
export const DEFAULT_BASELINES = [
  ['revenue', 100, 30_000_000], ['dau', 80, 5_000], ['downloads', 50, 2_000],
  ['retention_d7', 60, 15], ['store_rating', 40, 4.5],
];

export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Additive column migrations for databases created by earlier versions. */
function migrate(db) {
  const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  if (!has('members', 'is_admin')) db.exec('ALTER TABLE members ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
  if (!has('audit_log', 'actor_user_id')) db.exec('ALTER TABLE audit_log ADD COLUMN actor_user_id INTEGER');
  if (!has('projects', 'launch_date')) db.exec('ALTER TABLE projects ADD COLUMN launch_date TEXT');
  if (!has('projects', 'build_budget')) db.exec('ALTER TABLE projects ADD COLUMN build_budget REAL');
  if (!has('users', 'group_ids')) db.exec("ALTER TABLE users ADD COLUMN group_ids TEXT NOT NULL DEFAULT '[]'");
  if (!has('audit_log', 'group_id')) db.exec('ALTER TABLE audit_log ADD COLUMN group_id INTEGER');
  if (!has('projects', 'child_template')) db.exec('ALTER TABLE projects ADD COLUMN child_template TEXT');
  if (!has('projects', 'score_mode')) db.exec("ALTER TABLE projects ADD COLUMN score_mode TEXT NOT NULL DEFAULT 'children'");
  if (!has('projects', 'sample_data')) db.exec('ALTER TABLE projects ADD COLUMN sample_data INTEGER NOT NULL DEFAULT 1');
  const addKind = !has('projects', 'kind');
  if (addKind) db.exec("ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'project'");
  if (!has('projects', 'description')) db.exec('ALTER TABLE projects ADD COLUMN description TEXT');
  if (!has('projects', 'icon')) db.exec('ALTER TABLE projects ADD COLUMN icon TEXT');
  // Tables whose CHECK / NOT NULL constraints changed are rebuilt (data copied over).
  rebuildIfMissing(db, 'connections', "'youtube'");
  rebuildIfMissing(db, 'config_versions', "'parent_split'");
  rebuildIfMissing(db, 'stoploss_proposals', 'group_id');
  migrateGroupsToParents(db);
  // The sample "Startup mẫu" became "Game A", a build-phase child of ABC Game Studio (same data).
  const startup = db.prepare("SELECT id FROM projects WHERE slug = 'startup-mau' AND name = 'Startup mẫu'").get();
  const abc = db.prepare("SELECT id FROM projects WHERE slug = 'game-playables-mau'").get();
  if (startup && abc) {
    tx(db, () => {
      db.prepare("UPDATE projects SET slug = 'game-a', name = 'Game A', color = '#C4302B', platforms = ? WHERE id = ?")
        .run(JSON.stringify(['playables', 'ios', 'android']), startup.id);
      if (!db.prepare("SELECT 1 FROM config_versions WHERE entity = 'membership' AND entity_id = ?").get(startup.id)) {
        addVersion(db, { entity: 'membership', entityId: startup.id, effectiveDate: BEGINNING, data: { parentId: abc.id }, actor: SYSTEM_ACTOR });
      }
    });
  }
  // Release platforms replace the product type: Playables-only projects get the "playables" platform.
  for (const r of db.prepare("SELECT id, platforms FROM projects WHERE product_type = 'youtube_playables'").all()) {
    const pl = JSON.parse(r.platforms);
    if (!pl.includes('playables')) db.prepare('UPDATE projects SET platforms = ? WHERE id = ?').run(JSON.stringify([...pl, 'playables']), r.id);
  }
  if (addKind) migrateParentsToFolders(db);
  if (!getAppSetting(db, 'du_an_san_pham', false)) migrateProductsNeedProject(db);
  // The app has no notifications any more (no bell): drop the old in-app notification table.
  db.exec('DROP TABLE IF EXISTS notifications');
  // Older projects get the youtube connection row (status "Chưa cấu hình"); a Dự án has no connections.
  db.exec("INSERT OR IGNORE INTO connections (project_id, source) SELECT id, 'youtube' FROM projects WHERE kind = 'project'");
}

/**
 * One-time migration to Dự án: every project that has (or had) children becomes a folder without data of
 * its own. The sample ABC Game Studio's own figures (manual baselines and data, phase, connections) move into a new
 * child "Game B", so they are kept.
 */
function migrateParentsToFolders(db) {
  const actor = 'Hệ thống (nâng cấp: dự án & sản phẩm)';
  const now = new Date().toISOString();
  const parentIds = [...new Set(db.prepare("SELECT data FROM config_versions WHERE entity = 'membership'").all()
    .map((r) => JSON.parse(r.data).parentId).filter((id) => id != null))];
  tx(db, () => {
    for (const id of parentIds) {
      const p = db.prepare("SELECT * FROM projects WHERE id = ? AND kind = 'project'").get(id);
      if (!p) continue;
      db.prepare("UPDATE projects SET kind = 'folder', sample_data = 0 WHERE id = ?").run(id);
      if (p.slug === 'game-playables-mau' && !db.prepare("SELECT 1 FROM projects WHERE slug = 'game-b'").get()) moveOwnDataToChild(db, p, actor, now);
      // The sample folder's stop-loss starts off (its block shows only once enabled).
      if (p.slug === 'game-playables-mau') db.prepare('UPDATE stoploss_policies SET data = ? WHERE project_id = ?').run(JSON.stringify(FOLDER_STOPLOSS_OFF), id);
      db.prepare('DELETE FROM connections WHERE project_id = ?').run(id);
      db.prepare('INSERT INTO audit_log (project_id, actor, at, action, field, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, actor, now, 'Dự án', 'Loại', 'Sản phẩm có sản phẩm khác bên trong', 'Dự án');
    }
  });
}

/**
 * "Dự án" (upper level) and "Sản phẩm" (lower level): every Sản phẩm must belong to a Dự án. Root products get a Dự án
 * "Dự án chung" from the day their history starts; history texts and deleted-product names use the new words.
 */
function migrateProductsNeedProject(db) {
  const actor = 'Hệ thống (nâng cấp: dự án & sản phẩm)';
  const now = new Date().toISOString();
  tx(db, () => {
    const parentOfLatest = (id) => {
      const r = db.prepare("SELECT data FROM config_versions WHERE entity = 'membership' AND entity_id = ? ORDER BY effective_date DESC, seq DESC LIMIT 1").get(id);
      return r ? JSON.parse(r.data).parentId : null;
    };
    const roots = db.prepare("SELECT * FROM projects WHERE kind = 'project' AND deleted_at IS NULL").all().filter((p) => parentOfLatest(p.id) == null);
    if (roots.length) {
      const folder = createProjectRow(db, { slug: `du-an-chung-${Date.now().toString(36)}`, name: 'Dự án chung', color: '#64748B', kind: 'folder', icon: '📁',
        description: 'Tạo khi nâng cấp: sản phẩm chưa thuộc dự án nào', actor });
      addVersion(db, { entity: 'status', entityId: folder, effectiveDate: BEGINNING, data: { status: 'active' }, actor });
      addVersion(db, { entity: 'staffing', entityId: folder, effectiveDate: BEGINNING, data: { rows: [], manualAllocPct: 0 }, actor });
      db.prepare('INSERT OR REPLACE INTO stoploss_policies (project_id, data, updated_at) VALUES (?, ?, ?)').run(folder, JSON.stringify(FOLDER_STOPLOSS_OFF), now);
      for (const p of roots) {
        const since = db.prepare("SELECT MIN(effective_date) AS d FROM config_versions WHERE entity = 'status' AND entity_id = ?").get(p.id).d ?? BEGINNING;
        addVersion(db, { entity: 'membership', entityId: p.id, effectiveDate: since, data: { parentId: folder }, actor });
      }
    }
    db.prepare("UPDATE projects SET name = 'Sản phẩm đã xóa' WHERE kind = 'project' AND deleted_at IS NOT NULL AND name = 'Dự án đã xóa'").run();
    const words = [['Mẫu cho dự án con', 'Mẫu cho sản phẩm mới'], ['Chi phí nhân sự của dự án cha', 'Nhân sự chung của dự án'],
      ['Chia từ nhân sự của dự án cha', 'Chia từ nhân sự chung của dự án'], ['Dự án cha (thư mục)', 'Dự án'], ['Dự án thường', 'Sản phẩm'],
      ['Không có – dự án gốc', '—'], ['dự án cha', 'dự án'], ['Dự án cha', 'Thuộc dự án'], ['dự án con', 'sản phẩm'], ['Dự án con', 'Sản phẩm'],
      ['Kiểu dự án', 'Loại'], ['Giai đoạn dự án', 'Giai đoạn sản phẩm']];
    for (const col of ['action', 'field', 'old_value', 'new_value', 'reason']) {
      for (const [a, b] of words) db.prepare(`UPDATE audit_log SET ${col} = replace(${col}, ?, ?) WHERE ${col} LIKE ?`).run(a, b, `%${a}%`);
    }
    setAppSetting(db, 'du_an_san_pham', true);
  });
}

/** ABC Game Studio → Game B: the parent's own data rows are re-pointed to the new child, its status history copied. */
function moveOwnDataToChild(db, parent, actor, now) {
  const b = Number(db.prepare(`INSERT INTO projects (slug, name, color, product_type, platforms, created_at, kind)
    VALUES ('game-b', 'Game B', '#6B7F2A', 'mobile_app', ?, ?, 'project')`).run(JSON.stringify(['playables', 'ios', 'android']), now).lastInsertRowid);
  for (const t of ['manual_values', 'baseline_configs', 'baseline_sources', 'baseline_versions', 'project_phases', 'metric_daily', 'blog_posts', 'connections', 'promo_sources']) {
    db.prepare(`UPDATE ${t} SET project_id = ? WHERE project_id = ?`).run(b, parent.id);
  }
  db.prepare('INSERT OR REPLACE INTO thresholds (project_id, green, red) SELECT ?, green, red FROM thresholds WHERE project_id = ?').run(b, parent.id);
  const since = db.prepare('SELECT MIN(effective_date) AS d FROM project_phases WHERE project_id = ?').get(b).d ?? BEGINNING;
  for (const v of db.prepare("SELECT * FROM config_versions WHERE entity = 'status' AND entity_id = ? ORDER BY seq").all(parent.id)) {
    addVersion(db, { entity: 'status', entityId: b, effectiveDate: v.effective_date < since ? since : v.effective_date, data: JSON.parse(v.data), actor });
  }
  addVersion(db, { entity: 'staffing', entityId: b, effectiveDate: since, data: { rows: [], manualAllocPct: 0 }, actor });
  addVersion(db, { entity: 'membership', entityId: b, effectiveDate: since, data: { parentId: parent.id }, actor });
  db.prepare('INSERT INTO audit_log (project_id, actor, at, action, field, old_value, new_value, effective_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(b, actor, now, 'Tạo sản phẩm', 'Sản phẩm', '—', `Dữ liệu riêng của ${parent.name} chuyển sang Game B`, since);
}

/** Sample login accounts (created when no user exists): 1 Admin and 3 Viewers with different view scopes. */
export const SAMPLE_USERS = [
  { name: 'Khánh Mai', email: 'khanh.mai@abcdigital.io', role: 'admin' },
  { name: 'Huy Trần', email: 'huy.tran@abcdigital.io', role: 'viewer' },
  { name: 'Quân Đỗ', email: 'quan.do@abcdigital.io', role: 'viewer', scope: 'zen-bell' },     // only the product Zen Bell
  { name: 'Thành Châu', email: 'thanh.chau@abcdigital.io', role: 'viewer', scope: 'zell-app' }, // the Dự án Zell App (all its products)
];

export function seedUsers(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return;
  const ins = db.prepare(`INSERT INTO users (name, email, role, scope, project_ids, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?)`);
  const now = new Date().toISOString();
  const idOf = (slug) => db.prepare('SELECT id FROM projects WHERE slug = ? AND deleted_at IS NULL').get(slug)?.id;
  for (const u of SAMPLE_USERS) {
    const ids = u.scope ? [idOf(u.scope)].filter(Boolean) : [];
    ins.run(u.name, u.email, u.role, u.scope ? 'selected' : 'all', JSON.stringify(ids), now);
  }
}

export function mapUser(r) {
  return r && {
    id: r.id, name: r.name, email: r.email, role: r.role, scope: r.scope, projectIds: JSON.parse(r.project_ids),
    status: r.status, lastLoginAt: r.last_login_at, createdAt: r.created_at, deleted: Boolean(r.deleted_at),
  };
}

/** Recreate `table` from SCHEMA when its stored definition lacks `marker`, copying the shared columns. */
function rebuildIfMissing(db, table, marker) {
  const sql = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table)?.sql ?? '';
  if (!sql || sql.includes(marker)) return;
  const start = SCHEMA.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
  const create = SCHEMA.slice(start, SCHEMA.indexOf('\n);', start) + 3);
  const oldCols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`ALTER TABLE ${table} RENAME TO ${table}_old; ${create}`);
  const newCols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  const cols = oldCols.filter((c) => newCols.includes(c)).join(', ');
  db.exec(`INSERT INTO ${table} (${cols}) SELECT ${cols} FROM ${table}_old; DROP TABLE ${table}_old;`);
  db.exec('PRAGMA foreign_keys = ON');
}

/**
 * One-time migration from "Nhóm dự án" to parent projects: every group becomes a project (its status, shared staff →
 * the project's own staffing + split setting, template, stop-loss policy, history, proposals), memberships point to it,
 * Viewer group scopes become project scopes. The sample "Game Playables (mẫu)" becomes "ABC Game Studio".
 */
function migrateGroupsToParents(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'project_groups'").get()) return;
  const actor = 'Hệ thống (chuyển nhóm → dự án)';
  const map = {};
  db.exec('PRAGMA foreign_keys = OFF');
  tx(db, () => {
    const used = new Set(db.prepare('SELECT slug FROM projects').all().map((r) => r.slug));
    const versions = db.prepare("SELECT * FROM config_versions WHERE entity IN ('group_status', 'group_staffing') ORDER BY seq").all();
    const hasPolicies = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'group_stoploss_policies'").get();
    for (const g of db.prepare('SELECT * FROM project_groups ORDER BY id').all()) {
      if (g.deleted_at) { map[g.id] = null; continue; }
      const tpl = JSON.parse(g.template || '{}');
      const platforms = (tpl.platforms ?? []).filter((x) => ['ios', 'android', 'web', 'playables'].includes(x));
      const pl = platforms.length ? platforms : ['ios', 'android', 'web'];
      let slug = g.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'du-an-cha';
      while (used.has(slug)) slug = `${slug}-cha`;
      used.add(slug);
      const id = createProjectRow(db, { slug, name: g.name, color: g.color,
        productType: pl.includes('playables') && !pl.includes('ios') && !pl.includes('android') ? 'youtube_playables' : 'mobile_app', platforms: pl,
        baselines: tpl.baselines?.length ? tpl.baselines.map((b) => [b.metricKey, b.weight, b.targetMonthly, b.source, b.period]) : DEFAULT_BASELINES,
        thresholds: tpl.thresholds ?? { green: 80, red: 50 }, actor });
      db.prepare('UPDATE projects SET child_template = ?, score_mode = ?, sample_data = 0 WHERE id = ?')
        .run(JSON.stringify(tpl), 'children', id);
      map[g.id] = id;
      const mine = versions.filter((v) => v.entity_id === g.id);
      if (!mine.some((v) => v.entity === 'group_status')) {
        addVersion(db, { entity: 'status', entityId: id, effectiveDate: BEGINNING, data: { status: 'active' }, actor });
      }
      for (const v of mine) {
        const d = JSON.parse(v.data);
        if (v.entity === 'group_status') {
          addVersion(db, { entity: 'status', entityId: id, effectiveDate: v.effective_date, data: { status: d.status === 'deleted' ? 'archived' : d.status }, actor: v.created_by });
        } else {
          addVersion(db, { entity: 'staffing', entityId: id, effectiveDate: v.effective_date, data: { rows: d.rows ?? [], manualAllocPct: 0 }, actor: v.created_by });
          addVersion(db, { entity: 'parent_split', entityId: id, effectiveDate: v.effective_date,
            data: { mode: 'split', method: d.method ?? 'even', manualPct: d.manualPct ?? {} }, actor: v.created_by });
        }
      }
      const policy = hasPolicies && db.prepare('SELECT data FROM group_stoploss_policies WHERE group_id = ?').get(g.id);
      if (policy) db.prepare('INSERT OR REPLACE INTO stoploss_policies (project_id, data, updated_at) VALUES (?, ?, ?)').run(id, policy.data, new Date().toISOString());
      db.prepare('UPDATE audit_log SET project_id = ?, group_id = NULL WHERE group_id = ?').run(id, g.id);
      db.prepare('UPDATE stoploss_proposals SET project_id = ?, group_id = NULL WHERE group_id = ?').run(id, g.id);
      if (g.name === 'Zell App') db.prepare('UPDATE projects SET platforms = ? WHERE id = ?').run(JSON.stringify(['ios', 'android', 'web']), id);
    }
    db.prepare('DELETE FROM stoploss_proposals WHERE group_id IS NOT NULL').run();
    db.prepare("DELETE FROM config_versions WHERE entity IN ('group_status', 'group_staffing')").run();
    for (const v of db.prepare("SELECT seq, data FROM config_versions WHERE entity = 'membership'").all()) {
      const d = JSON.parse(v.data);
      if ('parentId' in d) continue;
      db.prepare('UPDATE config_versions SET data = ? WHERE seq = ?').run(JSON.stringify({ parentId: d.groupId == null ? null : map[d.groupId] ?? null }), v.seq);
    }
    for (const u of db.prepare("SELECT id, project_ids, group_ids FROM users WHERE group_ids != '[]'").all()) {
      const ids = [...new Set([...JSON.parse(u.project_ids), ...JSON.parse(u.group_ids).map((gid) => map[gid]).filter(Boolean)])];
      db.prepare("UPDATE users SET project_ids = ?, group_ids = '[]' WHERE id = ?").run(JSON.stringify(ids), u.id);
    }
    const abc = db.prepare("SELECT id FROM projects WHERE slug = 'game-playables-mau' AND name = 'Game Playables (mẫu)'").get();
    if (abc) {
      db.prepare("UPDATE projects SET name = 'ABC Game Studio', platforms = ?, product_type = 'mobile_app', child_template = COALESCE(child_template, ?) WHERE id = ?")
        .run(JSON.stringify(['playables', 'ios', 'android']), JSON.stringify(ABC_TEMPLATE), abc.id);
    }
    db.exec('DROP TABLE IF EXISTS group_stoploss_policies; DROP TABLE project_groups;');
  });
  db.exec('PRAGMA foreign_keys = ON');
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

/** Seed the sample configuration (spec sections 4–6) when the DB is empty; versions apply to all history. */
/** gameTeam = false → pure kịch bản A (4 members, fixed cost 100.000.000), used to check the what-if numbers A1–A5. */
export function seedSampleConfig(db, { seedConnections, seedStopLoss, gameTeam = true }) {
  if (db.prepare('SELECT COUNT(*) AS n FROM config_versions').get().n > 0) return false;
  tx(db, () => {
    const v = (entity, entityId, data) => addVersion(db, { entity, entityId, effectiveDate: BEGINNING, data, actor: SYSTEM_ACTOR });
    v('team', 0, { fixedMonthlyCost: 100_000_000, workingDays: 21, allocationMode: 'fte', usdVndRate: 26_000 });
    const memberIds = SAMPLE_MEMBERS.map(([name, role, cost]) => {
      const id = Number(db.prepare('INSERT INTO members (name, role, is_admin) VALUES (?, ?, ?)')
        .run(name, role, role === 'Product Manager' ? 1 : 0).lastInsertRowid);
      v('member_cost', id, { monthlyCost: cost });
      return id;
    });
    const ids = {};
    for (const p of SAMPLE_PROJECTS) {
      const since = p.since ?? BEGINNING;
      const projectId = createProjectRow(db, { slug: p.slug, name: p.name, color: p.color, kind: p.kind ?? 'project',
        description: p.description ?? null, icon: p.icon ?? null,
        productType: p.productType ?? 'mobile_app', platforms: p.platforms ?? DEFAULT_PLATFORMS, baselines: p.baselines,
        phase: p.phase ?? 'growth', launchDate: p.launchDate ?? null, buildBudget: p.buildBudget ?? null, since });
      ids[p.slug] = projectId;
      db.prepare('UPDATE projects SET child_template = ?, sample_data = ? WHERE id = ?')
        .run(p.childTemplate ? JSON.stringify(p.childTemplate) : null, p.sampleData === false ? 0 : 1, projectId);
      addVersion(db, { entity: 'status', entityId: projectId, effectiveDate: since, data: { status: 'active' }, actor: SYSTEM_ACTOR });
      addVersion(db, { entity: 'staffing', entityId: projectId, effectiveDate: since, actor: SYSTEM_ACTOR,
        data: { rows: p.effort.map((e, i) => ({ memberId: memberIds[i], effortPct: e })), manualAllocPct: p.effort.length ? 50 : 0 } });
      const insM = db.prepare(`INSERT INTO manual_values (project_id, metric_key, period_type, period_start, value, entered_by, entered_at)
        VALUES (?, ?, 'month', ?, ?, ?, ?)`);
      for (const [key, months] of Object.entries(p.manual ?? {})) {
        for (const [ym, value] of Object.entries(months)) insM.run(projectId, key, `${ym}-01`, value, SYSTEM_ACTOR,
          new Date(Math.min(Date.parse(`${ym}-28T09:00:00Z`), Date.now())).toISOString());
      }
      if (p.kind !== 'folder') seedConnections(projectId, p.slug);
      const policy = p.stopLoss ?? null;
      if (policy || seedStopLoss) seedStopLoss(projectId, policy);
    }
    // "Thuộc dự án": Zell App → Zen Bell, Mindfulness Bell; ABC Game Studio → Game A, Game B.
    for (const p of SAMPLE_PROJECTS.filter((x) => x.parent)) {
      addVersion(db, { entity: 'membership', entityId: ids[p.slug], effectiveDate: p.since ?? BEGINNING, data: { parentId: ids[p.parent] }, actor: SYSTEM_ACTOR });
    }
    if (gameTeam) seedGameStaff(db, ids);
  });
  return true;
}

/**
 * Game team from the day Game A starts (01/04/2026): Võ Nam (Game Developer, 24.000.000) = 100% nhân sự chung of
 * ABC Game Studio (Chia đều → Game A, Game B), Đỗ Vy (Game Artist, 18.000.000) direct: Game A 50%, Game B 30%.
 * The fixed team cost rises to 152.000.000 from that day, so the overhead fund (30.000.000) keeps Zell App's products
 * at the cost of kịch bản A (Zen Bell 51.311.111, Mindfulness Bell 40.688.889, Zell App 92.000.000).
 */
export const GAME_STAFF_SINCE = '2026-04-01';
function seedGameStaff(db, ids) {
  const at = (entity, entityId, data) => addVersion(db, { entity, entityId, effectiveDate: GAME_STAFF_SINCE, data, actor: SYSTEM_ACTOR });
  at('team', 0, { fixedMonthlyCost: 152_000_000, workingDays: 21, allocationMode: 'fte', usdVndRate: 26_000 });
  const member = (name, role, cost) => {
    const id = Number(db.prepare('INSERT INTO members (name, role, is_admin) VALUES (?, ?, 0)').run(name, role).lastInsertRowid);
    at('member_cost', id, { monthlyCost: cost });
    return id;
  };
  const nam = member('Võ Nam', 'Game Developer', 24_000_000);
  const vy = member('Đỗ Vy', 'Game Artist', 18_000_000);
  at('staffing', ids['game-playables-mau'], { rows: [{ memberId: nam, effortPct: 100 }], manualAllocPct: 0 });
  at('parent_split', ids['game-playables-mau'], { method: 'even', manualPct: {} });
  at('staffing', ids['game-a'], { rows: [{ memberId: vy, effortPct: 50 }], manualAllocPct: 0 });
  at('staffing', ids['game-b'], { rows: [{ memberId: vy, effortPct: 30 }], manualAllocPct: 0 });
}

/**
 * baselines: [[key, weight, target, source?, manualPeriod?]]; source defaults to the metric's native source.
 * Baseline sources and the phase are recorded from `since` (the date the project's history starts).
 * kind 'folder' ("Thuộc dự án"): only the row and its thresholds (for the composite score) — no baselines, phase or connections.
 */
export function createProjectRow(db, { slug, name, color, productType = 'mobile_app', platforms = [], baselines = DEFAULT_BASELINES,
  thresholds = { green: 80, red: 50 }, phase = 'growth', launchDate = null, buildBudget = null, since = BEGINNING, actor = SYSTEM_ACTOR,
  kind = 'project', description = null, icon = null }) {
  const folder = kind === 'folder';
  const projectId = Number(db.prepare(`INSERT INTO projects (slug, name, color, product_type, platforms, created_at, launch_date, build_budget,
    kind, description, icon, sample_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(slug, name, color, productType, JSON.stringify(folder ? [] : platforms),
    new Date().toISOString(), folder ? null : launchDate, folder ? null : buildBudget, folder ? 'folder' : 'project', description, icon, folder ? 0 : 1).lastInsertRowid);
  db.prepare('INSERT INTO thresholds (project_id, green, red) VALUES (?, ?, ?)').run(projectId, thresholds.green, thresholds.red);
  if (folder) return projectId;
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
    projects: db.prepare('SELECT id, name, color, kind FROM projects ORDER BY id').all().map((r) => ({ id: r.id, name: r.name, color: r.color, kind: r.kind })),
    revenueOf: monthRevenueLookup(db),
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
    childTemplate: r.child_template ? JSON.parse(r.child_template) : null,
    sampleData: r.sample_data !== 0, kind: r.kind === 'folder' ? 'folder' : 'project', isFolder: r.kind === 'folder',
    description: r.description ?? '', icon: r.icon ?? null };
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

/**
 * Revenue of the calendar month containing `date` (VND): Store proceeds (USD × rate) + Playables ad revenue share
 * (imported rows or the monthly manual value). Used by the "Theo doanh thu thực nhận của kỳ" split; cached per call.
 */
function monthRevenueLookup(db) {
  const cache = new Map();
  const store = db.prepare(`SELECT COALESCE(SUM(value), 0) AS v FROM metric_daily WHERE project_id = ? AND metric_key = 'revenue'
    AND platform IN ('ios', 'android') AND date BETWEEN ? AND ?`);
  const share = db.prepare(`SELECT COALESCE(SUM(value), 0) AS v FROM metric_daily WHERE project_id = ? AND metric_key = 'ad_revenue_share'
    AND date BETWEEN ? AND ?`);
  const manual = db.prepare(`SELECT value FROM manual_values WHERE project_id = ? AND metric_key = 'ad_revenue_share' AND period_type = 'month'
    AND period_start = ? AND replaced_at IS NULL`);
  return (projectId, date) => {
    const ym = date.slice(0, 7);
    const key = `${projectId}|${ym}`;
    if (!cache.has(key)) {
      const from = `${ym}-01`;
      const to = `${ym}-31`;
      const rate = getSettingsAt(db, date).usdVndRate;
      const m = manual.get(projectId, from)?.value;
      cache.set(key, store.get(projectId, from, to).v * rate + (m ?? share.get(projectId, from, to).v));
    }
    return cache.get(key);
  };
}

/** Team settings in force on `date` (cheap single-row lookup used on hot paths like USD conversion). */
export function getSettingsAt(db, date) {
  const r = db.prepare(`SELECT data FROM config_versions WHERE entity = 'team' AND effective_date <= ?
    ORDER BY effective_date DESC, seq DESC LIMIT 1`).get(date);
  return r ? JSON.parse(r.data) : { fixedMonthlyCost: 0, workingDays: 21, allocationMode: 'fte', usdVndRate: 0 };
}
