// Data connections (GA4, App Store Connect, Google Play Console) — simulated checks for the prototype.
// Secrets are encrypted at rest and never returned to the browser.

import { encryptSecret } from '../secrets.js';
import { logChange } from './audit-log.js';

export const SOURCES = {
  ga4: { name: 'Google Analytics 4', fields: ['propertyId'], secretLabel: 'Service account (JSON)' },
  app_store: { name: 'App Store Connect', fields: ['appId', 'issuerId', 'keyId', 'providerToken'], secretLabel: 'Khóa API (.p8)' },
  google_play: { name: 'Google Play Console', fields: ['packageName', 'bucket'], secretLabel: 'Service account (JSON)' },
  youtube: { name: 'YouTube Analytics', fields: ['channelId'], secretLabel: 'OAuth / service account (JSON)' },
};
const FIELD_LABELS = { channelId: 'Channel ID', propertyId: 'Property ID', appId: 'App ID', issuerId: 'Issuer ID', keyId: 'Key ID', providerToken: 'Provider token', packageName: 'Package name', bucket: 'Bucket' };
const STATUS_LABELS = { connected: 'Đã kết nối', error: 'Lỗi', not_configured: 'Chưa cấu hình' };

export function listConnections(db, projectId) {
  const order = Object.keys(SOURCES);
  return db.prepare('SELECT * FROM connections WHERE project_id = ?').all(projectId).map(publicView)
    .sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source));
}

/** Browser-safe view: identifiers + whether a secret exists, never the secret itself. */
function publicView(r) {
  return {
    source: r.source, name: SOURCES[r.source].name, secretLabel: SOURCES[r.source].secretLabel,
    config: JSON.parse(r.config_json), hasSecret: Boolean(r.secret_enc), secretName: r.secret_name,
    status: r.status, message: r.message, syncTime: r.sync_time,
    lastCheckedAt: r.last_checked_at, lastSyncedAt: r.last_synced_at,
  };
}

export function saveConnection(db, key, projectId, source, { config = {}, secret, secretName, syncTime }, actor = null) {
  if (!SOURCES[source]) throw httpError(400, 'Nguồn dữ liệu không hợp lệ');
  const clean = Object.fromEntries(SOURCES[source].fields.map((f) => [f, String(config[f] ?? '').trim()]));
  const row = db.prepare('SELECT * FROM connections WHERE project_id = ? AND source = ?').get(projectId, source);
  const secretEnc = secret ? encryptSecret(key, secret) : row.secret_enc;
  const name = secret ? (secretName || 'secret') : row.secret_name;
  const time = /^\d{2}:\d{2}$/.test(syncTime || '') ? syncTime : row.sync_time;
  db.prepare(`UPDATE connections SET config_json = ?, secret_enc = ?, secret_name = ?, sync_time = ?
    WHERE project_id = ? AND source = ?`).run(JSON.stringify(clean), secretEnc, name, time, projectId, source);
  // Saving re-validates so the status always reflects the stored configuration.
  const result = testConnection(db, projectId, source, { silentIfUnconfigured: true });
  if (actor) {
    const old = JSON.parse(row.config_json);
    const log = (field, o, n) => logChange(db, { projectId, actor, action: `Kết nối ${SOURCES[source].name}`, field, oldValue: o, newValue: n });
    for (const f of SOURCES[source].fields) if ((old[f] ?? '') !== clean[f]) log(FIELD_LABELS[f], old[f] || '—', clean[f] || '—');
    // Never log secret contents — only that the credential file changed.
    if (secret) log(SOURCES[source].secretLabel, row.secret_name || '—', `${name} (đã mã hóa)`);
    if (time !== row.sync_time) log('Lịch đồng bộ hằng ngày', row.sync_time, time);
    if (result.status !== row.status) log('Trạng thái kết nối', STATUS_LABELS[row.status], STATUS_LABELS[result.status]);
  }
  return result;
}

