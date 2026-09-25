import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = process.cwd();
mkdirSync(path.join(root, '.cache'), { recursive: true });
const dir = mkdtempSync(path.join(root, '.cache', 'social-ui-'));
after(() => rmSync(dir, { recursive: true, force: true }));
await build({ stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {SocialView,MessageBubble,dayLabel,presenceLabel,messageKey} from './src/social/SocialScreen.jsx'; export {dayLabel,presenceLabel,messageKey}; export const screen=p=>renderToStaticMarkup(React.createElement(SocialView,p)).replace(/<style>[\\s\\S]*?<\\/style>/g,''); export const bubble=p=>renderToStaticMarkup(React.createElement(MessageBubble,p));`, resolveDir: root, loader: 'jsx' },
  outfile: path.join(dir, 'render.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
const render = await import(pathToFileURL(path.join(dir, 'render.mjs')));
const now = new Date(2026, 8, 25, 12).getTime();
const me = { id: 'me', name: 'عبدالله' };
const friend = { id: 'peer', name: 'أحمد', code: 'MDN123', online: true, unreadCount: 3 };
const message = { seq: 23, clientId: 'client-23', senderId: 'me', text: 'نلعب الليلة؟', createdAt: now, status: 'sent' };
const social = { profile: { ...me, code: 'MYCODE' }, friends: [friend], incoming: [], outgoing: [], blocked: [], conversations: { peer: { messages: [message], peerReadSeq: 23 } } };
const account = { ready: true, signedIn: true, user: me };

test('signed-out and loading views do not expose friends, codes or message text', () => {
  for (const auth of [{ ready: true, signedIn: false }, { ready: false, signedIn: false }]) {
    const html = render.screen({ account: auth, social, friendId: 'peer' });
    assert.doesNotMatch(html, /MYCODE|أحمد|نلعب الليلة|is-conversation/);
  }
  assert.match(render.screen({ account: { ready: true, signedIn: false }, social }), /تسجيل الدخول/);
});

test('friends expose clear private-chat action, code copy, presence and unread totals', () => {
  const html = render.screen({ account, social });
  assert.match(html, /MYCODE/);
  assert.match(html, /نسخ رمز الصديق/);
  assert.match(html, /فتح محادثة أحمد/);
  assert.match(html, /متصل الآن/);
  assert.match(html, /3 غير مقروءة/);
  assert.match(html, /المحادثات: 3/);
});

test('conversation renders server read receipts and text-only composer', () => {
  const html = render.screen({ account, social, friendId: 'peer' });
  assert.match(html, /نلعب الليلة؟/);
  assert.match(html, /قُرئت/);
  assert.match(html, /textarea[^>]*maxLength="2000"/i);
  assert.match(html, /إرسال الرسالة/);
  assert.doesNotMatch(html, /type="file"|<audio|<video|إرفاق|تسجيل صوت/);
});

test('unavailable friendships never reveal retained conversation messages', () => {
  const html = render.screen({ account, social: { ...social, friends: [] }, friendId: 'peer' });
  assert.match(html, /هذه المحادثة غير متاحة/);
  assert.doesNotMatch(html, /نلعب الليلة؟|textarea/);
});

test('pending and failed messages distinguish retry from sent editing', () => {
  const pending = render.bubble({ message: { ...message, seq: undefined, status: 'pending' }, mine: true });
  assert.match(pending, /جارٍ الإرسال/); assert.doesNotMatch(pending, /خيارات رسالتك|إعادة الإرسال/);
  const failed = render.bubble({ message: { ...message, seq: undefined, status: 'failed' }, mine: true });
  assert.match(failed, /لم تُرسل/); assert.match(failed, /إعادة الإرسال/); assert.doesNotMatch(failed, /خيارات رسالتك/);
  const sent = render.bubble({ message, mine: true });
  assert.match(sent, /خيارات رسالتك/); assert.match(sent, /أُرسلت/); assert.doesNotMatch(sent, /إعادة الإرسال/);
});

test('deleted messages hide prior text and action controls; user text is escaped', () => {
  const deleted = render.bubble({ message: { ...message, text: 'PRIVATE_DELETED_TEXT', deletedAt: now + 1000 }, mine: true });
  assert.match(deleted, /حُذفت هذه الرسالة/); assert.doesNotMatch(deleted, /PRIVATE_DELETED_TEXT|خيارات رسالتك/);
  const unsafe = render.bubble({ message: { ...message, text: '<img src=x onerror=alert(1)>' }, mine: false });
  assert.match(unsafe, /&lt;img/); assert.doesNotMatch(unsafe, /<img/);
  assert.match(unsafe, /خيارات الرسالة/); assert.doesNotMatch(unsafe, /أُرسلت|قُرئت/);
});

test('day boundaries use local calendar dates; invalid presence is not invented', () => {
  assert.equal(render.dayLabel(new Date(2026, 8, 25, 0, 5).getTime(), now), 'اليوم');
  assert.equal(render.dayLabel(new Date(2026, 8, 24, 23, 59).getTime(), now), 'أمس');
  assert.equal(render.dayLabel(null, now), '');
  assert.equal(render.presenceLabel({ online: true }, now), 'متصل الآن');
  assert.equal(render.presenceLabel({ lastActiveAt: 'invalid' }, now), 'غير متصل');
  assert.equal(render.messageKey({ clientId: 'retry-token' }), 'local-retry-token');
  assert.equal(render.messageKey(message), 'message-23');
});
