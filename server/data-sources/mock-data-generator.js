// Deterministic sample data: 400 days per project × platform, fixed seed, weekday rhythm,
// gentle growth. The 30-day window ending at `endDate` is calibrated so the "Tháng" period
// reproduces the acceptance numbers exactly (revenue USD, downloads, DAU, D7, crash, rating).

import { addDays, parseIsoDate } from '../../shared/periods.js';
import { USD_VND_RATE } from '../../shared/system-config.js';

export const MOCK_DAYS = 400;
/** Bump when the generator output changes so stored sample data is regenerated on start. */
export const MOCK_DATA_VERSION = 5;
const CALIBRATION_WINDOW = 30;

export const CHANNELS = [
  { key: 'facebook', color: '#1877F2', name: 'Facebook', share: 0.12, clickToInstall: 0.18, source: 'Link UTM (GA4) · campaign link App Store · UTM Google Play' },
  { key: 'instagram', color: '#E1306C', name: 'Instagram', share: 0.09, clickToInstall: 0.15, source: 'Link UTM (GA4) · campaign link App Store · UTM Google Play' },
  { key: 'youtube', color: '#FF0000', name: 'YouTube', share: 0.07, clickToInstall: 0.22, source: 'Link UTM (GA4) · campaign link App Store · UTM Google Play' },
  { key: 'reddit', color: '#FF4500', name: 'Reddit', share: 0.04, clickToInstall: 0.25, source: 'Link UTM (GA4) · campaign link App Store · UTM Google Play' },
  { key: 'blogs', color: '#0E9384', name: 'Blogs', share: 0.10, clickToInstall: 0.30, source: 'Link UTM (GA4) · campaign link App Store · UTM Google Play' },
  { key: 'promote', color: '#7A5AF8', name: 'Promote từ nền tảng khác', promote: true, source: 'Link theo dõi của từng nguồn promote (UTM · ct · referrer)' },
  { key: 'store_search', color: '#667085', name: 'Tìm kiếm trên Store', share: 0.35, clickToInstall: null, source: 'App Store Connect (App Store Search) · Google Play (Search)' },
];

const PROFILES = {
  'game-b': { kind: 'playables', growth: 0.04, base: { web_sessions: 520, channel_views: 6800 } },
  'game-a': { kind: 'build', growth: 0.06, base: { web_sessions: 180 } },
  'zen-bell': {
    growth: 0.02, iosShare: 0.6,
    base: { revenue: 80, downloads: 154, dau: 10450, new_users: 175, retention_d7: 18.6, engagement_time: 432,
      key_conversions: 42, store_conv: 0.31, crash_rate_android: 0.62, web_sessions: 2600 },
    rating: { ios: 4.8, android: 4.6 },
    // "Promote từ nền tảng khác": [source code, share of downloads, click → install].
    promo: [['promo_mindfulness_bell', 0.035, 0.24], ['promo_playables', 0.02, 0.12], ['promo_tiktok', 0.03, 0.07], ['promo_partners', 0.015, 0.16]],
    calibrate: { revenue: 2400, downloads: 4620, dau: 10450, retention_d7: 18.6 },
    // "Tham chiếu" sample: revenue (VND) of complete calendar months.
    monthlyRevenue: {
      '2026-05': 52_000_000, '2026-06': 54_500_000, '2026-07': 56_000_000,
      '2026-08': 58_400_000, '2026-09': 60_100_000, '2026-10': 62_400_000,
    },
    posts: [
      ['5-minute-morning-meditation', '5 phút thiền buổi sáng cho người bận rộn', 1.0],
      ['singing-bowl-sounds-guide', 'Âm thanh chuông xoay: hướng dẫn cho người mới', 0.8],
      ['pomodoro-with-a-bell', 'Pomodoro cùng tiếng chuông: tập trung sâu hơn', 0.65],
      ['sleep-better-bell-routine', 'Ngủ ngon hơn với chuông thiền buổi tối', 0.55],
      ['mindful-breaks-at-work', 'Nghỉ chánh niệm 2 phút giữa giờ làm', 0.42],
      ['zen-bell-vs-timer-apps', 'Zen Bell khác gì ứng dụng hẹn giờ thông thường', 0.3],
    ],
  },
  'mindfulness-bell': {
    growth: 0.012, iosShare: 0.55,
    base: { revenue: 43, downloads: 47, dau: 6000, new_users: 60, retention_d7: 12, engagement_time: 365,
      key_conversions: 15, store_conv: 0.27, crash_rate_android: 1.8, web_sessions: 1500 },
    rating: { ios: 4.6, android: 4.3 },
    calibrate: { revenue: 1300, downloads: 1400, dau: 6000, retention_d7: 12, crash_rate_android: 1.8 },
    // Stop-loss sample: calendar-month P&L (VND) at the sample cost structure; applied once a month is complete.
    monthlyProfit: {
      '2026-05': -9_000_000, '2026-06': -8_000_000, '2026-07': -7_500_000,
      '2026-08': -6_900_000, '2026-09': -7_200_000, '2026-10': -6_888_889,
    },
    // 10/2026 also reproduces the rolling-month KPIs (health score 71,6%).
    monthlyKpis: { '2026-10': { dau: 6000, downloads: 1400, retention_d7: 12, crash_rate_android: 1.8 } },
    posts: [
      ['random-mindfulness-reminders', 'Chuông nhắc chánh niệm ngẫu nhiên hoạt động thế nào', 1.0],
      ['plum-village-bell-practice', 'Thực tập thỉnh chuông theo truyền thống Làng Mai', 0.85],
      ['mindful-phone-habits', 'Dùng điện thoại chánh niệm hơn mỗi ngày', 0.6],
      ['breathing-with-the-bell', 'Thở cùng tiếng chuông: bài tập 3 hơi thở', 0.5],
      ['mindfulness-for-students', 'Chánh niệm cho học sinh, sinh viên', 0.35],
      ['bell-sounds-library', 'Thư viện âm thanh chuông: chọn tiếng phù hợp', 0.25],
    ],
  },
};

