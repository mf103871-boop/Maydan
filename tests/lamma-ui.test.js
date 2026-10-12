import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { SocialClient } from '../src/social/client.js';

mkdirSync(path.resolve('.cache'), { recursive: true });
const dir = mkdtempSync(path.resolve('.cache/lamma-ui-'));
after(() => rmSync(dir, { recursive: true, force: true }));
await build({ stdin: { contents: `import React from 'react';import{renderToStaticMarkup}from'react-dom/server';import{VoiceMessage,GameInviteCard,durationLabel,invalidatesVoice}from'./src/social/LammaMedia.jsx';import{MessageBubble}from'./src/social/SocialScreen.jsx';import{FriendListItem,CallControls,groupPreview,isConversationMuted}from'./src/social/SocialHost.jsx';export{durationLabel,groupPreview,isConversationMuted,invalidatesVoice};const render=(C,p)=>renderToStaticMarkup(React.createElement(C,p));export const voice=p=>render(VoiceMessage,p);export const invite=p=>render(GameInviteCard,p);export const friend=p=>render(FriendListItem,p);export const call=p=>render(CallControls,p);export const deleted=p=>render(MessageBubble,{...p,content:React.createElement('span',null,'PRIVATE_VOICE')});`, resolveDir: process.cwd(), loader: 'jsx' }, outfile: path.join(dir, 'render.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
const render = await import(pathToFileURL(path.join(dir, 'render.mjs')));

test('drawer read ownership survives overlapping view cleanup and clears on account stop', () => {
  const client = new SocialClient({ request: async () => ({}), server: () => '' });
  const first = client.registerConversation('first');
  const second = client.registerConversation('second');
  first(); assert.equal(client.activeFriend, 'second');
  second(); assert.equal(client.activeFriend, null);
  client.registerConversation('previous-account'); client.stop();
  assert.equal(client.activeFriend, null); assert.equal(client.visibleConversations.size, 0);
});

test('voice messages have no remote source or autoplay before authorized playback', () => {
  const html = render.voice({ attachment: { id: 'attachment', durationMs: 120000, url: 'https://private.invalid/secret' } });
  assert.match(html, /تشغيل الرسالة الصوتية/); assert.match(html, /2:00/);
  assert.doesNotMatch(html, /src=|autoplay|private.invalid/);
  const tombstone = render.deleted({ message: { seq: 2, kind: 'voice', deletedAt: Date.now() }, mine: true });
  assert.doesNotMatch(tombstone, /PRIVATE_VOICE/); assert.match(tombstone, /حُذفت هذه الرسالة/);
});

test('voice playback survives normal chat updates but stops for access changes and deletion', () => {
  for (const value of [{ type: 'message', reason: 'message' }, { type: 'message', reason: 'edited' }, { type: 'group', reason: 'message' }, { type: 'group', reason: 'edited' }, { type: 'refresh', reason: 'read' }, { type: 'refresh', reason: 'presence' }, { type: 'typing' }]) assert.equal(render.invalidatesVoice(value), false, JSON.stringify(value));
  for (const value of [{ type: 'refresh' }, { type: 'refresh', reason: 'blocked' }, { type: 'message', reason: 'deleted' }, { type: 'group', reason: 'deleted' }, { type: 'group', reason: 'membership' }, { type: 'group', reason: 'removed' }, { type: 'group', reason: 'closed' }]) assert.equal(render.invalidatesVoice(value), true, JSON.stringify(value));
});

test('room invitations require a server invitation id, valid code and unexpired lifetime', () => {
  const invite = { id: 'invite', roomCode: '234567', game: 'fabraka', expiresAt: Date.now() + 30000 };
  const active = render.invite({ invite }); assert.match(active, /فبركة/); assert.doesNotMatch(active, /disabled/);
  for (const value of [{ ...invite, id: null }, { ...invite, roomCode: 'javascript:alert(1)' }, { ...invite, status: 'expired' }]) assert.match(render.invite({ invite: value }), /disabled/);
});

test('muting a direct conversation never mutes a group with the same opaque id', () => {
  const settings = { mutedConversations: [{ scope: 'direct', conversationId: 'same-id' }] };
  assert.equal(render.isConversationMuted(settings, 'direct', 'same-id'), true);
  assert.equal(render.isConversationMuted(settings, 'group', 'same-id'), false);
});

test('non-text previews describe content without exposing attachment addresses', () => {
  const friend = { id: 'friend', name: 'أحمد', unreadCount: 2, lastMessage: { kind: 'voice', attachment: { url: 'PRIVATE_URL' } } };
  const html = render.friend({ friend }); assert.match(html, /رسالة صوتية/); assert.doesNotMatch(html, /PRIVATE_URL/);
  assert.equal(render.groupPreview({ lastMessage: { kind: 'room_invite' } }), 'دعوة للّعب');
  assert.equal(render.groupPreview({ lastMessage: { text: 'PRIVATE_TEXT', deletedAt: 1 } }), 'حُذفت رسالة');
});

test('minimized calls keep explicit microphone and end controls', () => {
  const html = render.call({ call: { id: 'call', scope: 'group', status: 'active' }, media: { muted: true, connected: true, participants: [] } });
  assert.match(html, /تشغيل الميكروفون/); assert.match(html, /إنهاء المكالمة/); assert.match(html, /aria-pressed="true"/);
});
