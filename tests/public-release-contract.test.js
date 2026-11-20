import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('privacy keeps thirteen linked nontracking types and declares Analytics only for collected account activity', async () => {
  const xml = await readFile('ios/Maydan/PrivacyInfo.xcprivacy', 'utf8');
  const rows = [...xml.matchAll(/<key>NSPrivacyCollectedDataType<\/key>\s*<string>NSPrivacyCollectedDataType(\w+)<\/string>([\s\S]*?)<\/dict>/g)];
  assert.equal(rows.length, 13);
  assert.equal(new Set(rows.map(row => row[1])).size, 13);
  const analytics = [];
  for (const [, type, body] of rows) {
    assert.match(body, /<key>NSPrivacyCollectedDataTypeLinked<\/key>\s*<true\/>/);
    assert.match(body, /<key>NSPrivacyCollectedDataTypeTracking<\/key>\s*<false\/>/);
    const purposes = [...body.matchAll(/<string>NSPrivacyCollectedDataTypePurpose(\w+)<\/string>/g)].map(row => row[1]);
    assert.deepEqual(purposes.sort(), ['UserID', 'ProductInteraction'].includes(type) ? ['Analytics', 'AppFunctionality'] : ['AppFunctionality']);
    if (purposes.includes('Analytics')) analytics.push(type);
  }
  assert.deepEqual(analytics.sort(), ['ProductInteraction', 'UserID']);
  assert.match(xml, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  assert.match(xml, /<string>CA92\.1<\/string>/);
  const policy = await readFile('ios/PRIVACY-DISCLOSURES.md', 'utf8');
  assert.match(policy, /does not make the underlying account-linked activity anonymous/);
  assert.match(policy, /changing this manifest does not publish the questionnaire/);
});

test('ordinary IPA is preserved for both public upload choices; private IPA always uses encrypted artifact only', async () => {
  const workflow = await readFile('.github/workflows/ios-testflight.yml', 'utf8');
  const ordinary = workflow.slice(workflow.indexOf('      - name: Preserve the ordinary signed IPA'), workflow.indexOf('      - name: Seal the private preview IPA artifact'));
  const sealed = workflow.slice(workflow.indexOf('      - name: Seal the private preview IPA artifact'), workflow.indexOf('      - name: Upload to App Store Connect for TestFlight'));
  const condition = ordinary.match(/if: \$\{\{\s*(.*?)\s*\}\}/)[1];
  assert.equal(condition, '!inputs.private_audio_preview');
  for (const privateAudio of [false, true]) for (const upload of [false, true]) {
    const literal = condition.replaceAll('inputs.private_audio_preview', String(privateAudio)).replaceAll('inputs.upload_to_testflight', String(upload));
    assert.match(literal, /^!(?:true|false)$/);
    assert.equal(literal === '!false', !privateAudio);
  }
  assert.match(ordinary, /path: ios\/build\/export\/\*\.ipa/);
  assert.match(ordinary, /retention-days: 7/);
  assert.equal([...sealed.matchAll(/if: \$\{\{ inputs.private_audio_preview \}\}/g)].length, 2);
  assert.match(sealed, /seal-ipa/);
  assert.match(sealed, /path: ios\/build\/private-artifact\//);
  assert.doesNotMatch(sealed, /path: ios\/build\/export/);
});