/** Generic profile for projects added later, scaled by a seeded factor. */
function defaultProfile(slug, productType) {
  const r = mulberry32(hashString(slug))();
  const k = 0.4 + r * 0.6;
  if (productType === 'youtube_playables') return { kind: 'playables', growth: 0.03, base: { web_sessions: 420 * k, channel_views: 5200 * k } };
  return {
    growth: 0.015, iosShare: 0.55,
    base: { revenue: 40 * k, downloads: 60 * k, dau: 4000 * k, new_users: 70 * k, retention_d7: 14, engagement_time: 380,
      key_conversions: 18 * k, store_conv: 0.28, crash_rate_android: 1.1, web_sessions: 1200 * k },
    rating: { ios: 4.5, android: 4.4 },
    calibrate: {},
    posts: [
      ['getting-started', 'Bắt đầu với ứng dụng', 1.0], ['tips-and-tricks', 'Mẹo sử dụng hiệu quả', 0.7],
      ['whats-new', 'Có gì mới trong phiên bản này', 0.5], ['faq', 'Câu hỏi thường gặp', 0.4],
      ['user-stories', 'Câu chuyện người dùng', 0.3],
    ],
  };
}

// Sun..Sat usage rhythm (mindfulness apps peak on weekends).
const WEEKDAY = [1.1, 0.96, 0.95, 0.97, 0.98, 1.0, 1.08];

/**
 * @returns {{ rows: {date:string, metricKey:string, platform:string, value:number}[],
 *             posts: {slug:string, title:string}[] }}
 */
