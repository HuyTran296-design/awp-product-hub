import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCosts, memberProjectCost, validateAssignments } from '../shared/cost-calculator.js';
import { costFactor } from '../shared/periods.js';
import { round } from '../shared/format.js';

const members = [
  { id: 1, name: 'Nguyễn Minh', monthlyCost: 25_000_000 },
  { id: 2, name: 'Trần Lan', monthlyCost: 22_000_000 },
  { id: 3, name: 'Lê Tuấn', monthlyCost: 20_000_000 },
  { id: 4, name: 'Phạm Hà', monthlyCost: 13_000_000 },
];
// Test-only configuration (kịch bản A) — never part of the demo data.
const projects = [{ id: 1, name: 'Dự án Test 1' }, { id: 2, name: 'Dự án Test 2' }];
const effort = { 1: [50, 60, 40, 50], 2: [40, 30, 50, 40] };
const assignments = Object.entries(effort).flatMap(([pid, list]) =>
  list.map((e, i) => ({ projectId: Number(pid), memberId: i + 1, effortPct: e })));
// Kịch bản A: lương 80.000.000 + one tool "Tools & AI" 20.000.000 for every project = 100.000.000/tháng.
const settings = { tools: [{ id: 't1', name: 'Tools & AI', monthlyCost: 20_000_000, appliesTo: [] }] };

test('A. team totals: lương 80.000.000 + Tools/AI 20.000.000; Lương chưa phân bổ 8.000.000 (8,0%)', () => {
  const c = computeCosts({ settings, members, projects, assignments });
  assert.equal(c.payrollTotal, 80_000_000);
  assert.equal(c.toolsTotal, 20_000_000);
  assert.equal(c.teamTotal, 100_000_000);
  assert.equal(round(c.unallocatedPersonnel), 8_000_000);
  assert.equal(c.unallocatedTools, 0);
  assert.equal(round(c.unallocated), 8_000_000);
  assert.equal(round(c.unallocatedPct, 1), 8.0);
});

test('A. Dự án Test 1: Lương 40.200.000 · Tools/AI 11.111.111 · 51.311.111/tháng (51,3%) · 2.443.386/ngày', () => {
  const z = computeCosts({ settings, members, projects, assignments }).projects[1];
  assert.equal(round(z.direct), 40_200_000);
  assert.equal(round(z.fte, 1), 2.0);
  assert.equal(round(z.tools), 11_111_111);
  assert.equal(round(z.total), 51_311_111);
  assert.equal(round(z.totalDaily), 2_443_386);
  assert.equal(round(z.teamPct, 1), 51.3);
  const minh = memberProjectCost(25_000_000, 50, 21);
  assert.equal(minh.monthly, 12_500_000);
  assert.equal(round(minh.daily), 595_238);
});

test('A. Dự án Test 2: Lương 31.800.000 · Tools/AI 8.888.889 · 40.688.889/tháng (40,7%) · 1.937.566/ngày', () => {
  const m = computeCosts({ settings, members, projects, assignments }).projects[2];
  assert.equal(round(m.direct), 31_800_000);
  assert.equal(round(m.fte, 1), 1.6);
  assert.equal(round(m.tools), 8_888_889);
  assert.equal(round(m.total), 40_688_889);
  assert.equal(round(m.totalDaily), 1_937_566);
  assert.equal(round(m.teamPct, 1), 40.7);
});

test('A. project % + unallocated % = 100%; Tổng chi phí team 100.000.000 = 4.761.905/ngày', () => {
  const c = computeCosts({ settings, members, projects, assignments });
  const sum = c.projects[1].teamPct + c.projects[2].teamPct + c.unallocatedPct;
  assert.ok(Math.abs(sum - 100) < 1e-9);
  assert.equal(round(c.teamTotal / c.workingDays), 4_761_905);
});