/** Simulated check: validates identifier formats and that a credential file is present. */
export function testConnection(db, projectId, source, { silentIfUnconfigured = false } = {}) {
  const row = db.prepare('SELECT * FROM connections WHERE project_id = ? AND source = ?').get(projectId, source);
  const c = JSON.parse(row.config_json);
  const anyField = Object.values(c).some(Boolean) || row.secret_enc;
  let status = 'connected';
  let message = 'Kết nối thành công (giả lập).';
  if (!anyField) {
    status = 'not_configured';
    message = null;
  } else {
    const problems = [];
    if (source === 'ga4' && !/^\d{6,12}$/.test(c.propertyId || '')) problems.push('Property ID phải là dãy 6–12 chữ số');
    if (source === 'app_store') {
      if (!/^\d{6,12}$/.test(c.appId || '')) problems.push('App ID phải là dãy số');
      if (!/^[0-9a-f-]{36}$/i.test(c.issuerId || '')) problems.push('Issuer ID phải là UUID');
      if (!/^[A-Z0-9]{10}$/.test(c.keyId || '')) problems.push('Key ID gồm 10 ký tự chữ hoa/số');
      if (c.providerToken && !/^\d{5,12}$/.test(c.providerToken)) problems.push('Provider token phải là dãy số');
    }
    if (source === 'google_play') {
      if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(c.packageName || '')) problems.push('Package name không hợp lệ');
      if (!/^(gs:\/\/)?pubsite_prod_/.test(c.bucket || '')) problems.push('Bucket phải có dạng gs://pubsite_prod_…');
    }
    if (source === 'youtube' && !/^UC[\w-]{22}$/.test(c.channelId || '')) problems.push('Channel ID có dạng UC + 22 ký tự');
    if (!row.secret_enc) problems.push(`Thiếu ${SOURCES[source].secretLabel}`);
    if (problems.length) {
      status = 'error';
      message = problems.join(' · ');
    }
  }
  if (silentIfUnconfigured && status === 'not_configured') message = null;
  db.prepare('UPDATE connections SET status = ?, message = ?, last_checked_at = ? WHERE project_id = ? AND source = ?')
    .run(status, message, new Date().toISOString(), projectId, source);
  return listConnections(db, projectId).find((x) => x.source === source);
}

/** Simulated sync: only connected sources can sync; records the sync time. */
export function syncConnection(db, projectId, source, { archived = false } = {}) {
  if (archived) throw httpError(409, 'Dự án đã lưu trữ: ngừng đồng bộ dữ liệu.');
  const row = db.prepare('SELECT status FROM connections WHERE project_id = ? AND source = ?').get(projectId, source);
  if (row.status !== 'connected') throw httpError(409, 'Chỉ đồng bộ được khi kết nối ở trạng thái "Đã kết nối".');
  db.prepare('UPDATE connections SET last_synced_at = ?, message = ? WHERE project_id = ? AND source = ?')
    .run(new Date().toISOString(), 'Đồng bộ xong (giả lập).', projectId, source);
  return listConnections(db, projectId).find((x) => x.source === source);
}

/** Seed demo connection states for the sample projects. */
export function seedDemoConnections(db, key, projectId, slug) {
  const now = new Date();
  const synced = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 6, 0).toISOString();
  const demoSecret = encryptSecret(key, '{"type":"service_account","note":"demo credential"}');
  const set = (source, config, status, message, secretName) => db.prepare(`UPDATE connections SET config_json = ?,
    secret_enc = ?, secret_name = ?, status = ?, message = ?, last_checked_at = ?, last_synced_at = ?
    WHERE project_id = ? AND source = ?`).run(JSON.stringify(config), secretName ? demoSecret : null, secretName ?? null,
    status, message, synced, status === 'connected' ? synced : null, projectId, source);
  if (slug === 'game-b') {
    set('ga4', { propertyId: '455667788' }, 'connected', 'Kết nối thành công (giả lập).', 'game-b-ga4.json');
    set('youtube', { channelId: 'UCx9GameBDemo00000000000' }, 'connected', 'Kết nối thành công (giả lập).', 'game-b-youtube.json');
  } else if (slug === 'game-a') {
    set('ga4', { propertyId: '466778899' }, 'connected', 'Kết nối thành công (giả lập).', 'game-a-ga4.json');
  } else if (slug === 'du-an-test-1') {
    // Test-only configuration (calculation tests).
    set('ga4', { propertyId: '412345678' }, 'connected', 'Kết nối thành công (giả lập).', 'test-1-ga4.json');
    set('app_store', { appId: '1488123456', issuerId: '69a6de7f-1c2e-47e3-e053-5b8c7c11a4d1', keyId: 'ZB2X7K9Q4M', providerToken: '118203450' },
      'connected', 'Kết nối thành công (giả lập).', 'AuthKey_ZB2X7K9Q4M.p8');
    set('google_play', { packageName: 'io.abcdigital.test1', bucket: 'gs://pubsite_prod_rev_01234567890987654321' },
      'connected', 'Kết nối thành công (giả lập).', 'test-1-play.json');
  } else if (slug === 'du-an-test-2') {
    set('ga4', { propertyId: '398765432' }, 'connected', 'Kết nối thành công (giả lập).', 'test-2-ga4.json');
    set('app_store', { appId: '1522334455', issuerId: '57246542-96fe-1a63-e053-0824d011072a', keyId: 'mb-key' },
      'error', 'Key ID gồm 10 ký tự chữ hoa/số', 'AuthKey_t2.p8');
  }
}

export function httpError(status, message, details) {
  return Object.assign(new Error(message), { status, details });
}