export function generateProjectData(slug, endDate, days = MOCK_DAYS, { productType = null } = {}) {
  const profile = { slug, ...(PROFILES[slug] || defaultProfile(slug, productType)) };
  const dates = Array.from({ length: days }, (_, i) => addDays(endDate, i - days + 1));
  const dow = dates.map((d) => parseIsoDate(d).getDay());
  const trend = dates.map((_, i) => (1 + profile.growth) ** ((i - days + 1) / 30));
  const share = { ios: profile.iosShare, android: 1 - profile.iosShare };
  const winFrom = days - CALIBRATION_WINDOW;
  const series = {}; // metricKey -> platform -> number[]
  const rand = (key) => mulberry32(hashString(`${slug}|${key}`));

  /** Volume metric: base × share × growth × weekday × noise. */
  const volume = (key, base, platforms, amp = 0.08, weekday = true) => {
    series[key] = {};
    for (const p of platforms) {
      const r = rand(`${key}|${p}`);
      const s = platforms.length > 1 ? share[p] : 1;
      series[key][p] = dates.map((_, i) => base * s * trend[i] * (weekday ? WEEKDAY[dow[i]] : 1) * (1 + (r() - 0.5) * 2 * amp));
    }
  };
  /** Rate metric: base ± platform offset, slow wave, small noise. */
  const rate = (key, base, platforms, offset, amp) => {
    series[key] = {};
    for (const p of platforms) {
      const r = rand(`${key}|${p}`);
      const off = platforms.length > 1 ? (p === 'ios' ? offset : -offset) : 0;
      series[key][p] = dates.map((_, i) => (base + off) * (1 + 0.04 * Math.sin(i / 23)) + (r() - 0.5) * 2 * amp);
    }
  };

  const b = profile.base;
  const app = ['ios', 'android'];
  const toRows = () => {
    const rows = [];
    for (const [metricKey, byPlatform] of Object.entries(series)) {
      for (const [platform, values] of Object.entries(byPlatform)) {
        values.forEach((value, i) => rows.push({ date: dates[i], metricKey, platform, value }));
      }
    }
    return rows;
  };

  // Projects without store connectors: only a landing page (GA4) and, for Playables, the YouTube channel.
  // Their baselines are entered manually or imported from CSV.
  if (profile.kind) {
    volume('web_sessions', b.web_sessions, ['web'], 0.12);
    calibrate(series.web_sessions, winFrom, null, 0);
    const rw = rand('web');
    const sess = series.web_sessions.web;
    series.web_users = { web: sess.map((v) => Math.round(v * (0.75 + (rw() - 0.5) * 0.04))) };
    series.web_engaged_sessions = { web: sess.map((v) => Math.round(v * (0.52 + (rw() - 0.5) * 0.06))) };
    series.click_download = { web: sess.map((v) => Math.round(v * (0.08 + (rw() - 0.5) * 0.02))) };
    if (profile.kind === 'playables') {
      volume('channel_views', b.channel_views, ['youtube'], 0.15);
      calibrate(series.channel_views, winFrom, null, 0);
      const ry = rand('yt');
      series.yt_watch_hours = { youtube: series.channel_views.youtube.map((v) => round(v * (0.055 + (ry() - 0.5) * 0.01), 1)) };
      series.yt_new_subs = { youtube: series.channel_views.youtube.map((v) => Math.round(v * (0.004 + (ry() - 0.5) * 0.001))) };
    }
    return { rows: toRows(), posts: [] };
  }

  volume('revenue', b.revenue, app, 0.18);
  volume('downloads', b.downloads, app, 0.12);
  volume('dau', b.dau, app, 0.04);
  volume('new_users', b.new_users, app, 0.1);
  volume('key_conversions', b.key_conversions, app, 0.15);
  rate('retention_d7', b.retention_d7, app, 0.8, 0.6);
  rate('engagement_time', b.engagement_time, app, 15, 20);
  rate('crash_rate_android', b.crash_rate_android, ['android'], 0, 0.15);

  // Calibrate the last-30-day window, then round to storage precision.
  const cal = profile.calibrate;
  const n = CALIBRATION_WINDOW;
  calibrate(series.revenue, winFrom, cal.revenue, 2);
  calibrate(series.downloads, winFrom, cal.downloads, 0);
  calibrate(series.dau, winFrom, cal.dau != null ? cal.dau * n : null, 0);
  calibrate(series.retention_d7, winFrom, cal.retention_d7 != null ? cal.retention_d7 * n * 2 : null, 2);
  calibrate(series.crash_rate_android, winFrom, cal.crash_rate_android != null ? cal.crash_rate_android * n : null, 2);
  calibrate(series.new_users, winFrom, null, 0);
  calibrate(series.key_conversions, winFrom, null, 0);
  calibrate(series.engagement_time, winFrom, null, 0);

  calibrateCalendarMonths(series, profile, dates, winFrom);

  // Store rating: slow drift towards the current value, latest day exact.
  series.store_rating = {};
  for (const p of app) {
    const r = rand(`rating|${p}`);
    const target = profile.rating[p];
    series.store_rating[p] = dates.map((_, i) => {
      if (i === days - 1) return target;
      const drift = (days - 1 - i) / days * 0.15;
      return round(target - drift + (r() - 0.5) * 0.04, 2);
    });
  }

  // Store page views derived from downloads ÷ conversion rate.
  series.store_page_views = {};
  for (const p of app) {
    const r = rand(`spv|${p}`);
    const conv = b.store_conv * (p === 'ios' ? 1.05 : 0.95);
    series.store_page_views[p] = series.downloads[p].map((d) => Math.round(d / (conv * (1 + (r() - 0.5) * 0.12))));
  }

  // Website (GA4, platform "web").
  volume('web_sessions', b.web_sessions, ['web'], 0.1);
  calibrate(series.web_sessions, winFrom, null, 0);
  const rw = rand('web');
  const sessions = series.web_sessions.web;
  series.web_users = { web: sessions.map((s) => Math.round(s * (0.72 + (rw() - 0.5) * 0.04))) };
  series.web_engaged_sessions = { web: sessions.map((s) => Math.round(s * (0.58 + (rw() - 0.5) * 0.06))) };
  series.click_download = { web: sessions.map((s) => Math.round(s * (0.052 + (rw() - 0.5) * 0.012))) };

  // Acquisition channels: installs per platform, link clicks on the web.
  for (const c of CHANNELS.filter((x) => !x.promote)) {
    const rc = rand(`ch|${c.key}`);
    series[`ch_installs:${c.key}`] = {};
    for (const p of app) {
      series[`ch_installs:${c.key}`][p] = series.downloads[p].map((d) => Math.round(d * c.share * (1 + (rc() - 0.5) * 0.3)));
    }
    if (c.clickToInstall) {
      series[`ch_clicks:${c.key}`] = { web: dates.map((_, i) => Math.round(
        (series[`ch_installs:${c.key}`].ios[i] + series[`ch_installs:${c.key}`].android[i]) / (c.clickToInstall * (1 + (rc() - 0.5) * 0.2)))) };
    }
  }

  // Promote sources: per tracking code, installs per platform + link clicks on the web.
  for (const [code, sh, cti] of profile.promo ?? []) {
    const rp = rand(`promo|${code}`);
    series[`promo_installs:${code}`] = {};
    for (const p of app) series[`promo_installs:${code}`][p] = series.downloads[p].map((d) => Math.round(d * sh * (1 + (rp() - 0.5) * 0.4)));
    series[`promo_clicks:${code}`] = { web: dates.map((_, i) => Math.round(
      (series[`promo_installs:${code}`].ios[i] + series[`promo_installs:${code}`].android[i]) / (cti * (1 + (rp() - 0.5) * 0.2)))) };
  }

  // Blog posts: views on the web, store-badge clicks per platform, attributed installs.
  const weightSum = profile.posts.reduce((s, [, , w]) => s + w, 0);
  for (const [postSlug, , w] of profile.posts) {
    const rp = rand(`blog|${postSlug}`);
    const ctr = 0.035 + rp() * 0.05;
    const views = sessions.map((s) => Math.round(s * 0.45 * (w / weightSum) * (1 + (rp() - 0.5) * 0.3)));
    series[`blog_views:${postSlug}`] = { web: views };
    series[`blog_clicks:${postSlug}`] = {
      ios: views.map((v) => Math.round(v * ctr * share.ios * (1 + (rp() - 0.5) * 0.3))),
      android: views.map((v) => Math.round(v * ctr * share.android * (1 + (rp() - 0.5) * 0.3))),
    };
    series[`blog_installs:${postSlug}`] = { all: views.map((v, i) => Math.round(
      (series[`blog_clicks:${postSlug}`].ios[i] + series[`blog_clicks:${postSlug}`].android[i]) * (0.28 + (rp() - 0.5) * 0.1))) };
  }

  return { rows: toRows(), posts: profile.posts.map(([s, title]) => ({ slug: s, title })) };
}

