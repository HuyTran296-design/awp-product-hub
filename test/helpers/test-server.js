// Spins up the app on a temporary database seeded with the sample configuration.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../../server/index.js';

/** scenario 'A' → the test-only configuration of the calculation tests (Dự án Test 1 / Test 2); default = demo data. */
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

/** Sample login accounts (seeded): Admin, Viewer (all projects), Viewer of Game B, Viewer of Game A. */
export const SAMPLE_ACCOUNTS = {
  admin: 'khanh.mai@abcdigital.io',
  viewer: 'huy.tran@abcdigital.io',
  viewerGameB: 'quan.do@abcdigital.io',
  viewerGameA: 'thanh.chau@abcdigital.io',
};

export function nextMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/**
 * "Phân bổ chi phí" of the current month is provisional (cost × working days elapsed ÷ 21): scale a /api/team-costs
 * payload back to the full month so allocation tests can check monthly figures. Other months are returned as is.
 */
export function fullMonth(data) {
  const k = data.monthState?.factor;
  if (!k || k === 1) return data;
  const s = (v) => (v == null ? v : Math.round((v / k) * 1e6) / 1e6); // undo × k without float drift
  const t = data.table;
  return { ...data, table: { ...t,
    teamTotal: s(t.teamTotal), payrollTotal: s(t.payrollTotal), toolsTotal: s(t.toolsTotal),
    unallocatedSalary: s(t.unallocatedSalary), unallocatedTools: s(t.unallocatedTools),
    rows: t.rows.map((r) => ({ ...r, salary: s(r.salary), tools: s(r.tools), total: s(r.total),
      detail: r.detail && { members: r.detail.members.map((m) => ({ ...m, monthly: s(m.monthly) })),
        tools: r.detail.tools.map((x) => ({ ...x, amount: s(x.amount) })) } })) } };
}
