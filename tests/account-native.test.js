// عقد غلاف iOS: ما يولّده prepare.mjs للغلاف، ومطابقة أوامر الجسر وأحداثه وأكواده بين
// الويب (src/shared/account) وSwift (ios/Maydan)، وإعدادات Xcode التي تحتاجها الحسابات.
// لا يترجم Swift هنا (ذلك دور سير iOS build على macOS)، لكنه يمنع انحراف الطرفين.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_API_ORIGIN, migrateHtml, nativeConfig, normalizeApiOrigin } from '../scripts/ios/native.mjs';
import { PRODUCTS } from '../src/shared/account/config.js';
import { ACCOUNT_ERRORS } from '../src/shared/account/errors.js';

const root = process.cwd();
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const swift = Object.fromEntries(readdirSync(path.join(root, 'ios/Maydan')).filter((f) => f.endsWith('.swift')).map((f) => [f, read(`ios/Maydan/${f}`)]));
const allSwift = Object.values(swift).join('\n');
const webAccount = ['AccountProvider.jsx', 'native.js', 'Paywall.jsx', 'AccountCard.jsx', 'SignInSheet.jsx'].map((f) => read(`src/shared/account/${f}`)).join('\n');

test('native-config: أصل https مطلق ومنتجا الاشتراك نفسهما اللذان يعرفهما الويب', () => {
  const config = nativeConfig({ apiOrigin: DEFAULT_API_ORIGIN });
  assert.equal(config.apiOrigin, DEFAULT_API_ORIGIN);
  assert.deepEqual(config.products, PRODUCTS);
  assert.equal(config.authCallback, 'maydan://auth');
  assert.equal(normalizeApiOrigin('https://example.test/path?x=1'), 'https://example.test', 'الأصل فقط');
  assert.equal(normalizeApiOrigin(''), '');
  assert.throws(() => normalizeApiOrigin('http://insecure.test'), /https/);
  assert.throws(() => normalizeApiOrigin('same-origin'), /صالح/);
});

test('migrate.html يرسل كل localStorage عبر جسر maydan برسالة migrate', () => {
  const html = migrateHtml();
  assert.match(html, /localStorage\.key\(i\)/);
  assert.match(html, /messageHandlers\.maydan\.postMessage\(\{ type: 'migrate', entries: entries \}\)/);
  assert.doesNotMatch(html, /maydan:/, 'لا ترشيح بالبادئة: كل مفاتيح الأصل القديم تنتقل');
  assert.match(swift['StorageMigration.swift'], /body\["type"\] as\? String == "migrate"/);
  assert.match(swift['StorageMigration.swift'], /localStorage\.getItem\(key\) === null/, 'الزرع لا يكتب فوق مفتاح موجود');
});