/**
 * Scale every value of `byPlatform` so the window [winFrom, end] sums to `total` (all platforms),
 * round to `decimals`, then put the rounding residual on one mid-window day so the sum is exact.
 * With total == null only rounding is applied.
 */
function calibrate(byPlatform, winFrom, total, decimals) {
  const unit = 10 ** decimals;
  const platforms = Object.keys(byPlatform);
  const windowSum = () => platforms.reduce((s, p) => s + byPlatform[p].slice(winFrom).reduce((a, v) => a + v, 0), 0);
  const factor = total == null ? 1 : total / windowSum();
  for (const p of platforms) byPlatform[p] = byPlatform[p].map((v) => Math.round(v * factor * unit));
  if (total != null) {
    const residual = Math.round(total * unit) - windowSum();
    const mid = winFrom + 15;
    const p = platforms.reduce((a, c) => (byPlatform[c][mid] > byPlatform[a][mid] ? c : a));
    byPlatform[p][mid] += residual;
  }
  for (const p of platforms) byPlatform[p] = byPlatform[p].map((v) => v / unit);
}

/** Sample cost structure (Mindfulness Bell): direct 31.800.000 + Tools/AI 20.000.000 × 1,6 ÷ 3,6, at 26.000 VND/USD. */
const SAMPLE_MONTH_COST = { 'mindfulness-bell': 31_800_000 + (20_000_000 * 1.6) / 3.6 };
const SAMPLE_USD_RATE = USD_VND_RATE;

