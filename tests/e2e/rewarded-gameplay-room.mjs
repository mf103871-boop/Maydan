// Loopback-only browser acceptance for the real online policy, never AdMob
// traffic or a production account. SSV verification has separate server tests.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startRewardedPreview } from '../../scripts/rewarded-preview/server.mjs';
import { TICKET_POLICY } from '../../src/shared/account/gameplay-policy.mjs';

const app = await startRewardedPreview({ port: 4197, apiPort: 8807 });
app.backend.env.GAMEPLAY_ACCESS_POLICY = TICKET_POLICY;
const origin = new URL(app.url).origin;
const button = (page, name) => page.getByRole('button', { name, exact: true });
const offer = page => page.getByRole('region', { name: 'بدء مباراة مين فينا', exact: true });
const screen = (page, phase) => page.locator(`[data-design-screen="online.meenfina.${phase}"]`);
const claims = async () => (await app.backend.env.DB.prepare("SELECT source,state FROM rewarded_match_claims WHERE offer='meenfina-online' AND state!='released' ORDER BY updated_at,match_id").all()).results;
let browser;
try {
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];
  const pages = await Promise.all(Array.from({ length: 3 }, async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
      isMobile: true, hasTouch: true, locale: 'ar', reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.route(/.*/, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.on('pageerror', value => errors.push(value.message));
    return page;
  }));
  const [host, ...guests] = pages;
  await host.goto(origin + '/#/online/meenfina');
  await host.getByText('مختبر الإعلانات · محلي', { exact: true }).click();
  await host.getByLabel('الحساب التجريبي').selectOption('B');
  await button(host, 'إنشاء غرفة جديدة').click();
  await host.getByLabel('اسمك في الغرفة').fill('مضيف المعاينة');
  await button(host, 'أنشئ الغرفة').click();
  await host.waitForURL(/#\/room\/\d{6}$/);
  const invite = host.url();
  await offer(host).waitFor();
  await host.getByText('لك مباراة تجريبية كاملة مجانية.', { exact: true }).waitFor();
  assert.deepEqual(await claims(), [], 'lobby, ready and account reads cannot spend credit');
  await Promise.all(guests.map(async (guest, index) => {
    await guest.goto(invite);
    await guest.getByLabel('اسمك في الغرفة').fill(index ? 'ضيف ثان' : 'ضيف أول');
    await button(guest, 'ادخل الغرفة').click();
    await guest.getByRole('heading', { name: 'غرفة الانتظار', exact: true }).waitFor();
    assert.equal(await offer(guest).count(), 0, 'joining never mounts the monetization surface');
  }));
  const ready = async () => {
    await Promise.all(pages.map(async page => {
      const pending = button(page, 'أنا جاهز');
      await pending.or(button(page, 'جاهز ✓ · إلغاء')).waitFor();
      if (await pending.isVisible()) await pending.click();
    }));
  };
  const start = () => button(host, 'ابدأ اللعب').click();
  async function finish() {
    for (let round = 1; round <= 5; round++) {
      await Promise.all(pages.map(async page => {
        await screen(page, 'vote').getByRole('group', { name: 'اختر لاعبًا' }).getByRole('button', { name: 'مضيف المعاينة', exact: true }).click();
        await button(page, 'تأكيد التصويت').click();
      }));
      await Promise.all(pages.map(page => screen(page, 'result').waitFor()));
      await button(host, round === 5 ? 'عرض النتيجة النهائية' : 'الجولة التالية').click();
    }
    await Promise.all(pages.map(page => screen(page, 'over').waitFor()));
  }
  await ready(); await start();
  await Promise.all(pages.map(page => screen(page, 'vote').waitFor()));
  assert.deepEqual(await claims(), [{ source: 'trial', state: 'committed' }]);
  assert.equal(await offer(host).count(), 0, 'no ads or offer overlays during a live match');
  await finish();
  await button(host, 'العودة للانتظار ولعب مرة ثانية').click();
  await host.getByText('انتهت التجربة المجانية لهذا التحدّي.', { exact: true }).waitFor();
  await ready();
  assert.equal(await button(host, 'ابدأ اللعب').isDisabled(), true);
  await host.getByText('مختبر الإعلانات · محلي', { exact: true }).click();
  await host.getByLabel('نتيجة المحاكاة').selectOption('empty');
  await button(host, 'شاهد إعلان والعب مباراة كاملة').click();
  await host.getByText('لا يوجد إعلان متاح الآن. يمكنك متابعة اللعب المجاني.', { exact: true }).waitFor();
  assert.equal(await button(host, 'ابدأ اللعب').isDisabled(), true, 'no-fill never grants a match');
  assert.deepEqual(await claims(), [{ source: 'trial', state: 'committed' }]);
  await host.getByText('مختبر الإعلانات · محلي', { exact: true }).click();
  await host.getByLabel('نتيجة المحاكاة').selectOption('complete');
  await button(host, 'شاهد إعلان والعب مباراة كاملة').click();
  await host.getByRole('dialog', { name: 'إعلان اختباري', exact: true }).getByRole('button', { name: 'إكمال المشاهدة التجريبية', exact: true }).click();
  await host.getByText('تذكرتك مؤكدة وجاهزة لمباراة واحدة.', { exact: true }).waitFor();
  assert.equal(await button(host, 'ابدأ اللعب').isEnabled(), true);
  assert.deepEqual(await claims(), [{ source: 'trial', state: 'committed' }], 'SSV grants credit, not a match start');
  await start();
  await Promise.all(pages.map(page => screen(page, 'vote').waitFor()));
  assert.deepEqual(await claims(), [{ source: 'trial', state: 'committed' }, { source: 'ticket', state: 'committed' }]);
  await guests[0].reload();
  await screen(guests[0], 'vote').waitFor();
  assert.equal(await offer(guests[0]).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS real Meenfina policy: first match, free guests, full rematch gate, no-fill, opt-in simulated reward, ticket start and reconnect');
} finally {
  await browser?.close();
  await app.close();
}
