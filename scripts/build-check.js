// "npm run build": the app has no bundling step, so the build checks that the server boots on an in-memory database
// with the sample data (the same way the Vercel function starts).

import { createApp } from '../server/index.js';
import { listProjects } from '../server/database.js';

const { db } = createApp({ dbFile: ':memory:' });
const products = listProjects(db).length;
const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
if (!products || !users) {
  console.error('Build check failed: the sample data was not seeded.');
  process.exit(1);
}
console.log(`Build check OK: ${products} dự án & sản phẩm, ${users} tài khoản mẫu.`);
