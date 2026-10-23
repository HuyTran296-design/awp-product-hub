// Trợ lý: Vietnamese questions are read into metrics, projects and a period.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuestion } from '../shared/assistant-intent.js';

const PROJECTS = [{ id: 1, name: 'Game A' }, { id: 2, name: 'Game B' }, { id: 3, name: 'Game B Plus' }];
const ask = (q) => parseQuestion(q, PROJECTS);

test('metric + project + period, with or without accents', () => {
  assert.deepEqual(ask('Doanh thu của Game B hôm nay'), { metrics: ['revenue'], projectIds: [2], team: false, period: 'day' });
  assert.deepEqual(ask('doanh thu cua game b hom nay'), ask('Doanh thu của Game B hôm nay'));
  assert.deepEqual(ask('doanh thu gameb').projectIds, [2]);
});

test('longer names win and several projects can be compared', () => {
  assert.deepEqual(ask('DAU Game B Plus tuần này'), { metrics: ['dau'], projectIds: [3], team: false, period: 'week' });
  assert.deepEqual(ask('So sánh doanh thu Game A và Game B quý này').projectIds, [1, 2]);
});

test('periods: "3 ngày" before "ngày"; no period word leaves it to the shared filter', () => {
  assert.equal(ask('lượt tải 3 ngày').period, '3days');
  assert.equal(ask('chi phí Game A năm nay').period, 'year');
  assert.equal(ask('lãi lỗ Game A').period, null);
});

test('no project means the whole team; a bare name means its overview', () => {
  assert.deepEqual(ask('tổng doanh thu tháng này'), { metrics: ['revenue'], projectIds: [], team: true, period: 'month' });
  assert.deepEqual(ask('Game B').metrics, ['revenue', 'cost', 'profit', 'score']);
  assert.deepEqual(ask('tổng quan team').metrics, ['revenue', 'cost', 'profit', 'score']);
});

test('"đầu tư" is not DAU; unrelated text is not understood', () => {
  assert.deepEqual(ask('chi phí đầu tư Game A').metrics, ['cost']);
  assert.equal(ask('xin chào'), null);
  assert.equal(ask('   '), null);
});

test('a project the user may not see is not matched', () => {
  assert.deepEqual(parseQuestion('doanh thu Game A', [{ id: 2, name: 'Game B' }]), { metrics: ['revenue'], projectIds: [], team: true, period: null });
});
