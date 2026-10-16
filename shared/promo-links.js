// Tracking links for a "Promote từ nền tảng khác" source: web UTM, App Store campaign link (ct=), Google Play UTM referrer.

export const PROMO_CODE_RE = /^[a-z0-9][a-z0-9_]{2,39}$/;

/** "Mindfulness Bell" -> "promo_mindfulness_bell" (Vietnamese diacritics removed). */
export function suggestPromoCode(name) {
  const base = String(name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/^tu\s+/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 33);
  return base ? `promo_${base}` : '';
}

/**
 * @param {{slug:string, platforms:string[], websiteUrl?:string, appId?:string, providerToken?:string, packageName?:string}} p
 * @returns {{key:string, label:string, url:string, missing?:string}[]}
 */
export function promoLinks(p, code) {
  const utm = `utm_source=${code}&utm_medium=promote&utm_campaign=${p.slug}`;
  const links = [{ key: 'web', label: 'Link web (UTM · GA4)', url: `${p.websiteUrl || `https://${p.slug}.abcdigital.io/`}?${utm}` }];
  if (p.platforms.includes('ios')) {
    links.push({ key: 'ios', label: 'Campaign link App Store', missing: p.appId ? (p.providerToken ? null : 'Chưa có Provider token trong kết nối App Store Connect') : 'Chưa có App ID trong kết nối App Store Connect',
      url: `https://apps.apple.com/app/apple-store/id${p.appId || '<App ID>'}?${p.providerToken ? `pt=${p.providerToken}&` : ''}ct=${code}&mt=8` });
  }
  if (p.platforms.includes('android')) {
    links.push({ key: 'android', label: 'Link Google Play (UTM)', missing: p.packageName ? null : 'Chưa có Package name trong kết nối Google Play Console',
      url: `https://play.google.com/store/apps/details?id=${p.packageName || '<package name>'}&referrer=${encodeURIComponent(utm)}` });
  }
  return links;
}
