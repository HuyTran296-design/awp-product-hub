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
// Kịch bản A: lương 80.000.000 + one tool "Tools & AI" 20.000.000 for every product = 100.000.000/tháng.
const settings = { tools: [{ id: 't1', name: 'Tools & AI', monthlyCost: 20_000_000, appliesTo: [] }] };

test('team totals match sample configuration', () => {
  const c = computeCosts({ settings, members, projects, assignments });
  assert.equal(c.payrollTotal, 80_000_000);
  assert.equal(c.toolsTotal, 20_000_000);
  assert.equal(c.teamTotal, 100_000_000);
  assert.equal(round(c.unallocatedPersonnel), 8_000_000);
  assert.equal(c.unallocatedTools, 0);
  assert.equal(round(c.unallocated), 8_000_000);
  assert.equal(round(c.unallocatedPct, 1), 8.0);
});

test('Zen Bell cost breakdown', () => {
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

test('Mindfulness Bell cost breakdown', () => {
  const m = computeCosts({ settings, members, projects, assignments }).projects[2];
  assert.equal(round(m.direct), 31_800_000);
  assert.equal(round(m.fte, 1), 1.6);
  assert.equal(round(m.tools), 8_888_889);
  assert.equal(round(m.total), 40_688_889);
  assert.equal(round(m.totalDaily), 1_937_566);
  assert.equal(round(m.teamPct, 1), 40.7);
});

test('project % + unallocated % = 100%', () => {
  const c = computeCosts({ settings, members, projects, assignments });
  const sum = c.projects[1].teamPct + c.projects[2].teamPct + c.unallocatedPct;
  assert.ok(Math.abs(sum - 100) < 1e-9);
});

// Tools/AI scoped to a Dự án or a product: split by effective FTE inside that group only.
const games = {
  members: [{ id: 1, monthlyCost: 24_000_000 }, { id: 2, monthlyCost: 18_000_000 }, ...members.map((m) => ({ ...m, id: m.id + 10 }))],
  projects: [{ id: 100, name: 'ABC Game Studio' }, { id: 101, name: 'Game A', parentId: 100 }, { id: 102, name: 'Game B', parentId: 100 },
    { id: 200, name: 'Zell App' }, { id: 1, name: 'Zen Bell', parentId: 200 }, { id: 2, name: 'Mindfulness Bell', parentId: 200 }],
  assignments: [{ projectId: 100, memberId: 1, effortPct: 100 }, { projectId: 101, memberId: 2, effortPct: 50 }, { projectId: 102, memberId: 2, effortPct: 30 },
    ...assignments.map((a) => ({ ...a, memberId: a.memberId + 10 }))],
  parents: [{ id: 100, method: 'even' }, { id: 200, method: 'even' }],
};

test('K1. "Unity & asset game" 6.000.000 for ABC Game Studio → Game A 3.333.333 · Game B 2.666.667', () => {
  const c = computeCosts({ ...games, settings: { tools: [{ id: 'u', name: 'Unity & asset game', monthlyCost: 6_000_000, appliesTo: [100] }] } });
  assert.equal(round(c.projects[101].fte, 1), 1.0);
  assert.equal(round(c.projects[102].fte, 1), 0.8);
  assert.equal(round(c.projects[101].tools), 3_333_333);
  assert.equal(round(c.projects[102].tools), 2_666_667);
  assert.equal(c.projects[1].tools, 0);
  assert.equal(c.projects[2].tools, 0);
  assert.equal(c.projects[100].tools, 0, 'a Dự án keeps no cost');
});

test('K2. "Tài khoản App Store & Google Play" 4.000.000 for Zell App → Zen Bell 2.222.222 · Mindfulness Bell 1.777.778', () => {
  const c = computeCosts({ ...games, settings: { tools: [{ id: 'a', name: 'Tài khoản App Store & Google Play', monthlyCost: 4_000_000, appliesTo: [200] }] } });
  assert.equal(round(c.projects[1].tools), 2_222_222);
  assert.equal(round(c.projects[2].tools), 1_777_778);
  assert.equal(c.projects[101].tools, 0);
});

test('K4. a tool whose group has no running product goes to "Tools/AI chưa phân bổ"', () => {
  const c = computeCosts({ ...games, settings: { tools: [{ id: 'f', name: 'Figma', monthlyCost: 2_000_000, appliesTo: [999] }] } });
  assert.equal(c.unallocatedTools, 2_000_000);
  const sum = Object.values(c.projects).reduce((s, p) => s + p.teamPct, 0) + c.unallocatedPct;
  assert.ok(Math.abs(sum - 100) < 1e-9);
});

test('a tool can name single products', () => {
  const c = computeCosts({ ...games, settings: { tools: [{ id: 'x', name: 'X', monthlyCost: 900_000, appliesTo: [101, 2] }] } });
  assert.equal(round(c.projects[101].tools), round(900_000 / 2.6));
  assert.equal(round(c.projects[2].tools), round(900_000 * 1.6 / 2.6));
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