// Demo structure: Nam 24.000.000 (Game A 50%, Game B 50%), Vy 18.000.000 (Game A 50%, Game B 30%).
const game = {
  members: [{ id: 1, name: 'Võ Nam', monthlyCost: 24_000_000 }, { id: 2, name: 'Đỗ Vy', monthlyCost: 18_000_000 }],
  projects: [{ id: 1, name: 'Game A' }, { id: 2, name: 'Game B' }],
  assignments: [{ projectId: 1, memberId: 1, effortPct: 50 }, { projectId: 1, memberId: 2, effortPct: 50 },
    { projectId: 2, memberId: 1, effortPct: 50 }, { projectId: 2, memberId: 2, effortPct: 30 }],
};
const tool = (name, monthlyCost, appliesTo = []) => ({ settings: { tools: [{ id: name, name, monthlyCost, appliesTo }] } });

test('K1. "Unity & asset game" 6.000.000 → Game A 3.333.333 (FTE 1,0) · Game B 2.666.667 (FTE 0,8)', () => {
  const c = computeCosts({ ...game, ...tool('Unity & asset game', 6_000_000, [1, 2]) });
  assert.equal(round(c.projects[1].fte, 1), 1.0);
  assert.equal(round(c.projects[2].fte, 1), 0.8);
  assert.equal(round(c.projects[1].tools), 3_333_333);
  assert.equal(round(c.projects[2].tools), 2_666_667);
});

test('K2. "Tài khoản App Store & Google Play" 4.000.000 (Tất cả dự án) → Game A 2.222.222 · Game B 1.777.778', () => {
  const c = computeCosts({ ...game, ...tool('Tài khoản App Store & Google Play', 4_000_000) });
  assert.equal(round(c.projects[1].tools), 2_222_222);
  assert.equal(round(c.projects[2].tools), 1_777_778);
});

test('C. lương Game A 21.000.000 (Vy 9.000.000 + Nam 12.000.000) · Game B 17.400.000 (Vy 5.400.000 + Nam 12.000.000)', () => {
  const c = computeCosts({ ...game, settings: { tools: [] } });
  const by = (id) => Object.fromEntries(c.projects[id].members.map((r) => [r.memberId, r.monthly]));
  assert.equal(c.projects[1].direct, 21_000_000);
  assert.deepEqual(by(1), { 1: 12_000_000, 2: 9_000_000 });
  assert.equal(c.projects[2].direct, 17_400_000);
  assert.deepEqual(by(2), { 1: 12_000_000, 2: 5_400_000 });
  assert.equal(round(c.unallocatedPersonnel), 3_600_000, 'Vy 20% free');
});

test('a tool whose projects are not running goes to "Tools/AI chưa phân bổ"', () => {
  const c = computeCosts({ ...game, ...tool('Figma', 2_000_000, [99]) });
  assert.equal(c.unallocatedTools, 2_000_000);
  const sum = Object.values(c.projects).reduce((s, p) => s + p.teamPct, 0) + c.unallocatedPct;
  assert.ok(Math.abs(sum - 100) < 1e-9);
});

test('period cost factors follow the table', () => {
  assert.equal(costFactor('day', 21), 1 / 21);
  assert.equal(costFactor('3days', 21), 3 / 21);
  assert.equal(costFactor('week', 21), 5 / 21);
  assert.equal(costFactor('month', 21), 1);
  assert.equal(costFactor('quarter', 21), 3);
  assert.equal(costFactor('year', 21), 12);
});

test('over-allocated member is reported with name and excess', () => {
  const bad = assignments.map((a) => (a.memberId === 2 && a.projectId === 1 ? { ...a, effortPct: 90 } : a));
  const errors = validateAssignments({ members, projects, assignments: bad });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].type, 'over_allocated');
  assert.equal(errors[0].over, 20);
  assert.match(errors[0].message, /Trần Lan.*120%.*vượt 20%/);
});

test('effort out of range and empty project are rejected', () => {
  const errors = validateAssignments({ members, projects: [...projects, { id: 3, name: 'Mới' }],
    assignments: [...assignments, { projectId: 1, memberId: 1, effortPct: -5 }] });
  assert.ok(errors.some((e) => e.type === 'effort_range'));
  assert.ok(errors.some((e) => e.type === 'no_member' && e.projectId === 3));
});
