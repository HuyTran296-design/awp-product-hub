// Kịch bản C ("ABC Game Studio"), applied through the public API from `effectiveDate`: the demo data already has
// Võ Nam (100% nhân sự chung of ABC Game Studio, Chia đều) and Đỗ Vy (Game A 50%, Game B 30%); this adds the product
// Game C (Playables + iOS + Android, no direct staff), so Nam is split over Game A, B and C.
// Used by the tests and `npm run demo:abc-studio`.

export const ABC_PLATFORMS = ['playables', 'ios', 'android'];
export const ABC_BASELINES = [
  { metricKey: 'revenue', weight: 100, targetMonthly: 20_000_000, source: 'auto', period: 'month' },
  { metricKey: 'plays', weight: 60, targetMonthly: 80_000, source: 'manual', period: 'month' },
  { metricKey: 'downloads', weight: 50, targetMonthly: 1_500, source: 'auto', period: 'month' },
];
export const ABC_STOPLOSS = {
  enabled: true, warnPct: 70, cumulativeLoss: { on: true, amount: 50_000_000 }, consecutiveLoss: { on: true, months: 4 },
  lowHealth: { on: false, below: 50, months: 2 }, milestones: [], budgetOverrun: { on: false, pct: 100 },
  lateLaunch: { on: false, days: 30 }, triggerCount: 1, action: { type: 'review', effortPct: 50 },
};

/** @param {(method:string, url:string, body?:object)=>Promise<{status:number, data:any}>} call  signed in as Admin */
export async function applyAbcStudioScenario(call, effectiveDate) {
  const ok = (r, what) => {
    if (r.status >= 300) throw new Error(`${what}: ${r.data?.error ?? r.status}`);
    return r.data;
  };
  const members = ok(await call('GET', '/api/members'), 'Danh sách nhân sự').members;
  const nam = members.find((m) => m.name === 'Võ Nam').id;
  const vy = members.find((m) => m.name === 'Đỗ Vy').id;
  const metaProjects = ok(await call('GET', '/api/meta'), 'Danh sách dự án').projects;
  const parentId = metaProjects.find((p) => p.name === 'ABC Game Studio').id;
  const ids = Object.fromEntries(['Game A', 'Game B'].map((n) => [n, metaProjects.find((p) => p.name === n).id]));
  ids['Game C'] = ok(await call('POST', '/api/projects', {
    info: { name: 'Game C', color: '#0E7490', platforms: ABC_PLATFORMS, parentId, phase: 'growth' },
    baselines: { list: ABC_BASELINES, thresholds: { green: 80, red: 50 } }, staffing: { rows: [], manualAllocPct: 0 },
    activate: true, activationDate: effectiveDate, stopLoss: ABC_STOPLOSS }), 'Sản phẩm Game C').project.id;
  return { parentId, nam, vy, ids };
}
