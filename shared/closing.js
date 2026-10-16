// Month closing ("chốt sổ"): month N closes on day 3 of month N+1, because Store data arrives 1–2 days late.
// Closed months are read-only (no change may take effect there) and are the only months stop-loss evaluates.

import { addDays } from './periods.js';

export const CLOSE_DAY = 3;

export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const monthEnd = (ym) => addDays(`${addMonths(ym, 1)}-01`, -1);

/** Latest closed month ("YYYY-MM") as of `today`. */
export function lastClosedMonth(today) {
  const ym = today.slice(0, 7);
  return addMonths(ym, Number(today.slice(8, 10)) >= CLOSE_DAY ? -1 : -2);
}

/** First date changes may take effect: the day after the last closed month. */
export function firstOpenDate(today) {
  return `${addMonths(lastClosedMonth(today), 1)}-01`;
}

/** Date month `ym` closes on. */
export const closingDate = (ym) => `${addMonths(ym, 1)}-${String(CLOSE_DAY).padStart(2, '0')}`;
