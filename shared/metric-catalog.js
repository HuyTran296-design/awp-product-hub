// Baseline metric catalog: name, source, aggregation and "good" direction.
//
// aggregation:
//   sum    – cộng dồn over the period (target scales with period)
//   avg    – mean of daily combined values (target kept)
//   ratio  – rate (target kept)
//   latest – value on the last day (target kept)
// platformCombine: how per-platform daily values merge into one daily value
//   sum | mean | derived (computed from component metrics)
// sourceShort: label of the native connector ("GA4", "App Store Connect + Google Play", "Nhập thủ công", …)
// nativeSource: 'auto' (a connector feeds daily data) or 'manual' (no connector exists — entered by an Admin)
// types: product types that list the metric (default: app/web products); phase: 'build' = Xây dựng baselines

/** Tooltip of every "Doanh thu" label. */
export const REVENUE_TIP = 'Tổng doanh thu từ App Store, Google Play và YouTube Playables, đã trừ phí nền tảng, quy ra VND';
export const PLAYABLES_REVENUE_NOTE = 'Doanh thu từ YouTube Playables có thể bằng 0 trong giai đoạn đầu';

export const METRIC_CATALOG = [
  // The only revenue metric: what the team actually receives (after Store / platform fees), in VND, one row per
  // platform. YouTube Playables has no connector: its part is entered by hand or imported from CSV (manualPlatforms).
  {
    key: 'revenue', name: 'Doanh thu', short: 'Doanh thu',
    source: 'App Store Connect (iOS) + Google Play Console (Android) + YouTube Playables (nhập thủ công / CSV)', sourceShort: 'App Store Connect + Google Play',
    aggregation: 'sum', direction: 'higher', unit: 'vnd', platforms: ['ios', 'android', 'playables'], platformCombine: 'sum',
    manualPlatforms: ['playables'], note: REVENUE_TIP,
  },
  {
    key: 'downloads', name: 'Lượt tải mới', short: 'Lượt tải',
    source: 'App Store Connect (first-time downloads) + Google Play (installs)', sourceShort: 'App Store Connect + Google Play',
    aggregation: 'sum', direction: 'higher', unit: 'count', platforms: ['ios', 'android'], platformCombine: 'sum',
    noun: 'lượt tải',
  },
  {
    key: 'dau', name: 'Người dùng hoạt động/ngày (DAU TB)', short: 'DAU',
    source: 'GA4', sourceShort: 'GA4', aggregation: 'avg', direction: 'higher', unit: 'count', platforms: ['ios', 'android'], platformCombine: 'sum',
    noun: 'người',
  },
  {
    key: 'new_users', name: 'Người dùng mới', short: 'Người dùng mới',
    source: 'GA4', sourceShort: 'GA4', aggregation: 'sum', direction: 'higher', unit: 'count', platforms: ['ios', 'android'], platformCombine: 'sum',
    extra: { playables: 'players' }, combinedName: 'Người dùng mới / Người chơi',
    combinedNote: 'Tổng của các nền tảng – một người có thể được đếm ở nhiều nền tảng',
    noun: 'người',
  },
  {
    key: 'retention_d7', name: 'Tỷ lệ giữ chân D7', short: 'Giữ chân D7',
    source: 'GA4', sourceShort: 'GA4', aggregation: 'ratio', direction: 'higher', unit: 'pct', platforms: ['ios', 'android'], platformCombine: 'mean',
  },
  {
    key: 'engagement_time', name: 'Thời gian tương tác TB/người', short: 'Tương tác TB',
    source: 'GA4', sourceShort: 'GA4', aggregation: 'avg', direction: 'higher', unit: 'seconds', platforms: ['ios', 'android'], platformCombine: 'mean',
  },
  {
    key: 'key_conversions', name: 'Lượt chuyển đổi chính', short: 'Chuyển đổi chính',
    source: 'GA4 (key event, ví dụ bắt đầu dùng thử)', sourceShort: 'GA4', aggregation: 'sum', direction: 'higher', unit: 'count',
    platforms: ['ios', 'android'], platformCombine: 'sum', noun: 'lượt chuyển đổi',
  },
  {
    key: 'click_download', name: 'Click "Tải app" trên web', short: 'Click "Tải app"',
    source: 'GA4 (event click_download)', sourceShort: 'GA4', aggregation: 'sum', direction: 'higher', unit: 'count', platforms: ['web'], platformCombine: 'sum',
    noun: 'lượt click',
  },
  {
    key: 'store_conversion', name: 'Tỷ lệ chuyển đổi trang Store', short: 'CR trang Store',
    source: 'App Store Connect + Google Play', sourceShort: 'App Store Connect + Google Play', aggregation: 'ratio', direction: 'higher', unit: 'pct',
    platforms: ['ios', 'android'], platformCombine: 'derived', numerator: 'downloads', denominator: 'store_page_views',
    note: 'Xem trang → tải',
  },
  {
    key: 'store_rating', name: 'Điểm đánh giá Store', short: 'Điểm Store',
    source: 'App Store Connect + Google Play', sourceShort: 'App Store Connect + Google Play', aggregation: 'latest', direction: 'higher', unit: 'rating',
    platforms: ['ios', 'android'], platformCombine: 'mean',
  },
  {
    key: 'crash_rate_android', name: 'Tỷ lệ crash Android', short: 'Crash Android',
    source: 'Google Play vitals', sourceShort: 'Google Play', aggregation: 'ratio', direction: 'lower', unit: 'pct', platforms: ['android'], platformCombine: 'mean',
  },
];