test('كل أمر يناديه الويب عبر callNative له حالة في GameViewController', () => {
  const commands = [...webAccount.matchAll(/callNative\('([a-zA-Z]+)'/g)].map((m) => m[1]);
  assert.ok(commands.length >= 6, `أوامر الويب: ${commands.join(', ')}`);
  for (const command of new Set(commands)) {
    assert.match(swift['GameViewController.swift'], new RegExp(`case "${command}":`), `الغلاف لا يعرف الأمر ${command}`);
  }
  // الأوامر القديمة بلا وعد تبقى كما هي.
  for (const legacy of ['haptic', 'share']) assert.match(swift['GameViewController.swift'], new RegExp(`case "${legacy}":`));
});

test('كل حدث يبثّه الغلاف له مستمع في الويب، والردود عبر maydanNative.resolve', () => {
  const events = [...swift['GameViewController.swift'].matchAll(/emit\(event: "([a-zA-Z]+)"/g)].map((m) => m[1]);
  assert.ok(events.includes('authReturn') && events.includes('transaction'), events.join(', '));
  for (const name of new Set(events)) {
    assert.match(webAccount, new RegExp(`onNativeEvent\\('${name}'`), `لا مستمع للحدث ${name}`);
  }
  assert.match(swift['GameViewController.swift'], /window\.maydanNative && window\.maydanNative\.resolve\(/);
  assert.match(swift['GameViewController.swift'], /window\.maydanNative && window\.maydanNative\.event\(/);
  assert.match(read('src/shared/account/native.js'), /resolve: \(id, response\) => resolveNative\(id, response \|\| \{\}\)/);
});

test('أكواد رفض الغلاف كلها معروفة في ACCOUNT_ERRORS، والإلغاء صامت في الويب', () => {
  const codes = [...swift['GameViewController.swift'].matchAll(/case \w+ = "([A-Z_]+)"/g)].map((m) => m[1]);
  assert.ok(codes.length >= 5, codes.join(', '));
  for (const code of codes) assert.ok(code in ACCOUNT_ERRORS, `كود غير معروف للويب: ${code}`);
  assert.ok(codes.includes('PURCHASE_CANCELLED') && codes.includes('PURCHASE_PENDING'));
  assert.match(read('src/shared/account/AccountProvider.jsx'), /code !== 'PURCHASE_CANCELLED'\) toast/);
});

test('الشراء يمرّر معرّف المستخدم كـappAccountToken، وopenAuth محصور بمضيف الـAPI', () => {
  const provider = read('src/shared/account/AccountProvider.jsx');
  assert.match(provider, /callNative\('purchase', \{[^}]*userId[^}]*\}/);
  assert.match(swift['GameViewController.swift'], /UUID\(uuidString: \$0\)/);
  assert.match(swift['StoreManager.swift'], /\.appAccountToken\(token\)/);
  assert.match(swift['GameViewController.swift'], /NativeConfig\.shared\.isTrustedAuthURL\(url\)/);
  assert.match(swift['NativeConfig.swift'], /url\.scheme\?\.lowercased\(\) == "https"/);
  // عودة المصادقة: الويب يطلب maydan://auth والغلاف يقرأ code منه.
  assert.match(provider, /returnUrl: 'maydan:\/\/auth'/);
  assert.match(swift['NativeConfig.swift'], /authCallbackHost = "auth"/);
});

test('الأصل الجديد maydan://app: المخطط في المعالج، والثقة في الجسر والتنقل عليه', () => {
  assert.match(swift['AppSchemeHandler.swift'], /static let scheme = "maydan"/);
  assert.match(swift['AppSchemeHandler.swift'], /static let host = "app"/);
  assert.match(swift['AppSchemeHandler.swift'], /"Content-Range"/, 'الوسائط تحتاج Range');
  assert.match(swift['AppSchemeHandler.swift'], /!components\.contains\("\.\."\)/, 'حراسة الصعود');
  assert.match(swift['GameViewController.swift'], /setURLSchemeHandler\(AppSchemeHandler\(directory: directory\), forURLScheme: AppSchemeHandler\.scheme\)/);
  assert.match(swift['GameViewController.swift'], /AppSchemeHandler\.isAppURL\(url\)/);
  assert.doesNotMatch(swift['GameViewController.swift'], /loadFileURL/, 'اللعبة لم تعد تُحمَّل من file://');
  assert.match(read('src/shared/account/native.js'), /location\.protocol === 'maydan:'/);
});

test('مشروع Xcode: كل ملف Swift مضاف، والاستحقاقات والمخطط والخصوصية مضبوطة', () => {
  const project = read('ios/Maydan.xcodeproj/project.pbxproj');
  for (const file of Object.keys(swift)) {
    assert.match(project, new RegExp(`/\\* ${file.replace('.', '\\.')} in Sources \\*/`), `${file} ليس في مرحلة المصادر`);
  }
  assert.match(project, /CODE_SIGN_ENTITLEMENTS = Maydan\/Maydan\.entitlements;/);
  assert.match(project, /com\.apple\.InAppPurchase = \{enabled = 1;\}/);
  assert.match(project, /com\.apple\.SignInWithApple = \{enabled = 1;\}/);
  assert.match(read('ios/Maydan/Maydan.entitlements'), /com\.apple\.developer\.applesignin/);
  assert.match(read('ios/Maydan/Info.plist'), /<string>maydan<\/string>/);
  const privacy = read('ios/Maydan/PrivacyInfo.xcprivacy');
  for (const type of ['EmailAddress', 'Name', 'UserID', 'PurchaseHistory']) assert.match(privacy, new RegExp(`NSPrivacyCollectedDataType${type}`));
  assert.match(privacy, /NSPrivacyAccessedAPICategoryUserDefaults/);
  const store = JSON.parse(read('ios/app-store.json'));
  assert.deepEqual(store.inAppPurchases.products.map((p) => p.id).sort(), Object.values(PRODUCTS).sort());
  assert.equal(store.preparedVersion, '1.5');
  assert.match(project, /MARKETING_VERSION = 1\.5;/);
});
