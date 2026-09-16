// ما يحتاجه غلاف iOS إلى جانب ملفات اللعبة: إعداد الغلاف وصفحة انتقال المحفوظات.
// نقي بلا ملفات كي تختبره tests/account-native.test.js مباشرة.
import { PRODUCTS } from '../../src/shared/account/config.js';

export const DEFAULT_API_ORIGIN = 'https://maydan-game.mf103871.workers.dev';

// أصل الـAPI: https مطلق بلا مسار ولا استعلام. الغلاف يقصر متصفح المصادقة عليه.
export function normalizeApiOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let url;
  try { url = new URL(raw); } catch { throw new Error(`MAYDAN_ROOMS_URL ليس رابطًا صالحًا: ${raw}`); }
  if (url.protocol !== 'https:') throw new Error(`غلاف iOS يحتاج أصل https للـAPI، لا ${url.protocol}`);
  return url.origin;
}

// www/native-config.json: يقرؤه NativeConfig.swift عند الإقلاع.
export function nativeConfig({ apiOrigin }) {
  return { version: 1, apiOrigin: normalizeApiOrigin(apiOrigin), products: { ...PRODUCTS }, authCallback: 'maydan://auth' };
}

// www/migrate.html: تُحمَّل مرة واحدة من file:// (الأصل القديم) في عرض مخفي وترسل
// كل localStorage عبر الجسر، فيزرعه الغلاف في الأصل الجديد maydan://app.
export function migrateHtml() {
  return `<!doctype html>
<html lang="ar"><head><meta charset="utf-8"><title>انتقال المحفوظات</title></head>
<body><script>
(function () {
  var entries = {};
  try {
    for (var i = 0; i < localStorage.length; i += 1) {
      var key = localStorage.key(i);
      if (key !== null) entries[key] = localStorage.getItem(key);
    }
  } catch (error) {}
  try { window.webkit.messageHandlers.maydan.postMessage({ type: 'migrate', entries: entries }); } catch (error) {}
})();
</script></body></html>
`;
}
