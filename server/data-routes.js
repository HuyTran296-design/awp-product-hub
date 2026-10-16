// REST API — data without connectors: manual values ("Cập nhật số liệu"), CSV upload, project phases.

import { getMetricDef, MANUAL_PERIODS } from '../shared/metric-catalog.js';
import { getBaselines, getProject } from './database.js';
import { todayIso } from './clock.js';
import { httpError } from './services/connection-service.js';
import { csvTemplate, importCsv, parseCsv } from './services/csv-import-service.js';
import { deadlineOf, periodOf, previousPeriod } from './services/manual-data-service.js';
import { budgetInfo, changePhase, phaseAt, phaseHistory, PHASES, suggestedBaselines } from './services/phase-service.js';
import { firstOpenDate } from './services/project-service.js';

export function buildDataRoutes({ db, manual }) {
  const idOf = (params) => {
    const id = Number(params.id);
    if (!getProject(db, id)) throw httpError(404, 'Không tìm thấy dự án hoặc sản phẩm');
    return id;
  };

  return [
    // Quick-entry form: every manual baseline with its current period (and the previous one if still open/overdue).
    ['GET', '/api/projects/:id/manual', ({ params }) => {
      const id = idOf(params);
      const today = todayIso();
      const items = [];
      for (const b of getBaselines(db, id)) {
        const src = manual.sourceAt(id, b.metricKey, today);
        if (src?.source !== 'manual') continue;
        const def = getMetricDef(b.metricKey);
        const cur = periodOf(today, src.period);
        const prev = previousPeriod(cur);
        const periods = [prev, cur].map((p) => ({ ...p, deadline: deadlineOf(p),
          overdue: today > deadlineOf(p) && !manual.valueFor(id, b.metricKey, p.start),
          value: manual.valueFor(id, b.metricKey, p.start) }));
        items.push({ metricKey: b.metricKey, name: def.name, unit: def.unit, periodType: src.period,
          periodLabel: MANUAL_PERIODS[src.period], periods, history: manual.history(id, b.metricKey).slice(0, 8) });
      }
      return { items, today };
    }, 'admin'],
    ['POST', '/api/projects/:id/manual', ({ params, body, user }) => ({ saved: manual.save(idOf(params), body.entries || [], user.name) }), 'admin'],
    ['GET', '/api/projects/:id/manual/:metric/history', ({ params }) => ({ history: manual.history(idOf(params), params.metric) }), 'admin'],

    ['GET', '/api/csv-template', () => ({ raw: csvTemplate(), contentType: 'text/csv; charset=utf-8', filename: 'awp-mau-nhap-so-lieu.csv' }), 'admin'],
    ['POST', '/api/projects/:id/csv/preview', ({ params, body }) => {
      const r = parseCsv(db, idOf(params), body.csv);
      return { total: r.total, valid: r.valid, errors: r.errors, duplicates: r.duplicates, sample: r.sample };
    }, 'admin'],
    ['POST', '/api/projects/:id/csv/import', ({ params, body, user }) =>
      importCsv(db, idOf(params), body.csv, body.mode === 'overwrite' ? 'overwrite' : 'skip', user.name), 'admin'],

    ['GET', '/api/projects/:id/phase', ({ params }) => {
      const id = idOf(params);
      const p = getProject(db, id);
      return { current: phaseAt(db, id, todayIso()), history: phaseHistory(db, id), phases: PHASES, firstOpenDate: firstOpenDate(),
        budget: budgetInfo(db, id, todayIso(), manual),
        suggestions: Object.fromEntries(Object.keys(PHASES).map((ph) => [ph, suggestedBaselines(ph, p.productType)
          .map((b) => ({ ...b, name: getMetricDef(b.metricKey).name }))])) };
    }, 'user'],
    ['POST', '/api/projects/:id/phase', ({ params, body, user }) => ({ phase: changePhase(db, idOf(params), body, user.name, manual) }), 'admin'],
  ];
}
