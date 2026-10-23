// Spins up the app on a temporary database seeded with the sample configuration.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../server/index.js';

/** scenario 'A' → pure kịch bản A (no game team), for the what-if numbers A1–A5. */
export async function startTestServer({ scenario = null } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awp-hub-'));
  const app = createApp({ dbFile: path.join(tmp, 'test.db'), scenario: scenario ?? '' });
  const server = http.createServer(app.handler);
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const cookies = {};
  for (const [account, email] of Object.entries(SAMPLE_ACCOUNTS)) {
    const res = await fetch(`${base}/api/session`, { method: 'POST', body: JSON.stringify({ email }) });
    cookies[account] = res.headers.get('set-cookie').split(';')[0];
  }
  const api = async (account, method, url, body) => {
    const res = await fetch(base + url, { method, headers: { cookie: cookies[account] }, body: body ? JSON.stringify(body) : undefined });
    const renewed = res.headers.get('set-cookie'); // the session cookie changes like in a browser (e.g. "Xem với vai trò…")
    if (renewed) cookies[account] = renewed.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
  const stop = () => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); };
  /** Sign in as any email; returns the cookie or the error response. */
  const login = async (email) => {
    const res = await fetch(`${base}/api/session`, { method: 'POST', body: JSON.stringify({ email }) });
    return res.ok ? res.headers.get('set-cookie').split(';')[0] : { status: res.status, error: (await res.json()).error };
  };
  const apiAs = async (cookie, method, url, body) => {
    const res = await fetch(base + url, { method, headers: { cookie }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json() };
  };
  return { api, stop, login, apiAs, app, base, cookies };
}

/** Sample login accounts (seeded): Admin, Viewer (all), Viewer limited to Zen Bell, Viewer of the Dự án Zell App. */
export const SAMPLE_ACCOUNTS = {
  admin: 'khanh.mai@abcdigital.io',
  viewer: 'huy.tran@abcdigital.io',
  viewerZen: 'quan.do@abcdigital.io',
  viewerZell: 'thanh.chau@abcdigital.io',
};

export function nextMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Product rows of the Chi phí team tree (Dự án rows replaced by their products), plus "Sản phẩm đã xóa". */
export function productRows(table) {
  return table.tree.flatMap((g) => (g.isFolder ? g.children : [g]));
}
