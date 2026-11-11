import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { DEFAULT_API_ORIGIN, migrateHtml, nativeConfig } from './native.mjs';
import { SAMPLE_APP_ID, resolveRewardedBuild } from './rewarded-config.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const previewBundle = 'org.maydan.rewarded.preview';
const rewardedSwift = 'RewardedAdCoordinator.swift';
const rewardedFile = 'B30000000000000000000001';
const rewardedSource = 'A30000000000000000000001';
const packages = [
  {
    id: 'B30000000000000000000002', productId: 'B30000000000000000000003', frameworkId: 'A30000000000000000000002',
    identity: 'swift-package-manager-google-mobile-ads', product: 'GoogleMobileAds', version: '13.12.0',
    revision: 'f6308a186913b186bdc8baf87d098206ecd75ace',
  },
  {
    id: 'B30000000000000000000004', productId: 'B30000000000000000000005', frameworkId: 'A30000000000000000000003',
    identity: 'swift-package-manager-google-user-messaging-platform', product: 'GoogleUserMessagingPlatform', version: '3.1.0',
    revision: '13b248eaa73b7826f0efb1bcf455e251d65ecb1b',
  },
].map(item => ({ ...item, location: `https://github.com/googleads/${item.identity}.git` }));

// Snapshot of the Google Ads iOS quick-start SKAdNetworkItems example, 2026-11-06.
// This list is applied only to generated projects that include the Ads SDK.
const skAdNetworkIds = `
cstr6suwn9 4fzdc2evr5 2fnua5tdw4 ydx93a7ass p78axxw29g v72qych5uu ludvb6z3bs cp8zw746q7 3sh42y64q3 c6k4g5qg8m
s39g8k73mm wg4vff78zm 3qy4746246 f38h382jlk hs6bdukanm mlmmfzh3r3 v4nxqhlyqp wzmmz9fp6w su67r6k2v3 yclnxrl5pm
t38b2kh725 7ug5zh24hu gta9lk7p23 vutu7akeur y5ghdn5j9k v9wttpbfk9 n38lu8286q 47vhws6wlr kbd757ywx3 9t245vhmpl
a2p9lx4jpn 22mmun2rn5 44jx6755aq k674qkevps 4468km3ulz 2u9pt9hc89 8s468mfl3y klf5c3l5u5 ppxm28t8ap kbmxgpxpgc
uw77j35x4d 578prtvx9j 4dzt52r2t5 tl55sbb4fm c3frkrj4fj e5fvkxwrpn 8c4e2ghe7u 3rd42ekr43 97r2b46745 3qcr597p9d
`.trim().split(/\s+/);

function replaceOnce(input, match, replacement) {
  const matches = typeof match === 'string' ? input.split(match).length - 1 : [...input.matchAll(new RegExp(match.source, match.flags + 'g'))].length;
  if (matches !== 1) throw new Error(`Native preview generator expected one anchor: ${match}`);
  return input.replace(match, replacement);
}

