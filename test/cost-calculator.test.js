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
const projects = [{ id: 1, name: 'Zen Bell' }, { id: 2, name: 'Mindfulness Bell' }];
const effort = { 1: [50, 60, 40, 50], 2: [40, 30, 50, 40] };
const assignments = Object.entries(effort).flatMap(([pid, list]) =>
  list.map((e, i) => ({ projectId: Number(pid), memberId: i + 1, effortPct: e })));
const settings = { fixedMonthlyCost: 100_000_000, workingDays: 21, allocationMode: 'fte' };

test('team totals match sample configuration', () => {
  const c = computeCosts({ settings, members, projects, assignments });
  assert.equal(c.payrollTotal, 80_000_000);
  assert.equal(c.overheadFund, 20_000_000);
  assert.equal(round(c.unallocated), 8_000_000);
  assert.equal(round(c.unallocatedPct, 1), 8.0);
});

test('Zen Bell cost breakdown', () => {
  const z = computeCosts({ settings, members, projects, assignments }).projects[1];
  assert.equal(round(z.direct), 40_200_000);
  assert.equal(round(z.fte, 1), 2.0);
  assert.equal(round(z.overhead), 11_111_111);
  assert.equal(round(z.total), 51_311_111);
  assert.equal(round(z.totalDaily), 2_443_386);
  assert.equal(round(z.teamPct, 1), 51.3);
  const minh = memberProjectCost(25_000_000, 50, 21);
  assert.equal(minh.monthly, 12_500_000);
  assert.equal(round(minh.daily), 595_238);
});

test('Mindfulness Bell cost breakdown', () => {
  const m = computeCosts({ settings, members, projects, assignments }).projects[2];
  assert.equal(round(m.direct), 31_800_000);
  assert.equal(round(m.fte, 1), 1.6);
  assert.equal(round(m.overhead), 8_888_889);
  assert.equal(round(m.total), 40_688_889);
  assert.equal(round(m.totalDaily), 1_937_566);
  assert.equal(round(m.teamPct, 1), 40.7);
});

test('project % + unallocated % = 100%', () => {
  const c = computeCosts({ settings, members, projects, assignments });
  const sum = c.projects[1].teamPct + c.projects[2].teamPct + c.unallocatedPct;
  assert.ok(Math.abs(sum - 100) < 1e-9);
});

test('manual allocation splits overhead by entered %', () => {
  const c = computeCosts({ settings: { ...settings, allocationMode: 'manual' }, members,
    projects: [{ id: 1, manualAllocPct: 70 }, { id: 2, manualAllocPct: 30 }], assignments });
  assert.equal(round(c.projects[1].overhead), 14_000_000);
  assert.equal(round(c.projects[2].overhead), 6_000_000);
});

test('negative overhead fund is flagged', () => {
  const c = computeCosts({ settings: { ...settings, fixedMonthlyCost: 70_000_000 }, members, projects, assignments });
  assert.equal(c.overheadNegative, true);
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
