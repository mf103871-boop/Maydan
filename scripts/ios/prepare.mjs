import { appendFile, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { migrateHtml, nativeConfig } from './native.mjs';
import { resolveNativeBuildOrigin } from './release-environment.mjs';
import { resolveRewardedBuild } from './rewarded-config.mjs';
import { generateSignedRewardedProject } from './rewarded-preview.mjs';
import { resolveReleaseFeatures, writePreparedFeatures } from './release-features.mjs';

// الغلاف يتصل بخادم الغرف والحسابات المنشور (يُبدَّل بـ MAYDAN_ROOMS_URL)؛ يُضبط قبل
// استيراد أدوات البناء لأن esbuild يقرأ المتغير عند إعداد الخيارات.
const apiOrigin = resolveNativeBuildOrigin(process.env);
const rewarded = resolveRewardedBuild(process.env);
resolveReleaseFeatures(process.env);
process.env.MAYDAN_ROOMS_URL = apiOrigin;
const { buildOnce, esbuildOptions, ROOT, DIST } = await import('../lib.mjs');

// Build from this checkout on every invocation; never ship a stale copied bank.
const build = await buildOnce({ minify: true, includeStudio: false, version: process.env.IOS_VERSION, rewardedPreview: Boolean(rewarded) });
const defines = esbuildOptions({ rewardedPreview: Boolean(rewarded) }).define;
const projectDir = rewarded ? await generateSignedRewardedProject(process.env) : path.join(ROOT, 'ios');
const destination = path.join(projectDir, 'Maydan/www');
if (!rewarded) await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(DIST, destination, { recursive: true });

async function verifyDirectory(source, target) {
  let count = 0;
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) count += await verifyDirectory(from, to);
    else {
      const [expected, actual] = await Promise.all([readFile(from), readFile(to)]);
      if (!expected.equals(actual)) throw new Error(`iOS resource differs: ${entry.name}`);
      count += 1;
    }
  }
  return count;
}

const files = await verifyDirectory(DIST, destination);
// ملفان خاصان بالغلاف لا يوجدان في dist: إعداد الغلاف وصفحة انتقال المحفوظات.
const config = nativeConfig({ apiOrigin });
if (rewarded) config.rewarded = { mode: rewarded.mode, appId: rewarded.appId, adUnit: rewarded.adUnit,
  ...(rewarded.testVersion ? { testVersion: rewarded.testVersion } : {}) };
await writeFile(path.join(destination, 'native-config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
await writeFile(path.join(destination, 'migrate.html'), migrateHtml(), 'utf8');
const features = await writePreparedFeatures({ projectDir, destination, build, defines });
console.log(`Prepared release feature receipt SHA-256 ${features.sha256}; ${features.evidence}`);
// Derive Xcode's required slots from the approved release artwork.
const iconDirectory = path.join(projectDir, 'Maydan/Assets.xcassets/AppIcon.appiconset');
const sourceIcon = await readFile(path.join(iconDirectory, 'icon-1024.png'));
const catalog = JSON.parse(await readFile(path.join(iconDirectory, 'Contents.json'), 'utf8'));
const generated = new Map();
for (const slot of catalog.images) {
  if (!slot.filename || slot.filename === 'icon-1024.png') continue;
  const side = Number(slot.size.split('x')[0]) * Number(slot.scale.replace('x', ''));
  if (generated.has(slot.filename) && generated.get(slot.filename) !== side) throw new Error('Inconsistent app icon sizes');
  if (generated.has(slot.filename)) continue;
  await sharp(sourceIcon).resize(side, side).removeAlpha().png().toFile(path.join(iconDirectory, slot.filename));
  generated.set(slot.filename, side);
}
const hash = createHash('sha256').update(await readFile(path.join(destination, 'index.html'))).digest('hex');
const relativeProjectDir = path.relative(ROOT, projectDir).split(path.sep).join('/');
if (rewarded) console.log(`iOS Rewarded project (${rewarded.mode}): ${relativeProjectDir}/Maydan.xcodeproj`);
if (process.env.GITHUB_ENV) await appendFile(process.env.GITHUB_ENV, `IOS_PROJECT_DIR=${relativeProjectDir}\n`);
console.log(`iOS resources ready: ${files} files; ${build.buildId}; HTML SHA-256 ${hash}; API ${apiOrigin}`);
