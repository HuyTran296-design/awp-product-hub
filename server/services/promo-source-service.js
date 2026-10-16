// "Nguồn promote" of a project: sub-sources of the acquisition channel "Promote từ nền tảng khác".
// A source picked from another project in the system shows that project's current name.

import { getProject, loadTimeline } from '../database.js';
import { todayIso } from '../clock.js';
import { PROMO_CODE_RE, promoLinks } from '../../shared/promo-links.js';
import { logChange } from './audit-log.js';
import { httpError } from './connection-service.js';
import { parentOf } from './parent-service.js';

const parentOfProject = (db, id) => parentOf(loadTimeline(db), id, todayIso());

const ACTION = 'Nguồn promote';

export function listPromoSources(db, projectId) {
  const project = getProject(db, projectId);
  const conn = (source) => JSON.parse(db.prepare('SELECT config_json FROM connections WHERE project_id = ? AND source = ?').get(projectId, source)?.config_json ?? '{}');
  const linkCtx = { slug: project.slug, platforms: project.platforms, ...conn('app_store'), packageName: conn('google_play').packageName };
  const ownParent = parentOfProject(db, projectId);
  return db.prepare('SELECT * FROM promo_sources WHERE project_id = ? ORDER BY sort, id').all(projectId).map((r) => {
    const src = r.source_project_id ? getProject(db, r.source_project_id) : null;
    const srcParent = src ? parentOfProject(db, src.id) : null;
    return {
      id: r.id, code: r.code, sourceProjectId: r.source_project_id, customName: r.name,
      name: src ? src.name : r.name,
      note: src ? (srcParent && srcParent === ownParent ? `cross-promote trong ${getProject(db, srcParent)?.name}` : 'sản phẩm khác trong hệ thống') : null,
      links: promoLinks(linkCtx, r.code),
    };
  });
}

function clean(db, projectId, body, id = null) {
  const code = String(body.code ?? '').trim();
  const sourceProjectId = body.sourceProjectId ? Number(body.sourceProjectId) : null;
  const src = sourceProjectId ? getProject(db, sourceProjectId) : null;
  if (sourceProjectId && (!src || src.deleted || src.id === projectId)) throw httpError(422, 'Sản phẩm nguồn không hợp lệ.');
  const name = src ? src.name : String(body.name ?? '').trim();
  const errors = {};
  if (!name) errors.name = 'Nhập tên nguồn.';
  if (name.length > 80) errors.name = 'Tên nguồn tối đa 80 ký tự.';
  if (!PROMO_CODE_RE.test(code)) errors.code = 'Mã nguồn gồm 3–40 ký tự chữ thường, số hoặc "_" (ví dụ promo_fb_group).';
  else if (db.prepare('SELECT 1 FROM promo_sources WHERE project_id = ? AND code = ? AND id IS NOT ?').get(projectId, code, id)) errors.code = 'Mã nguồn đã được dùng trong sản phẩm này.';
  if (Object.keys(errors).length) throw httpError(422, Object.values(errors)[0], { fields: errors });
  return { name, code, sourceProjectId };
}

export function createPromoSource(db, projectId, body, actor) {
  const v = clean(db, projectId, body);
  const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM promo_sources WHERE project_id = ?').get(projectId).n;
  const id = Number(db.prepare('INSERT INTO promo_sources (project_id, name, code, source_project_id, sort, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(projectId, v.name, v.code, v.sourceProjectId, sort, new Date().toISOString()).lastInsertRowid);
  logChange(db, { projectId, actor, action: ACTION, field: 'Thêm nguồn', newValue: `${v.name} (${v.code})` });
  return listPromoSources(db, projectId).find((s) => s.id === id);
}

export function updatePromoSource(db, projectId, id, body, actor) {
  const row = db.prepare('SELECT * FROM promo_sources WHERE id = ? AND project_id = ?').get(id, projectId);
  if (!row) throw httpError(404, 'Không tìm thấy nguồn promote');
  const v = clean(db, projectId, body, id);
  db.prepare('UPDATE promo_sources SET name = ?, code = ?, source_project_id = ? WHERE id = ?').run(v.name, v.code, v.sourceProjectId, id);
  if (row.name !== v.name) logChange(db, { projectId, actor, action: ACTION, field: 'Tên nguồn', oldValue: row.name, newValue: v.name });
  if (row.code !== v.code) logChange(db, { projectId, actor, action: ACTION, field: `Mã nguồn (${v.name})`, oldValue: row.code, newValue: v.code });
  return listPromoSources(db, projectId).find((s) => s.id === id);
}

export function deletePromoSource(db, projectId, id, actor) {
  const row = db.prepare('SELECT * FROM promo_sources WHERE id = ? AND project_id = ?').get(id, projectId);
  if (!row) throw httpError(404, 'Không tìm thấy nguồn promote');
  db.prepare('DELETE FROM promo_sources WHERE id = ?').run(id);
  logChange(db, { projectId, actor, action: ACTION, field: 'Xóa nguồn', oldValue: `${row.name} (${row.code})` });
}

/** Sample sources of Zen Bell (once per database, also for databases created before this feature). */
export function seedPromoSources(db) {
  if (db.prepare("SELECT 1 FROM app_settings WHERE key = 'promo_sources_seeded'").get()) return;
  const id = (slug) => db.prepare('SELECT id FROM projects WHERE slug = ? AND deleted_at IS NULL').get(slug)?.id ?? null;
  const zen = id('zen-bell');
  if (zen) {
    const ins = db.prepare('INSERT OR IGNORE INTO promo_sources (project_id, name, code, source_project_id, sort, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    const now = new Date().toISOString();
    [['Mindfulness Bell', 'promo_mindfulness_bell', id('mindfulness-bell')], ['Từ game trên YouTube Playables', 'promo_playables', null],
      ['Từ TikTok', 'promo_tiktok', null], ['Từ đối tác / website khác', 'promo_partners', null]]
      .forEach(([name, code, src], i) => ins.run(zen, name, code, src, i + 1, now));
  }
  db.prepare("INSERT INTO app_settings (key, value) VALUES ('promo_sources_seeded', 'true')").run();
}
