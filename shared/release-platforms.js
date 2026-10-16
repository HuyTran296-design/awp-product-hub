// Release platforms ("Nền tảng phát hành") — multi-select; they replace "Loại sản phẩm".
// They decide which connections are shown, which baselines are offered and how multi-platform metrics combine.

export const RELEASE_PLATFORMS = {
  ios: { label: 'iOS', color: '#2B59C3', connections: ['app_store', 'ga4'] },
  android: { label: 'Android', color: '#E58A35', connections: ['google_play', 'ga4'] },
  web: { label: 'Website', color: '#5B6170', connections: ['ga4'] },
  playables: { label: 'YouTube Playables', short: 'Playables', color: '#C4302B', connections: ['youtube'], manual: true },
};

/** Marketing extra (not a release platform). */
export const BLOG = 'blog';

export const releasePlatformsOf = (platforms) => (platforms || []).filter((p) => RELEASE_PLATFORMS[p]);

/** Connections to show for the selected platforms (GA4 also carries app analytics for iOS/Android). */
export function connectionsFor(platforms) {
  const set = new Set(releasePlatformsOf(platforms).flatMap((p) => RELEASE_PLATFORMS[p].connections));
  return ['ga4', 'app_store', 'google_play', 'youtube'].filter((c) => set.has(c));
}

/** Legacy product type derived from platforms (kept for older data and the Playables-only layout). */
export function productTypeFor(platforms) {
  const p = releasePlatformsOf(platforms);
  return p.includes('playables') && !p.includes('ios') && !p.includes('android') ? 'youtube_playables' : 'mobile_app';
}

export const platformLabel = (p) => RELEASE_PLATFORMS[p]?.short ?? RELEASE_PLATFORMS[p]?.label ?? (p === 'blog' ? 'Blog' : p);
