// حساب «ميدان بلس» محلي لاختبارات تلعب فئات مقفولة (الحزم التجريبية ليست ضمن الفئات
// العشر المجانية). خادم الحسابات المحلي بالمزوّد الوهمي، ثم دخول ومنح اشتراك عبر
// مساراته الحقيقية: لا يُلمس منطق القفل في الواجهة ولا تُزوَّر استجابة /api/me.
// يتطلب مستندًا مبنيًا بالـAPI على الأصل نفسه: npm run build:cloudflare
import http from 'node:http';
import { startLocalServer } from '../../server/local.mjs';

export const SESSION_KEY = 'maydan:account:session';

export async function startPlusSession({ webOrigin, apiPort = 8797 }) {
  const app = await startLocalServer({ port: apiPort, origins: webOrigin,
    vars: { AUTH_DEV_FAKE: '1', SESSION_SECRET: 'e2e-media-secret' } });
  const call = async (pathname, body, token) => {
    const response = await fetch(`http://127.0.0.1:${apiPort}${pathname}`, { method: 'POST',
      headers: { 'content-type': 'application/json', origin: webOrigin, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body) });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`${pathname} ${response.status} ${JSON.stringify(data)}`);
    return data;
  };
  try {
    const signed = await call('/api/auth/dev', { subject: 'e2e-media', name: 'مختبر الوسائط', client: 'web' });
    const token = signed.session.token;
    const granted = await call('/api/dev/grant', { until: Date.now() + 86_400_000, product: 'plus.yearly' }, token);
    if (!granted.premium?.active) throw new Error('the local Plus grant is not active');
    return { token, close: () => app.close(),
      // يمرّر /api و/health إلى خادم الحسابات كما يفعل العامل على الأصل نفسه.
      proxy(req, res) {
        const { pathname } = new URL(req.url, 'http://localhost');
        if (pathname !== '/health' && pathname !== '/api' && !pathname.startsWith('/api/')) return false;
        const upstream = http.request({ host: '127.0.0.1', port: apiPort, method: req.method, path: req.url, headers: req.headers },
          (answer) => { res.writeHead(answer.statusCode, answer.headers); answer.pipe(res); });
        upstream.on('error', () => { res.writeHead(502); res.end(); });
        req.pipe(upstream);
        return true;
      } };
  } catch (error) { await app.close(); throw error; }
}

// تُحقن قبل أي سكربت في الصفحة: الجلسة كما يحفظها AccountProvider بعد الدخول.
export function installSession(context, token) {
  return context.addInitScript(([key, value]) => {
    try { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ }
  }, [SESSION_KEY, token]);
}

// مستند بُني بلا API (npm run build) لا يطلب /api/me أبدًا فتبقى الحزم مقفولة؛
// رسالة واضحة أفضل من «لم تُختَر الحزم التجريبية». يُستدعى قبل التنقل الأول.
export function watchPremium(page) {
  return page.waitForResponse((r) => new URL(r.url()).pathname === '/api/me' && r.ok(), { timeout: 20_000 })
    .then(async (response) => {
      const me = await response.json();
      if (!me.premium?.active) throw new Error('The local account is not premium.');
    }, () => { throw new Error('No /api/me response: build the document with the API on the same origin (npm run build:cloudflare).'); });
}
