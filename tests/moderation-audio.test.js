import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewAudioPath } from '../src/moderation/client.js';

test('moderator audio only accepts an anchored report evidence API path', () => {
  assert.equal(reviewAudioPath('/api/moderation/reports/report_abc-123/audio'), '/api/moderation/reports/report_abc-123/audio');
  for (const value of [null, '', 'https://example.com/audio', '//example.com/audio', 'blob:private', 'data:audio/mp4;base64,x', '/api/social/attachments/id/content', '/api/moderation/reports/../audio', '/api/moderation/reports/a%2Fb/audio', '/api/moderation/reports/id/audio?token=secret', '/api/moderation/reports/id/audio#fragment', '/api/moderation/reports/id/audio/extra']) assert.equal(reviewAudioPath(value), null, String(value));
});