function generatedProject(source, signed) {
  const frameworks = packages.map(item => `${item.frameworkId} /* ${item.product} in Frameworks */`);
  const products = packages.map(item => `${item.productId} /* ${item.product} */`);
  const references = packages.map(item => `${item.id} /* XCRemoteSwiftPackageReference "${item.identity}" */`);
  const addSection = (section, entries) => {
    const label = `/* End ${section} section */`;
    source = replaceOnce(source, label, `${entries.map(entry => '\t\t' + entry).join('\n')}\n${label}`);
  };
  addSection('PBXBuildFile', [
    `${rewardedSource} /* ${rewardedSwift} in Sources */ = {isa = PBXBuildFile; fileRef = ${rewardedFile}; };`,
    ...frameworks.map((framework, index) => `${framework} = {isa = PBXBuildFile; productRef = ${products[index]}; };`),
  ]);
  addSection('PBXFileReference', [
    `${rewardedFile} /* ${rewardedSwift} */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ${rewardedSwift}; sourceTree = "<group>"; };`,
  ]);
  addSection('XCRemoteSwiftPackageReference', references.map((reference, index) => {
    const { location, version } = packages[index];
    return `${reference} = {isa = XCRemoteSwiftPackageReference; repositoryURL = "${location}"; requirement = {kind = exactVersion; version = ${version};};};`;
  }));
  addSection('XCSwiftPackageProductDependency', products.map((product, index) =>
    `${product} = {isa = XCSwiftPackageProductDependency; package = ${references[index]}; productName = ${packages[index].product};};`));
  for (const [setting, original, items] of [
    ['files', 'A1000000000000000000000F /* LiveKit in Frameworks */', frameworks],
    ['packageProductDependencies', 'B20000000000000000000002 /* LiveKit */', products],
    ['packageReferences', 'B20000000000000000000001 /* XCRemoteSwiftPackageReference "client-sdk-swift" */', references],
  ]) {
    source = replaceOnce(source, `${setting} = (${original},);`, `${setting} = (${[original, ...items].join(', ')},);`);
  }
  const groupAnchor = 'B1000000000000000000000A /* NativeConfig.swift */,';
  const sourceAnchor = 'A10000000000000000000003 /* GameViewController.swift in Sources */,';
  source = replaceOnce(source, groupAnchor, `${groupAnchor}\n\t\t\t\t${rewardedFile} /* ${rewardedSwift} */,`);
  source = replaceOnce(source, sourceAnchor, `${sourceAnchor}\n\t\t\t\t${rewardedSource} /* ${rewardedSwift} in Sources */,`);
  if (signed) {
    for (const configuration of ['Debug', 'Release']) {
      source = replaceOnce(source, new RegExp(`^\\t\\t[^\\n]*\\/\\* ${configuration} \\*\\/[^\\n]*PRODUCT_BUNDLE_IDENTIFIER[^\\n]*$`, 'm'),
        row => replaceOnce(row, ' SWIFT_VERSION = 5.0;',
          ' SWIFT_ACTIVE_COMPILATION_CONDITIONS = "$(inherited) MAYDAN_REWARDED_ADS"; SWIFT_VERSION = 5.0;'));
    }
    return source;
  }
  source = replaceOnce(source, / SystemCapabilities = .*?;(?= \}; \};)/, '');
  source = replaceOnce(source, /^\t\t[^\n]*\/\* Debug \*\/[^\n]*PRODUCT_BUNDLE_IDENTIFIER[^\n]*$/m, row => {
    row = replaceOnce(row, /PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/, 'PRODUCT_BUNDLE_IDENTIFIER = ' + previewBundle + '; SKIP_INSTALL = YES;');
    row = replaceOnce(row, / CODE_SIGN_ENTITLEMENTS = [^;]+;/, '');
    row = replaceOnce(row, / DEVELOPMENT_TEAM = [^;]+;/, '');
    return replaceOnce(row, ' SWIFT_VERSION = 5.0;',
      ' SWIFT_ACTIVE_COMPILATION_CONDITIONS = "$(inherited) MAYDAN_REWARDED_PREVIEW"; SWIFT_VERSION = 5.0;');
  });
  for (const releaseId of ['F20000000000000000000002', 'F20000000000000000000004']) {
    source = replaceOnce(source, new RegExp('^\\t\\t' + releaseId + ' /\\* Release \\*/[^\\n]*\\n', 'm'), '');
    source = replaceOnce(source, releaseId + ' /* Release */,); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;',
      '); defaultConfigurationIsVisible = 0; defaultConfigurationName = Debug;');
  }
  return source;
}

function generatedInfo(source, signedConfig) {
  if (!signedConfig) {
    source = replaceOnce(source, /<key>CFBundleDisplayName<\/key>\s*<string>[^<]+<\/string>/,
      '<key>CFBundleDisplayName</key>\n    <string>Maydan Ads Preview</string>');
    source = replaceOnce(source, /    <key>CFBundleURLTypes<\/key>[\s\S]*?\n    <\/array>\n/, '');
    source = replaceOnce(source, '        <string>voip</string>\n        <string>remote-notification</string>\n', '');
  }
  const skAdNetworkItems = skAdNetworkIds.map(id =>
    `        <dict><key>SKAdNetworkIdentifier</key><string>${id}.skadnetwork</string></dict>`).join('\n');
  return replaceOnce(source, '<plist version="1.0">\n<dict>\n', `<plist version="1.0">
<dict>
    <key>GADApplicationIdentifier</key>
    <string>${signedConfig?.appId || SAMPLE_APP_ID}</string>
    <key>GADDelayAppMeasurementInit</key>
    <true/>
    <key>SKAdNetworkItems</key>
    <array>
${skAdNetworkItems}
    </array>
    ${signedConfig ? `<key>MaydanRewardedMode</key>
    <string>${signedConfig.mode}</string>
    <key>MaydanRewardedUnit</key>
    <string>${signedConfig.adUnit}</string>${signedConfig.testVersion ? `
    <key>MaydanRewardedTestVersion</key>
    <string>${signedConfig.testVersion}</string>` : ''}` : `<key>NSAppTransportSecurity</key>
    <dict>
        <key>NSAllowsLocalNetworking</key>
        <true/>
    </dict>`}
`);
}

