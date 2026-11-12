import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const arabic = /\p{Script=Arabic}/u;

test('every authored iOS shell message has an English entry and both permission resources are bundled', async () => {
  const catalog = await read('ios/Maydan/NativeLocalization.swift');
  const entries = new Map([...catalog.matchAll(/^\s*"([^"\n]+)": "([^"\n]+)",?$/gm)].map(match => [match[1], match[2]]));
  assert.ok(entries.size >= 20);
  for (const [key, english] of entries) {
    assert.ok(arabic.test(key));
    assert.ok(english.trim());
    assert.equal(arabic.test(english), false, key);
  }
  for (const directory of ['ios/Maydan', 'ios/RewardedPreview']) {
    const files = await readdir(new URL(`../${directory}/`, import.meta.url));
    for (const file of files.filter(file => file.endsWith('.swift'))) {
      const source = await read(`${directory}/${file}`);
      for (const match of source.matchAll(/NativeLocalization\.text\("([^"\n]+)"\)/g)) {
        assert.ok(entries.has(match[1]), `${file}: untranslated ${match[1]}`);
      }
    }
  }
  const permissionKeys = ['CFBundleDisplayName', 'NSCameraUsageDescription', 'NSMicrophoneUsageDescription', 'NSPhotoLibraryUsageDescription'];
  for (const locale of ['ar', 'en']) {
    const source = await read(`ios/Maydan/${locale}.lproj/InfoPlist.strings`);
    const resources = Object.fromEntries([...source.matchAll(/^"(\w+)" = "([^"\n]+)";$/gm)].map(match => [match[1], match[2]]));
    assert.deepEqual(Object.keys(resources).sort(), [...permissionKeys].sort());
    for (const message of Object.values(resources)) assert.equal(arabic.test(message), locale === 'ar');
  }
  const project = await read('ios/Maydan.xcodeproj/project.pbxproj');
  assert.match(project, /NativeLocalization\.swift in Sources/);
  assert.match(project, /InfoPlist\.strings in Resources/);
  for (const locale of ['ar', 'en']) assert.ok(project.includes(`${locale}.lproj/InfoPlist.strings`));
});

test('Android English resources cover every authored string in both capability flavors', async () => {
  for (const flavor of ['main', 'rewardedDemo']) {
    const resources = await Promise.all(['values', 'values-en'].map(async directory => {
      const xml = await read(`android/app/src/${flavor}/res/${directory}/strings.xml`);
      return Object.fromEntries([...xml.matchAll(/<string name="([^"]+)">([^<]+)<\/string>/g)].map(match => [match[1], match[2]]));
    }));
    assert.deepEqual(Object.keys(resources[0]).sort(), Object.keys(resources[1]).sort());
    for (const [key, english] of Object.entries(resources[1])) {
      assert.ok(english.trim(), key);
      assert.equal(arabic.test(english), false, key);
    }
  }
});

test('locale commands retain native main-frame trust and cannot open a connected Android capability', async () => {
  const ios = await read('ios/Maydan/GameViewController.swift');
  const handler = ios.slice(ios.indexOf('func userContentController('));
  const localeCase = handler.indexOf('case "setLocale":');
  assert.ok(localeCase > 0);
  for (const guard of ['message.webView === webView', 'message.frameInfo.isMainFrame', 'isTrustedGameURL(pageURL)']) {
    assert.ok(handler.indexOf(guard) >= 0 && handler.indexOf(guard) < localeCase, guard);
  }
  const android = await read('android/app/src/main/java/com/maydan/partygames/MainActivity.java');
  assert.match(android, /"MaydanLocale"[\s\S]*?view != webView \|\| !mainFrame/);
  assert.match(android, /!isLocalAsset\(Uri\.parse\(view\.getUrl\(\)\)\)/);
  assert.match(android, /data\.length\(\) > 128/);
  assert.match(android, /connect-src 'self'; frame-src 'none'/);
  const manifest = await read('android/app/src/main/AndroidManifest.xml');
  assert.doesNotMatch(manifest, /uses-permission/);
  const androidLocale = await read('android/app/src/main/java/com/maydan/partygames/NativeLocalization.java');
  assert.match(androidLocale, /!"ar"\.equals\(value\) && !"en"\.equals\(value\)/);
  assert.doesNotMatch(androidLocale, /recreate\(|setApplicationLocales/);
});
