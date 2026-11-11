import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { buildOnce, DIST, ROOT } from '../lib.mjs';
import { ticketPolicyEnabled } from '../../src/shared/account/gameplay-policy.mjs';

const generatedParent = path.join(ROOT, 'android/app/build/generated');
const generated = path.join(generatedParent, 'maydan');
if (path.resolve(process.argv[2] || '.') !== generated) {
  throw new Error('Use the Android project’s generated asset directory.');
}
if (process.env.MAYDAN_PRIVATE_AUDIO_PREVIEW === '1' || process.env.MAYDAN_WARMTH_PREVIEW === '1') {
  throw new Error('Private preview media is forbidden in the Android proof.');
}
if (ticketPolicyEnabled(process.env.MAYDAN_GAMEPLAY_ACCESS_POLICY)) {
  throw new Error('The offline Android proof cannot enable account-bound tickets.');
}

// Keep Gradle’s resource tree exact on repeat builds. Verify the physical
// parent and target before recursively removing any generated content.
await mkdir(generated, { recursive: true });
const normalized = value => value.replaceAll('\\', '/').toLowerCase();
const resolvedRoot = await realpath(ROOT);
const expected = path.join(resolvedRoot, 'android/app/build/generated/maydan');
if (normalized(await realpath(generated)) !== normalized(expected)) {
  throw new Error('Android output directory resolves outside the intended checkout.');
}
await rm(generated, { recursive: true, force: true });
await mkdir(path.join(generated, 'assets'), { recursive: true });

const version = '1.9';
const { buildId } = await buildOnce({ minify: true, includeStudio: false, version, roomsUrl: '' });
const excluded = new Set(['pricing', 'pay.html', 'sw.js', '_headers', '_redirects']);
const assets = path.join(generated, 'assets');
await cp(DIST, assets, { recursive: true, filter: source => {
  const [entry] = path.relative(DIST, source).split(path.sep);
  return !excluded.has(entry);
} });
const icon = path.join(generated, 'res/drawable-nodpi/maydan_launcher.png');
await mkdir(path.dirname(icon), { recursive: true });
await sharp(path.join(ROOT, 'public/icons/icon-1024.png')).resize(192).png().toFile(icon);

const html = await readFile(path.join(assets, 'index.html'));
const receipt = {
  version,
  buildId,
  htmlSha256: createHash('sha256').update(html).digest('hex'),
  offlineOnly: true,
  externalCheckout: false,
  gameplayPolicy: 'off',
};
await writeFile(path.join(generated, 'asset-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