async function generateProject(destination, signedConfig = null) {
  for (const name of ['Maydan', 'Maydan.xcodeproj']) {
    await cp(path.join(root, 'ios', name), path.join(destination, name), {
      recursive: true, filter: source => !['www', 'xcuserdata', '.DS_Store'].includes(path.basename(source)),
    });
  }
  await cp(path.join(root, 'ios', 'RewardedPreview', rewardedSwift), path.join(destination, 'Maydan', rewardedSwift));
  const project = path.join(destination, 'Maydan.xcodeproj');
  const projectFile = path.join(project, 'project.pbxproj');
  const schemeFile = path.join(project, 'xcshareddata/xcschemes/Maydan.xcscheme');
  const packageFile = path.join(project, 'project.xcworkspace/xcshareddata/swiftpm/Package.resolved');
  const plistFile = path.join(destination, 'Maydan', 'Info.plist');
  const [projectText, scheme, lockedPackages, info] = await Promise.all(
    [projectFile, schemeFile, packageFile, plistFile].map(file => readFile(file, 'utf8')));
  const normalizedInfo = info.replace(/\r\n/g, '\n');
  const resolution = JSON.parse(lockedPackages);
  resolution.pins.push(...packages.map(({ identity, location, revision, version }) =>
    ({ identity, kind: 'remoteSourceControl', location, state: { revision, version } })));
  resolution.pins.sort((a, b) => a.identity.localeCompare(b.identity));
  await Promise.all([
    writeFile(projectFile, generatedProject(projectText.replace(/\r\n/g, '\n'), Boolean(signedConfig))),
    writeFile(schemeFile, signedConfig ? scheme : replaceOnce(scheme, 'buildForArchiving="YES"', 'buildForArchiving="NO"')
      .replace('ProfileAction buildConfiguration="Release"', 'ProfileAction buildConfiguration="Debug"')
      .replace(/  <ArchiveAction[^\n]+\r?\n/, '')),
    writeFile(packageFile, JSON.stringify(resolution, null, 2) + '\n'),
    writeFile(plistFile, generatedInfo(normalizedInfo, signedConfig)),
  ]);
}

export async function generateSignedRewardedProject(env) {
  const config = resolveRewardedBuild(env);
  if (!config) throw new Error('An explicit signed Rewarded mode is required.');
  const cache = path.join(root, '.cache');
  await mkdir(cache, { recursive: true });
  const destination = await mkdtemp(path.join(cache, 'rewarded-signed-'));
  await generateProject(destination, config);
  return destination;
}

async function generateIcons(destination) {
  const { default: sharp } = await import('sharp');
  const iconDir = path.join(destination, 'Maydan/Assets.xcassets/AppIcon.appiconset');
  const icon = await readFile(path.join(iconDir, 'icon-1024.png'));
  const { images } = JSON.parse(await readFile(path.join(iconDir, 'Contents.json'), 'utf8'));
  const slots = new Map();
  for (const { filename, size, scale } of images) {
    if (!filename || filename === 'icon-1024.png') continue;
    const side = Number(size.split('x')[0]) * Number(scale.replace('x', ''));
    if (slots.has(filename) && slots.get(filename) !== side) throw new Error('Inconsistent app icon sizes');
    slots.set(filename, side);
  }
  await Promise.all(Array.from(slots, ([filename, side]) =>
    sharp(icon).resize(side, side).removeAlpha().png().toFile(path.join(iconDir, filename))));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--project-only' && !/^--port=[1-9][0-9]{0,4}$/.test(arg)) ||
      args.filter(arg => arg.startsWith('--port=')).length > 1) {
    throw new Error('Usage: node scripts/ios/rewarded-preview.mjs [--port=4198] [--project-only]');
  }
  const port = Number(args.find(arg => arg.startsWith('--port='))?.slice(7) ?? '4198');
  if (port > 65535) throw new Error('Invalid local server port');
  const roomsUrl = `http://127.0.0.1:${port}`;
  const cache = path.join(root, '.cache');
  await mkdir(cache, { recursive: true });
  const destination = await mkdtemp(path.join(cache, 'rewarded-ios-'));
  await generateProject(destination);
  console.log(`Local sample project: ${path.join(destination, 'Maydan.xcodeproj')}`);
  if (args.includes('--project-only')) return;

  // This build writes only to the new ignored preview directory.
  const { buildOnce } = await import('../lib.mjs');
  const outdir = path.join(destination, 'Maydan', 'www');
  const [{ buildId, out }] = await Promise.all([
    buildOnce({ outdir, roomsUrl, version: '1.9', includeStudio: false, rewardedPreview: true }),
    generateIcons(destination),
  ]);
  const config = { ...nativeConfig({ apiOrigin: DEFAULT_API_ORIGIN }), apiOrigin: roomsUrl };
  await Promise.all([
    writeFile(path.join(outdir, 'native-config.json'), JSON.stringify(config, null, 2) + '\n'),
    writeFile(path.join(outdir, 'migrate.html'), migrateHtml()),
  ]);
  const sha = createHash('sha256').update(await readFile(out)).digest('hex');
  console.log(`Rewarded preview resources: ${buildId}; HTML SHA-256 ${sha}; API ${roomsUrl}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
