// Server clock. AWP_TODAY=YYYY-MM-DD simulates another "today" (demo / acceptance tests);
// sample data, closing months and effective dates all follow it. Timestamps stay real time.

import { addDays, toIsoDate } from '../shared/periods.js';

export function todayIso() {
  const t = process.env.AWP_TODAY;
  return /^\d{4}-\d{2}-\d{2}$/.test(t || '') ? t : toIsoDate(new Date());
}

/** Latest day with data (sample data ends yesterday). */
export const yesterday = () => addDays(todayIso(), -1);
