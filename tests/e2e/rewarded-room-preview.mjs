import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { startRewardedPreview } from '../../scripts/rewarded-preview/server.mjs';

const output = process.argv[2] && path.resolve(process.argv[2]);
if (output) await mkdir(output, { recursive: true });

const room = await startRewardedPreview({ port: 4199, apiPort: 8809 });
const origin = new URL(room.url).origin;
const button = (page, name) => page.getByRole('button', { name, exact: true });
const offer = page => page.getByRole('region', { name: 'تحدّي اللمّة التجريبي' });
const watch = page => button(page, 'شاهد إعلان والعب مباراة كاملة');
const screen = (page, stage) => page.locator(`[data-design-screen="online.meenfina.${stage}"]`);
const readClaims = () => room.backend.env.DB.prepare(`
  SELECT source,state FROM rewarded_match_claims WHERE environment='local' AND offer='meenfina-demo'
  AND state<>'released'
  ORDER BY updated_at,match_id`).all();

let browser;
try {
  browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const devices = await Promise.all(Array.from({ length:3 }, async () => {
    const context = await browser.newContext({
      viewport:{ width:390,height:844 },deviceScaleFactor:2,isMobile:true,hasTouch:true,
      locale:'ar',reducedMotion:'reduce',serviceWorkers:'block',
    });
    // A browser regression must never contact production from the local lab.
    await context.route(/.*/, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(8_000);
    return page;
  }));
  const [host, ...guests] = devices;
  const pageErrors = [];
  devices.forEach(page => page.on('pageerror', error => pageErrors.push(error.message)));

  await host.goto(origin + '/#/online/meenfina');
  await host.getByText('مختبر الإعلانات · محلي', { exact:true }).click();
  await host.getByLabel('الحساب التجريبي').selectOption('B');
  await host.getByText('لك مباراة تجريبية كاملة مجانية.', { exact:true }).waitFor();
  await button(host, 'إلى إعداد الغرفة التجريبية').click();
  await host.getByLabel('اسمك في الغرفة').fill('مضيف المعاينة');
  await button(host, 'أنشئ الغرفة').click();
  await host.waitForURL(/#\/room\/\d{6}$/);
  const invite = host.url();
  await host.getByRole('heading',{ name:'غرفة الانتظار' }).waitFor();
  await offer(host).waitFor();
  assert.equal((await readClaims()).results.length,0,'creating a room cannot spend a trial');

  await Promise.all(guests.map(async (guest,index) => {
    await guest.goto(invite);
    await guest.getByLabel('اسمك في الغرفة').fill(index ? 'ضيف ثان' : 'ضيف أول');
    await button(guest,'ادخل الغرفة').click();
    await guest.getByRole('heading',{ name:'غرفة الانتظار' }).waitFor();
    assert.equal(await watch(guest).count(),0);
    assert.equal(await offer(guest).count(),0);
  }));
  const ready = () => Promise.all(devices.map(async page => {
    const notReady = button(page,'أنا جاهز');
    const alreadyReady = button(page,'جاهز ✓ · إلغاء');
    await notReady.or(alreadyReady).waitFor();
    if (await notReady.isVisible()) await notReady.click();
  }));
  const start = () => button(host,'ابدأ اللعب').click();
  await ready();
  await start();
  await Promise.all(devices.map(page => screen(page,'vote').waitFor()));
  assert.deepEqual((await readClaims()).results,[{ source:'trial',state:'committed' }]);

  async function castVotes() {
    await Promise.all(devices.map(async page => {
      await screen(page,'vote').getByRole('group',{ name:'اختر لاعبًا' }).getByRole('button',{ name:'مضيف المعاينة',exact:true }).click();
      await button(page,'تأكيد التصويت').click();
    }));
    await Promise.all(devices.map(page => screen(page,'result').waitFor()));
  }

  async function finishMatch() {
    for (let round = 1; round <= 5; round++) {
      await castVotes();
      await button(host, round === 5 ? 'عرض النتيجة النهائية' : 'الجولة التالية').click();
    }
    await Promise.all(devices.map(page => screen(page,'over').waitFor()));
  }
  await finishMatch();
  await button(host,'العودة للانتظار ولعب مرة ثانية').click();
  await host.getByText('انتهت التجربة المجانية لهذا التحدّي.',{ exact:true }).waitFor();
  assert.equal(await host.getByRole('dialog',{ name:'إعلان اختباري' }).count(),0,'rematch never launches an ad');
  await ready();
  await start();
  const requiredError = host.getByText('تحتاج تذكرة جديدة لهذا التحدّي التجريبي. اختر من بطاقة التحدّي.',{ exact:true });
  await requiredError.waitFor();
  assert.deepEqual((await readClaims()).results,[{ source:'trial',state:'committed' }]);

  await watch(host).click();
  const ad = host.getByRole('dialog',{ name:'إعلان اختباري',exact:true });
  await ad.getByRole('button',{ name:'إكمال المشاهدة التجريبية',exact:true }).click();
  await host.getByText('تذكرتك مؤكدة وجاهزة لمباراة واحدة.',{ exact:true }).waitFor();
  await requiredError.waitFor({ state:'hidden' });
  assert.deepEqual((await readClaims()).results,[{ source:'trial',state:'committed' }],'confirmation grants a ticket, not a start');
  if (output) await host.screenshot({ path:path.join(output,'04-room-lobby.png'),fullPage:true,animations:'disabled' });
  await start();
  await Promise.all(devices.map(page => screen(page,'vote').waitFor()));
  assert.deepEqual((await readClaims()).results,[{ source:'trial',state:'committed' },{ source:'ticket',state:'committed' }]);
  assert.equal(await watch(host).count(),0,'live matches keep the ad action out of sight');

  await guests[0].reload();
  await screen(guests[0],'vote').waitFor();
  assert.equal(await screen(guests[0],'vote').getByRole('button',{ name:'ضيف أول',exact:true }).count(),1);
  await finishMatch();
  assert.deepEqual((await readClaims()).results,[{ source:'trial',state:'committed' },{ source:'ticket',state:'committed' }]);
  assert.deepEqual(pageErrors,[]);
  console.log('PASS private Meenfina Rewarded demo: host + 2 unsigned guests, two complete 5-round matches, rematch gate, explicit ad, ticket start, guest reconnect');
} finally {
  await browser?.close();
  await room.close();
}