export const PLAYABLES = 'youtube_playables';
const MANUAL = 'Nhập thủ công (Playables Developer Portal / YouTube Studio) hoặc CSV';

// Game YouTube Playables: no store/app connector — values are entered manually or imported from CSV.
METRIC_CATALOG.push(
  { key: 'plays', name: 'Lượt chơi', short: 'Lượt chơi', source: MANUAL, sourceShort: 'Nhập thủ công', nativeSource: 'manual',
    aggregation: 'sum', direction: 'higher', unit: 'count', platforms: ['all'], platformCombine: 'sum', noun: 'lượt chơi', types: [PLAYABLES] },
  { key: 'players', name: 'Người chơi', short: 'Người chơi', source: MANUAL, sourceShort: 'Nhập thủ công', nativeSource: 'manual',
    aggregation: 'sum', direction: 'higher', unit: 'count', platforms: ['all'], platformCombine: 'sum', noun: 'người chơi', types: [PLAYABLES] },
  { key: 'play_time', name: 'Thời gian chơi TB/người', short: 'Thời gian chơi TB', source: MANUAL, sourceShort: 'Nhập thủ công', nativeSource: 'manual',
    aggregation: 'avg', direction: 'higher', unit: 'minutes', platforms: ['all'], platformCombine: 'mean', types: [PLAYABLES] },
  { key: 'return_rate', name: 'Tỷ lệ người chơi quay lại', short: 'Tỷ lệ quay lại', source: MANUAL, sourceShort: 'Nhập thủ công', nativeSource: 'manual',
    aggregation: 'ratio', direction: 'higher', unit: 'pct', platforms: ['all'], platformCombine: 'mean', types: [PLAYABLES] },
  { key: 'channel_views', name: 'Lượt xem video kênh', short: 'Lượt xem kênh', source: 'YouTube Analytics (kênh)', sourceShort: 'YouTube Analytics', nativeSource: 'auto',
    aggregation: 'sum', direction: 'higher', unit: 'count', platforms: ['youtube'], platformCombine: 'sum', noun: 'lượt xem', types: [PLAYABLES] },
);

