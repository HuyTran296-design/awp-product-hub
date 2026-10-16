// J1. Two levels are named "Dự án" (upper) and "Sản phẩm" (lower): no user-facing text may still say
// "dự án cha", "dự án con", "thư mục" or "Kiểu dự án". Comments and the one-time history migration word list are skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const BANNED = /dự án cha|dự án con|thư mục|kiểu dự án|dự án gốc|dự án thường|rà soát mục tiêu/i;

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.(js|html)$/.test(e.name) ? [p] : [];
  });
}

test('J1. no old wording in the UI or server messages', () => {
  const hits = [];
  for (const f of ['public', 'server', 'shared'].flatMap((d) => files(path.join(ROOT, d)))) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    let inWords = false;
    lines.forEach((line, i) => {
      if (/const words = \[/.test(line)) inWords = true;
      const code = line.trim().startsWith('//') || line.trim().startsWith('*') ? '' : line.replace(/\s\/\/\s.*$/, '');
      if (!inWords && BANNED.test(code)) hits.push(`${path.relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 100)}`);
      if (inWords && /\]\];/.test(line)) inWords = false;
    });
  }
  assert.deepEqual(hits, []);
});
