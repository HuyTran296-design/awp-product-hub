// Data connection forms (GA4, App Store Connect, Google Play Console).
// mode 'live': each form saves/tests/syncs through the API (edit page).
// mode 'collect': values are only gathered and submitted with the wizard.
// Credential files are read in the browser and sent once; the server never returns them.

import { post, put } from '../api.js';
import { esc, toast } from '../ui.js';
import { formatDateTime } from '/shared/format.js';

const FIELDS = {
  ga4: [['propertyId', 'Property ID', '412345678']],
  app_store: [['appId', 'App ID', '1488123456'], ['issuerId', 'Issuer ID', 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'], ['keyId', 'Key ID', 'ABCDE12345'], ['providerToken', 'Provider token (cho campaign link, không bắt buộc)', '118203450']],
  google_play: [['packageName', 'Package name', 'io.abcdigital.app'], ['bucket', 'Cloud Storage bucket chứa báo cáo', 'gs://pubsite_prod_rev_…']],
  youtube: [['channelId', 'Channel ID', 'UCxxxxxxxxxxxxxxxxxxxxxx']],
};
const META = {
  ga4: { name: 'Google Analytics 4', sub: 'Xác thực bằng service account', secretLabel: 'Service account (JSON)', accept: '.json,application/json' },
  app_store: { name: 'App Store Connect', sub: 'App Store Connect API key', secretLabel: 'Khóa API (.p8)', accept: '.p8' },
  google_play: { name: 'Google Play Console', sub: 'Báo cáo từ Cloud Storage + service account', secretLabel: 'Service account (JSON)', accept: '.json,application/json' },
  youtube: { name: 'YouTube Analytics', sub: 'Kênh YouTube: lượt xem, thời gian xem, người đăng ký mới (dùng cho Marketing)', secretLabel: 'OAuth / service account (JSON)', accept: '.json,application/json' },
};
const STATUS = { connected: ['green', '● Đã kết nối'], error: ['red', '■ Lỗi'], not_configured: ['neutral', '○ Chưa cấu hình'] };
export const SOURCE_ORDER = ['ga4', 'app_store', 'google_play', 'youtube'];

export function createConnectionForms(el, { mode, projectId, connections = [], archived = false, onChange, sources = SOURCE_ORDER }) {
  // Only the connectors of the selected release platforms are shown.
  let conns = SOURCE_ORDER.filter((s) => sources.includes(s)).map((s) => connections.find((c) => c.source === s)
    ?? { source: s, config: {}, hasSecret: false, status: 'not_configured', syncTime: '06:00' });
  const collected = {}; // wizard values per source
  const dirty = new Set();

  const card = (c) => {
    const meta = META[c.source];
    const [cls, label] = STATUS[c.status];
    const live = mode === 'live';
    const secretNote = collected[c.source]?.secretName
      ? `Sẽ lưu: ${esc(collected[c.source].secretName)} (mã hóa phía server)`
      : c.hasSecret ? `🔒 Đã lưu: ${esc(c.secretName)} — chọn tệp mới để thay thế` : 'Chưa có tệp khóa';
    return `<form class="card stack" data-source="${c.source}" style="gap:12px">
      <div class="card-head" style="margin:0"><div><h2>${meta.name}</h2><div class="sub">${meta.sub}</div></div>
        ${live ? `<span class="badge ${cls}">${label}</span>` : ''}</div>
      ${live && c.message ? `<div class="alert ${c.status === 'error' ? 'error' : 'info'}" style="padding:8px 12px">${esc(c.message)}</div>` : ''}
      ${FIELDS[c.source].map(([k, l, ph]) => `<label class="field"><span>${l}</span>
        <input class="input" name="${k}" value="${esc(collected[c.source]?.config[k] ?? c.config[k] ?? '')}" placeholder="${esc(ph)}" autocomplete="off" spellcheck="false"></label>`).join('')}
      <label class="field"><span>${meta.secretLabel}</span>
        <input class="input" type="file" name="secret" accept="${meta.accept}">
        <span class="secret-note">${secretNote}</span></label>
      <label class="field"><span>Đồng bộ hằng ngày lúc</span><input class="input" type="time" name="syncTime" value="${esc(collected[c.source]?.syncTime ?? c.syncTime)}" style="max-width:140px"></label>
      ${live ? `<div class="small muted">Kiểm tra lần cuối: ${formatDateTime(c.lastCheckedAt)} · Đồng bộ lần cuối: ${formatDateTime(c.lastSyncedAt)}</div>
      <div class="conn-actions">
        <button type="submit" class="btn primary sm">Lưu</button>
        <button type="button" class="btn sm" data-test>Kiểm tra kết nối</button>
        <button type="button" class="btn sm" data-sync ${c.status === 'connected' && !archived ? '' : `disabled title="${archived ? 'Sản phẩm đã lưu trữ: ngừng đồng bộ' : 'Cần kết nối thành công trước'}"`}>Đồng bộ ngay</button>
      </div>` : '<div class="note">Không bắt buộc — có thể cấu hình sau trong trang chỉnh sửa sản phẩm.</div>'}
    </form>`;
  };

  const draw = () => {
    el.innerHTML = `<div class="alert info" style="margin-bottom:14px">🔒 Khóa bí mật (.p8, JSON service account) chỉ lưu phía server, mã hóa AES-256-GCM, không bao giờ gửi xuống trình duyệt.${mode === 'live' ? ' Bản prototype: kiểm tra & đồng bộ là giả lập.' : ''}</div>
      <div class="conn-grid">${conns.map(card).join('') || '<div class="empty">Chọn nền tảng phát hành để hiện các kết nối tương ứng.</div>'}</div>`;
    bind();
  };

  const readForm = async (form) => {
    const fd = new FormData(form);
    const source = form.dataset.source;
    const body = { config: Object.fromEntries(FIELDS[source].map(([k]) => [k, fd.get(k)])), syncTime: fd.get('syncTime') };
    const file = fd.get('secret');
    if (file && file.size) {
      if (file.size > 20000) throw new Error('Tệp khóa quá lớn.');
      body.secret = await file.text();
      body.secretName = file.name;
    } else if (collected[source]?.secret) {
      body.secret = collected[source].secret;
      body.secretName = collected[source].secretName;
    }
    return body;
  };

  const replace = (conn) => {
    conns = conns.map((c) => (c.source === conn.source ? conn : c));
    dirty.delete(conn.source);
    draw();
    onChange?.();
  };

  const bind = () => {
    el.querySelectorAll('form[data-source]').forEach((form) => {
      const source = form.dataset.source;
      form.addEventListener('input', async () => {
        if (mode === 'collect') collected[source] = await readForm(form);
        else dirty.add(source);
        onChange?.();
      });
      form.addEventListener('change', async (e) => {
        if (e.target.name !== 'secret') return;
        if (mode === 'collect') { collected[source] = await readForm(form); draw(); } else dirty.add(source);
        onChange?.();
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (mode !== 'live') return;
        try {
          const { connection } = await put(`/api/projects/${projectId}/connections/${source}`, await readForm(form));
          toast(`Đã lưu ${META[source].name}.`);
          replace(connection);
        } catch (err) { toast(err.message, 'error'); }
      });
      form.querySelector('[data-test]')?.addEventListener('click', async () => {
        try {
          const { connection } = await post(`/api/projects/${projectId}/connections/${source}/test`);
          toast(connection.status === 'connected' ? 'Kết nối thành công (giả lập).' : `Kết nối lỗi: ${connection.message ?? 'chưa cấu hình'}`,
            connection.status === 'connected' ? 'info' : 'error');
          conns = conns.map((c) => (c.source === source ? connection : c));
          draw();
        } catch (err) { toast(err.message, 'error'); }
      });
      form.querySelector('[data-sync]')?.addEventListener('click', async () => {
        try {
          const { connection } = await post(`/api/projects/${projectId}/connections/${source}/sync`);
          toast('Đã đồng bộ (giả lập).');
          conns = conns.map((c) => (c.source === source ? connection : c));
          draw();
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  };

  draw();
  return {
    getValue: () => ({ ...collected }),
    isDirty: () => (mode === 'live' ? dirty.size > 0 : Object.keys(collected).length > 0),
    summary: () => conns.map((c) => c.source).map((s) => {
      const v = collected[s];
      return { name: META[s].name, configured: Boolean(v && (Object.values(v.config).some(Boolean) || v.secret)) };
    }),
  };
}
