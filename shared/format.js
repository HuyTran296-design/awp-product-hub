// Vietnamese number/date formatting shared by server, browser and tests.

const intFmt = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });
const dec1Fmt = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Round half away from zero to `digits` decimals (avoids 0.1+0.2 float drift). */
export function round(value, digits = 0) {
  const f = 10 ** digits;
  return Math.sign(value) * Math.round(Math.abs(value) * f + 1e-9) / f;
}

/** 100000000 -> "100.000.000" */
export function formatNumber(value, digits = 0) {
  if (value == null || Number.isNaN(value)) return '—';
  if (digits === 0) return intFmt.format(round(value));
  return new Intl.NumberFormat('vi-VN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    .format(round(value, digits));
}

/** 100000000 -> "100.000.000 ₫" */
export function formatVnd(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${intFmt.format(round(value))} ₫`;
}

/** Compact VND for chart axes: 62400000 -> "62,4 tr" */
export function formatVndCompact(value) {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${dec1Fmt.format(value / 1e9)} tỷ`;
  if (abs >= 1e6) return `${dec1Fmt.format(value / 1e6)} tr`;
  if (abs >= 1e3) return `${intFmt.format(value / 1e3)} k`;
  return intFmt.format(value);
}

/** 18.6 -> "18,6%" (value already in percent units) */
export function formatPct(value, digits = 1) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${formatNumber(value, digits)}%`;
}

/** Seconds -> "7 phút 05 giây" style short form "7:05" */
export function formatDuration(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return '—';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)} phút ${String(s % 60).padStart(2, '0')} giây`;
}

/** "2026-10-15" -> "15/10/2026" */
export function formatDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** ISO timestamp -> "15/10/2026 06:00" in local time */
export function formatDateTime(isoTs) {
  if (!isoTs) return '—';
  const d = new Date(isoTs);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Change vs previous period in percent, or null when not comparable. */
export function percentChange(current, previous) {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
