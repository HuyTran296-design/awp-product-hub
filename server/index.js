// AWP Product Hub — HTTP server (node:http, no dependencies).
// Usage: node server/index.js [--reset] [--no-listen]   env: PORT (default 4310), AWP_DB, AWP_SECRET_KEY,
//   AWP_SCENARIO=A (a new database gets pure kịch bản A: no game team, fixed cost 100.000.000),
//   AWP_DB=:memory: (no file: the sample data is seeded on every start — used on Vercel), AWP_SESSION_SECRET

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getUser } from './auth.js';
import { runWithUser } from './request-context.js';
import { buildUserRoutes } from './user-routes.js';
import { buildDataRoutes } from './data-routes.js';
import { buildRoutes } from './api-routes.js';
import { buildProjectRoutes } from './project-routes.js';
import { buildStopLossRoutes } from './stoploss-routes.js';
import { initPolicy, StopLossService } from './services/stoploss-service.js';
import { getProject, getSettingsAt, listProjects, openDatabase, seedSampleConfig, seedUsers } from './database.js';
import { todayIso } from './clock.js';
import { MockDataSource } from './data-sources/mock-data-source.js';
import { loadSecretKey } from './secrets.js';
import { MetricService } from './services/metric-service.js';
import { ManualDataService } from './services/manual-data-service.js';
import { ReportService } from './services/report-service.js';
import { seedDemoConnections } from './services/connection-service.js';
import { seedPromoSources } from './services/promo-source-service.js';
import { TargetReferenceService } from './services/target-reference-service.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_DIRS = { '/shared/': path.join(ROOT, 'shared'), '/': path.join(ROOT, 'public') };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

/** Build the app (DB, data source, routes). Exported for tests. */
export function createApp({ dbFile = process.env.AWP_DB || path.join(ROOT, 'data', 'awp-hub.db'), reset = false, scenario = process.env.AWP_SCENARIO } = {}) {
  const inMemory = dbFile === ':memory:';
  if (reset && !inMemory) for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(f, { force: true });
  const db = openDatabase(dbFile);
  const secretKey = loadSecretKey(inMemory ? null : path.dirname(dbFile));
  seedSampleConfig(db, {
    seedConnections: (id, slug) => seedDemoConnections(db, secretKey, id, slug),
    seedStopLoss: (id, policy) => initPolicy(db, id, policy),
    gameTeam: String(scenario ?? '').toUpperCase() !== 'A',
  });
  seedUsers(db);
  seedPromoSources(db);
  const dataSource = new MockDataSource(db);
  dataSource.ensureFresh(listProjects(db));
  const manual = new ManualDataService(db);
  // A Store connection that is not set up feeds no revenue: that platform does not hold back the product's Doanh thu.
  const storeConnected = db.prepare("SELECT 1 FROM connections WHERE project_id = ? AND source = ? AND status <> 'not_configured'");
  const metrics = new MetricService(dataSource, () => getSettingsAt(db, todayIso()).usdVndRate, manual,
    (projectId) => getProject(db, projectId)?.platforms ?? null,
    (projectId, platform) => Boolean(storeConnected.get(projectId, { ios: 'app_store', android: 'google_play' }[platform] ?? platform)));
  const reports = new ReportService({ db, dataSource, metrics, manual });
  const stopLoss = new StopLossService({ db, metrics, dataSource, manual });
  const targets = new TargetReferenceService({ db, metrics, manual });
  const routes = [...buildRoutes({ db, reports }), ...buildProjectRoutes({ db, reports, dataSource, secretKey, manual, targets }),
    ...buildStopLossRoutes({ db, stopLoss }), ...buildUserRoutes({ db }), ...buildDataRoutes({ db, manual })].map(([method, pattern, handler, access]) => ({
    method, handler, access,
    regex: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`),
  }));
  return { db, dataSource, stopLoss, manual, handler: (req, res) => handle(req, res, routes, db) };
}

async function handle(req, res, routes, db) {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);
  const route = routes.find((r) => r.method === req.method && r.regex.test(url.pathname));
  if (!route) return send(res, 404, { error: 'Không tìm thấy' });
  try {
    const user = getUser(req, db);
    if (route.access !== 'public' && !user) return send(res, 401, { error: 'Vui lòng đăng nhập' });
    if (route.access === 'admin' && user.role !== 'admin') return send(res, 403, { error: 'Bạn không có quyền truy cập' });
    const body = ['POST', 'PUT', 'DELETE'].includes(req.method) ? await readJson(req) : {};
    const result = await runWithUser(user, () => route.handler({
      req, user, body, params: url.pathname.match(route.regex).groups || {},
      query: Object.fromEntries(url.searchParams), origin: `${req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${req.headers.host}`,
    }));
    if (result && result.raw != null) {
      res.writeHead(200, { 'Content-Type': result.contentType, 'Content-Disposition': `attachment; filename="${result.filename}"` });
      return res.end(result.raw);
    }
    if (result && result.status && result.body !== undefined) return send(res, result.status, result.body, result.headers);
    return send(res, 200, result);
  } catch (err) {
    if (!err.status) console.error(err);
    return send(res, err.status || 500, { error: err.status ? err.message : 'Lỗi máy chủ', details: err.details });
  }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) reject(Object.assign(new Error('Dữ liệu gửi lên quá lớn'), { status: 413 }));
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(Object.assign(new Error('JSON không hợp lệ'), { status: 400 })); }
    });
  });
}

function serveStatic(pathname, res) {
  const prefix = Object.keys(STATIC_DIRS).find((p) => pathname.startsWith(p));
  const base = STATIC_DIRS[prefix];
  let file = path.join(base, decodeURIComponent(pathname.slice(prefix.length)) || 'index.html');
  if (!file.startsWith(base)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(STATIC_DIRS['/'], 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const app = createApp({ reset: process.argv.includes('--reset') });
  if (process.argv.includes('--no-listen')) {
    console.log('Database ready.');
  } else {
    const port = Number(process.env.PORT) || 4310;
    http.createServer(app.handler).listen(port, () => console.log(`AWP Product Hub: http://localhost:${port}`));
  }
}
