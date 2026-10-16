// Kênh "Promote từ nền tảng khác": 4 sample sources of Zen Bell, parent row = exact sum, tracking links, admin-only CRUD.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestPromoCode } from '../shared/promo-links.js';
import { startTestServer } from './helpers/test-server.js';

const zenId = async (t) => (await t.api('admin', 'GET', '/api/meta')).data.projects.find((p) => p.name === 'Zen Bell').id;

test('Zen Bell: promote row above store search, 4 children summing exactly to the parent', async () => {
  const t = await startTestServer();
  try {
    const id = await zenId(t);
    for (const period of ['month', 'quarter', 'week']) {
      const { channels, channelTotal } = (await t.api('admin', 'GET', `/api/projects/${id}/marketing?period=${period}`)).data;
      const keys = channels.map((c) => c.key);
      assert.equal(keys.indexOf('promote') + 1, keys.indexOf('store_search'));
      const promo = channels.find((c) => c.key === 'promote');
      assert.equal(promo.name, 'Promote từ nền tảng khác');
      assert.deepEqual(promo.children.map((c) => c.name),
        ['Mindfulness Bell', 'Từ game trên YouTube Playables', 'Từ TikTok', 'Từ đối tác / website khác']);
      assert.equal(promo.children[0].note, 'cross-promote trong Zell App');
      for (const k of ['clicks', 'ios', 'android', 'total']) assert.equal(promo.children.reduce((a, c) => a + c[k], 0), promo[k], k);
      assert.ok(promo.total > 0);
      assert.equal(channels.reduce((a, c) => a + c.total, 0), channelTotal);
      const shareSum = promo.children.reduce((a, c) => a + c.share, 0);
      assert.ok(Math.abs(shareSum - promo.share) < 1e-9);
    }
  } finally { t.stop(); }
});

test('Thêm nguồn "Từ Facebook Group" → 3 tracking links; validation; Viewer cannot manage', async () => {
  const t = await startTestServer();
  try {
    const id = await zenId(t);
    const r = await t.api('admin', 'POST', `/api/projects/${id}/promo-sources`, { name: 'Từ Facebook Group', code: 'promo_fb_group' });
    assert.equal(r.status, 200);
    const links = Object.fromEntries(r.data.source.links.map((l) => [l.key, l.url]));
    assert.deepEqual(Object.keys(links), ['web', 'ios', 'android']);
    assert.match(links.web, /utm_source=promo_fb_group&utm_medium=promote/);
    assert.match(links.ios, /^https:\/\/apps\.apple\.com\/app\/apple-store\/id1488123456\?pt=118203450&ct=promo_fb_group&mt=8$/);
    assert.match(links.android, /id=io\.abcdigital\.zenbell&referrer=utm_source%3Dpromo_fb_group%26utm_medium%3Dpromote/);
    assert.equal((await t.api('admin', 'POST', `/api/projects/${id}/promo-sources`, { name: 'Trùng', code: 'promo_fb_group' })).status, 422);
    assert.equal((await t.api('admin', 'POST', `/api/projects/${id}/promo-sources`, { name: 'X', code: 'Bad Code' })).status, 422);
    const promo = (await t.api('admin', 'GET', `/api/projects/${id}/marketing?period=month`)).data.channels.find((c) => c.key === 'promote');
    const fb = promo.children.find((c) => c.code === 'promo_fb_group');
    assert.equal(fb.total, 0); // new link: no data yet
    assert.equal(promo.children.length, 5);
    // Picked from another project: shows that project's name.
    const other = (await t.api('admin', 'GET', `/api/projects/${id}/promo-sources`)).data.projects.find((p) => p.name === 'ABC Game Studio');
    const up = await t.api('admin', 'PUT', `/api/projects/${id}/promo-sources/${fb.id}`, { code: 'promo_fb_group', sourceProjectId: other.id });
    assert.equal(up.data.source.name, 'ABC Game Studio');
    assert.equal((await t.api('admin', 'DELETE', `/api/projects/${id}/promo-sources/${fb.id}`)).status, 200);
    assert.equal((await t.api('viewer', 'GET', `/api/projects/${id}/promo-sources`)).status, 403);
    assert.equal((await t.api('viewer', 'POST', `/api/projects/${id}/promo-sources`, { name: 'A', code: 'promo_aaa' })).status, 403);
  } finally { t.stop(); }
});

test('suggestPromoCode strips diacritics and the "Từ" prefix', () => {
  assert.equal(suggestPromoCode('Từ Facebook Group'), 'promo_facebook_group');
  assert.equal(suggestPromoCode('Mindfulness Bell'), 'promo_mindfulness_bell');
  assert.equal(suggestPromoCode('Đối tác Việt'), 'promo_doi_tac_viet');
});