/**
 * Calibrate complete calendar months to the profile's monthly targets. Days inside the rolling
 * calibration window (index ≥ winFrom) are left untouched so both the rolling "Tháng" period and the
 * calendar month hit their numbers.
 */
function calibrateCalendarMonths(series, profile, dates, winFrom) {
  const months = new Set([...Object.keys(profile.monthlyProfit ?? {}), ...Object.keys(profile.monthlyKpis ?? {}), ...Object.keys(profile.monthlyRevenue ?? {})]);
  const cost = SAMPLE_MONTH_COST[profile.slug];
  for (const ym of months) {
    const from = dates.findIndex((d) => d.startsWith(ym));
    const to = dates.findLastIndex((d) => d.startsWith(ym));
    // Only complete months: first day present and the month's last day is in the data.
    if (from < 0 || dates[from].slice(8) !== '01' || !isMonthEnd(dates[to])) continue;
    const days = to - from + 1;
    const pl = profile.monthlyProfit?.[ym];
    if (pl != null && cost) calibrateRange(series.revenue, from, to, winFrom, (cost + pl) / SAMPLE_USD_RATE, 6);
    const rv = profile.monthlyRevenue?.[ym];
    if (rv != null) calibrateRange(series.revenue, from, to, winFrom, rv / SAMPLE_USD_RATE, 6);
    const k = profile.monthlyKpis?.[ym];
    if (k) {
      calibrateRange(series.dau, from, to, winFrom, k.dau * days, 0);
      calibrateRange(series.downloads, from, to, winFrom, k.downloads, 0);
      calibrateRange(series.retention_d7, from, to, winFrom, k.retention_d7 * days * 2, 2);
      calibrateRange(series.crash_rate_android, from, to, winFrom, k.crash_rate_android * days, 2);
    }
  }
}

function isMonthEnd(iso) {
  return addDays(iso, 1).slice(8) === '01';
}

/** Scale the adjustable days (index < lockedFrom) of [from, to] so all platforms sum to `total`; exact after rounding. */
function calibrateRange(byPlatform, from, to, lockedFrom, total, decimals) {
  const unit = 10 ** decimals;
  const platforms = Object.keys(byPlatform);
  const free = [];
  for (let i = from; i <= Math.min(to, lockedFrom - 1); i++) free.push(i);
  if (!free.length) return;
  let locked = 0;
  let adjustable = 0;
  for (const p of platforms) {
    for (let i = from; i <= to; i++) {
      if (i < lockedFrom) adjustable += byPlatform[p][i];
      else locked += byPlatform[p][i];
    }
  }
  const factor = adjustable ? (total - locked) / adjustable : 1;
  for (const p of platforms) for (const i of free) byPlatform[p][i] = Math.round(byPlatform[p][i] * factor * unit) / unit;
  let sum = 0;
  for (const p of platforms) for (let i = from; i <= to; i++) sum += byPlatform[p][i];
  const mid = free[Math.floor(free.length / 2)];
  const p0 = platforms.reduce((a, c) => (byPlatform[c][mid] > byPlatform[a][mid] ? c : a));
  byPlatform[p0][mid] = Math.round((byPlatform[p0][mid] + (total - sum)) * unit) / unit;
}

function round(v, d) {
  return Math.round(v * 10 ** d) / 10 ** d;
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
