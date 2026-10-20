// Project phases and the baselines suggested for each phase / product type (shared by server and wizard).

import { PLAYABLES } from './metric-catalog.js';

export const PHASES = { build: 'Xây dựng', launch: 'Ra mắt', growth: 'Tăng trưởng', stable: 'Ổn định' };

const APP_DEFAULTS = [
  ['revenue', 100, 30_000_000], ['dau', 80, 5_000], ['downloads', 50, 2_000], ['retention_d7', 60, 15], ['store_rating', 40, 4.5],
];

/** Baselines suggested when a project enters `phase` (source: 'auto' = native connector, 'manual' = entered by hand). */
export function suggestedBaselines(phase, productType) {
  if (phase === 'build') {
    return [
      { metricKey: 'feature_progress', weight: 100, targetMonthly: 100, source: 'manual', period: 'month' },
      { metricKey: 'waitlist', weight: 60, targetMonthly: 2000, source: 'manual', period: 'month' },
      { metricKey: 'beta_testers', weight: 60, targetMonthly: 150, source: 'manual', period: 'month' },
      { metricKey: 'budget_burn', weight: 80, targetMonthly: 1, source: 'manual', period: 'month' },
    ];
  }
  if (productType === PLAYABLES) {
    return [
      { metricKey: 'revenue', weight: 100, targetMonthly: 5_000_000, source: 'manual', period: 'month' },
      { metricKey: 'plays', weight: 60, targetMonthly: 100_000, source: 'manual', period: 'month' },
      { metricKey: 'players', weight: 80, targetMonthly: 50_000, source: 'manual', period: 'month' },
      { metricKey: 'play_time', weight: 40, targetMonthly: 8, source: 'manual', period: 'month' },
    ];
  }
  return APP_DEFAULTS.map(([metricKey, weight, targetMonthly]) => ({ metricKey, weight, targetMonthly, source: 'auto', period: 'month' }));
}
