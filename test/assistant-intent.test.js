// Trợ lý: Vietnamese questions are read into metrics, projects / products and a period.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuestion } from '../shared/assistant-intent.js';

const PROJECTS = [
  { id: 1, name: 'Zen Bell' }, { id: 2, name: 'Mindfulness Bell' }, { id: 3, name: 'ABC Game Studio' },
  { id: 4, name: 'Game A' }, { id: 5, name: 'Zell App' }, { id: 6, name: 'Game B' },
];
const ask = (q) => parseQuestion(q, PROJECTS);

test('metric + product + period, with or without accents', () => {
  assert.deepEqual(ask('Doanh thu của Zen Bell hôm nay'), { metrics: ['revenue'], projectIds: [1], team: false, period: 'day' });
  assert.deepEqual(ask('doanh thu cua zen bell hom nay'), ask('Doanh thu của Zen Bell hôm nay'));
  assert.deepEqual(ask('doanh thu zenbell').projectIds, [1]);
});

test('longer names win and several products can be compared', () => {
  assert.deepEqual(ask('DAU Mindfulness Bell tuần này'), { metrics: ['dau'], projectIds: [2], team: false, period: 'week' });
  assert.deepEqual(ask('So sánh doanh thu Game A và Game B quý này').projectIds, [4, 6]);
});

test('periods: "3 ngày" before "ngày"; no period word leaves it to the shared filter', () => {
  assert.equal(ask('lượt tải 3 ngày').period, '3days');
  assert.equal(ask('chi phí Zell App năm nay').period, 'year');
  assert.equal(ask('lãi lỗ Zell App').period, null);
});

test('no product means the whole team; a bare name means its overview', () => {
  assert.deepEqual(ask('tổng doanh thu tháng này'), { metrics: ['revenue'], projectIds: [], team: true, period: 'month' });
  assert.deepEqual(ask('Zen Bell').metrics, ['revenue', 'cost', 'profit', 'score']);
  assert.deepEqual(ask('tổng quan team').metrics, ['revenue', 'cost', 'profit', 'score']);
});

test('"đầu tư" is not DAU; unrelated text is not understood', () => {
  assert.deepEqual(ask('chi phí đầu tư Game A').metrics, ['cost']);
  assert.equal(ask('xin chào'), null);
  assert.equal(ask('   '), null);
});

test('a product the user may not see is not matched', () => {
  assert.deepEqual(parseQuestion('doanh thu Zen Bell', [{ id: 5, name: 'Zell App' }]), { metrics: ['revenue'], projectIds: [], team: true, period: null });
});