// Xây dựng (build phase): progress indicators entered manually, for every product type.
METRIC_CATALOG.push(
  { key: 'feature_progress', name: 'Tiến độ tính năng', short: 'Tiến độ tính năng', source: 'Nhập thủ công (% thực tế; mục tiêu = % kế hoạch)', sourceShort: 'Nhập thủ công', nativeSource: 'manual',
    aggregation: 'latest', direction: 'higher', unit: 'pct', platforms: ['all'], platformCombine: 'mean', phase: 'build' },
  { key: 'waitlist', name: 'Người đăng ký chờ (waitlist)', short: 'Waitlist', source: 'Nhập thủ công', sourceShort: 'Nhập thủ công', nativeSource: 'manual',
    aggregation: 'latest', direction: 'higher', unit: 'count', platforms: ['all'], platformCombine: 'mean', noun: 'người', phase: 'build' },
  { key: 'beta_testers', name: 'Người dùng thử (TestFlight / bản thử nội bộ)', short: 'Người dùng thử', source: 'Nhập thủ công', sourceShort: 'Nhập thủ công', nativeSource: 'manual',
    aggregation: 'latest', direction: 'higher', unit: 'count', platforms: ['all'], platformCombine: 'mean', noun: 'người', phase: 'build' },
  { key: 'budget_burn', name: 'Chi phí lũy kế so với ngân sách', short: 'Chi phí lũy kế', source: 'Nhập thủ công (chi phí lũy kế, VND)', sourceShort: 'Nhập thủ công', nativeSource: 'manual',
    aggregation: 'latest', direction: 'lower', unit: 'vnd', platforms: ['all'], platformCombine: 'mean', phase: 'build', budget: true,
    note: '% đạt = ngân sách theo kế hoạch đến hôm nay ÷ chi phí lũy kế' },
);

/** Platforms that are both a release platform and a data dimension of a metric. */
export const RELEASE_DATA_PLATFORMS = ['ios', 'android', 'playables'];

/**
 * Where a project's manual values of a metric are kept: the platform without connector when the project releases on
 * it (Doanh thu of a product on YouTube Playables → "playables"), else 'all' (the whole metric).
 */
export function manualPlatformOf(metricKey, projectPlatforms = []) {
  return getMetricDef(metricKey)?.manualPlatforms?.find((p) => projectPlatforms.includes(p)) ?? 'all';
}

/** Release platforms that make a metric available. */
export function metricReleasePlatforms(m) {
  if (m.phase === 'build') return null; // every project
  if (m.types?.includes(PLAYABLES)) return ['playables'];
  if (m.platforms.includes('web')) return ['web'];
  const base = m.platforms.filter((p) => RELEASE_DATA_PLATFORMS.includes(p));
  return [...base, ...Object.keys(m.extra ?? {})];
}

/**
 * Baselines offered for the selected release platforms (union) + build-phase indicators.
 * Legacy calls with a product type string still work.
 */
export function catalogFor(platformsOrType) {
  const platforms = Array.isArray(platformsOrType) ? platformsOrType
    : platformsOrType === PLAYABLES ? ['playables', 'web'] : ['ios', 'android', 'web'];
  return METRIC_CATALOG.filter((m) => {
    const rp = metricReleasePlatforms(m);
    return !rp || rp.some((p) => platforms.includes(p));
  });
}

/** Revenue for P&L is always "Doanh thu" (all platforms: iOS, Android, YouTube Playables). */
export const revenueMetricFor = () => 'revenue';

export const SOURCE_LABELS = { manual: 'Nhập thủ công', csv: 'Tải lên CSV' };
export const MANUAL_PERIODS = { day: 'Ngày', week: 'Tuần', month: 'Tháng' };

/** Label of a baseline source: "auto" is the metric's native connector. */
export function sourceLabel(metricKey, source) {
  if (source === 'auto') return getMetricDef(metricKey)?.sourceShort ?? 'Kết nối';
  return SOURCE_LABELS[source] ?? source;
}

export const AGGREGATION_LABELS = { sum: 'Cộng dồn', avg: 'Trung bình', ratio: 'Tỷ lệ', latest: 'Giá trị mới nhất' };

export function getMetricDef(key) {
  return METRIC_CATALOG.find((m) => m.key === key);
}

/** Only cumulative metrics scale their target with the period length. */
export function scalesWithPeriod(metricKey) {
  return getMetricDef(metricKey)?.aggregation === 'sum';
}
