import assert from 'node:assert/strict';

// Dedicated synthetic-only project. Never point acceptance at the production
// Maydan SFU, even when its credentials are also present on this workstation.
export const PREVIEW_LIVEKIT_PROJECT_ID = 'p_6asugsl60h0';
export const PREVIEW_LIVEKIT_HOST = 'maydan-test-lab-831mi2tl.livekit.cloud';
export function assertPreviewLiveKitHost(host) {
  assert.equal(host, PREVIEW_LIVEKIT_HOST, 'Exact authorized isolated Test Lab LiveKit hostname required');
}
