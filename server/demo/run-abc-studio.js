// npm run demo:abc-studio — applies the "ABC Game Studio" scenario to the local database (from the first open month).
// Adds the product Game C to the Dự án ABC Game Studio (kịch bản C).

import http from 'node:http';
import { createApp } from '../index.js';
import { firstOpenDate } from '../services/project-service.js';
import { applyAbcStudioScenario } from './abc-studio-scenario.js';

const app = createApp();
const server = http.createServer(app.handler);
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const login = await fetch(`${base}/api/session`, { method: 'POST', body: JSON.stringify({ email: 'khanh.mai@abcdigital.io' }) });
const cookie = login.headers.get('set-cookie').split(';')[0];
const call = async (method, url, body) => {
  const res = await fetch(base + url, { method, headers: { cookie }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json() };
};
try {
  const r = await applyAbcStudioScenario(call, firstOpenDate());
  console.log(`Đã thêm sản phẩm Game C vào dự án ABC Game Studio (#${r.parentId}), hiệu lực từ ${firstOpenDate()}: Võ Nam chia đều cho Game A, B, C.`);
} catch (err) {
  console.error(`Không áp dụng được kịch bản: ${err.message}`);
  process.exitCode = 1;
} finally {
  server.close();
}
