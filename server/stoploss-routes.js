// REST API — Phương án cắt lỗ: project policies, tracking, proposals, decisions.
// Viewer: statuses only. Admin: configuration and decisions.

import { addDays } from '../shared/periods.js';
import { visibleProjectIds } from './scope.js';
import { getProject } from './database.js';
import { httpError } from './services/connection-service.js';
import { firstOpenDate, today } from './services/project-service.js';
import { getPolicy, savePolicy, summarize } from './services/stoploss-service.js';

export function buildStopLossRoutes({ db, stopLoss }) {
  const idOf = (params, user) => {
    const id = Number(params.id);
    if (!getProject(db, id)) throw httpError(404, 'Không tìm thấy dự án');
    const visible = user && visibleProjectIds(db, user);
    if (visible && !visible.has(id)) throw httpError(403, 'Bạn không có quyền truy cập');
    return id;
  };
  const defaultExecDate = () => (today() > firstOpenDate() ? today() : firstOpenDate());

  return [
    ['GET', '/api/stoploss', async ({ user }) => {
      const visible = visibleProjectIds(db, user);
      return { rows: (await stopLoss.tracking()).filter((r) => !visible || visible.has(r.id)), today: today() };
    }, 'user'],

    ['GET', '/api/projects/:id/stoploss', async ({ params, user }) => {
      const id = idOf(params, user);
      const s = await stopLoss.sync(id);
      const payload = {
        summary: summarize(s), enabled: s.enabled, display: s.display, conditions: s.conditions ?? [], months: s.months ?? [],
        cumLoss: s.cumLoss, threshold: s.threshold, usedPct: s.usedPct, warnPct: s.warnPct, avg3Loss: s.avg3Loss,
        remaining: s.remaining, nextMilestone: s.nextMilestone, need: s.need, evaluatedThrough: s.evaluatedThrough,
        lastClosed: s.lastClosed, start: s.start, monthlyCost: s.monthlyCost, proposal: s.proposal,
      };
      if (user.role === 'admin') Object.assign(payload, { policy: s.policy });
      return payload;
    }, 'user'],
    ['PUT', '/api/projects/:id/stoploss', ({ params, body, user }) => ({ policy: savePolicy(db, idOf(params), body, user.name) }), 'admin'],


    ['GET', '/api/proposals/:id', ({ params, user }) => {
      const proposal = stopLoss.getProposal(Number(params.id));
      idOf({ id: proposal.projectId }, user);
      const project = getProject(db, proposal.projectId);
      const out = { proposal, project: project && { id: project.id, name: project.name, color: project.color } };
      if (user.role === 'admin' && proposal.status === 'pending') {
        out.defaultEffectiveDate = defaultExecDate();
        out.firstOpenDate = firstOpenDate();
        out.minReviewDate = addDays(today(), 1);
        out.impact = stopLoss.impact(proposal.projectId, proposal.snapshot.action, out.defaultEffectiveDate);
      }
      return out;
    }, 'user'],
    ['POST', '/api/proposals/:id/impact', ({ params, body }) => {
      const proposal = stopLoss.getProposal(Number(params.id));
      return { impact: stopLoss.impact(proposal.projectId, body.action, body.effectiveDate || defaultExecDate()) };
    }, 'admin'],
    ['POST', '/api/proposals/:id/decision', ({ params, body, user }) =>
      ({ proposal: stopLoss.decide(Number(params.id), body, user.name) }), 'admin'],

  ];
}
