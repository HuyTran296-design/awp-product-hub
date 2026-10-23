// J1. One level "Dự án": no user-facing text (menu, buttons, titles, table labels, messages) or demo data may still say
// "sản phẩm", "dự án cha / con", "Thuộc dự án", "Nhân sự chung", "Mẫu cho sản phẩm mới" or name the former sample projects.
// Comments are skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const BANNED = /sản phẩm|dự án cha|dự án con|thư mục|kiểu dự án|dự án gốc|dự án thường|rà soát mục tiêu|thuộc dự án|nhân sự chung|mẫu cho sản phẩm mới|zell app|abc game studio|zen bell|mindfulness bell/i;

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
