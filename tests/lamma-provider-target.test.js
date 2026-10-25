import test from 'node:test';
import assert from 'node:assert/strict';
import { PREVIEW_LIVEKIT_PROJECT_ID, PREVIEW_LIVEKIT_HOST, assertPreviewLiveKitHost } from '../scripts/lib/lamma-provider-target.mjs';

test('provider acceptance is restricted to the approved isolated Test Lab project', () => {
  assert.equal(PREVIEW_LIVEKIT_PROJECT_ID, 'p_6asugsl60h0');
  assert.equal(PREVIEW_LIVEKIT_HOST, 'maydan-test-lab-831mi2tl.livekit.cloud');
  assert.doesNotThrow(() => assertPreviewLiveKitHost(PREVIEW_LIVEKIT_HOST));
  for (const candidate of ['maydan-gvk8joay.livekit.cloud', undefined, '', `wss://${PREVIEW_LIVEKIT_HOST}`, `${PREVIEW_LIVEKIT_HOST}.example.test`,
    `${PREVIEW_LIVEKIT_HOST}/`, PREVIEW_LIVEKIT_HOST.toUpperCase(), 'another-preview.livekit.cloud']) {
    assert.throws(() => assertPreviewLiveKitHost(candidate));
  }
});
