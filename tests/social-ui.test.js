import { test, after } from 'node:test';
import React from 'react';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = process.cwd();
mkdirSync(path.join(root, '.cache'), { recursive: true });
const dir = mkdtempSync(path.join(root, '.cache', 'social-ui-'));
after(() => rmSync(dir, { recursive: true, force: true }));
await build({ stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {SocialView,MessageBubble,Conversation,messageSender,dayLabel,presenceLabel,messageKey} from './src/social/SocialScreen.jsx'; export {dayLabel,presenceLabel,messageKey,messageSender}; export const screen=p=>renderToStaticMarkup(React.createElement(SocialView,p)).replace(/<style>[\\s\\S]*?<\\/style>/g,''); export const bubble=p=>renderToStaticMarkup(React.createElement(MessageBubble,p)); export const conversation=p=>renderToStaticMarkup(React.createElement(Conversation,p));`, resolveDir: root, loader: 'jsx' },
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

test('group conversations identify each sender with their profile and keep direct chats uncluttered', () => {
  const members = [{ id: 'peer', name: 'أحمد', avatarPreset: 'falcon' }, { userId: 'second', user: { id: 'second', name: 'ليلى', avatarPreset: 'moon' } }];
  const messages = [{ ...message, senderId: 'peer' }, { ...message, seq: 24, senderId: 'second' }, { ...message, seq: 25, senderId: 'me' }];
  const props = { friend: { id: 'g', name: 'الشلة' }, conversation: { group: { id: 'g' }, members, messages }, account, social: {}, notify() {} };
  const html = render.conversation(props);
  assert.match(html, /aria-label="رسالة من أحمد"/); assert.match(html, /aria-label="رسالة من ليلى"/);
  assert.equal((html.match(/class="social-message-sender"/g) || []).length, 2);
  assert.match(html, /aria-label="رسالتك"/);
  assert.equal(render.messageSender(messages[1], props.conversation, account).name, 'ليلى');
  assert.equal(render.messageSender({ senderId: 'former' }, props.conversation, account).name, 'عضو اللّمة');
  const direct = render.conversation({ ...props, friend, conversation: { messages } });
  assert.doesNotMatch(direct, /social-message-sender/);
});

test('consecutive group messages compact only the same remote sender within three minutes', () => {
  const a = { ...message, senderId: 'peer', seq: 1 };
  const messages = [a, { ...a, seq: 2, createdAt: now + 1000 }, { ...a, seq: 3, createdAt: now + 190000 }, { ...a, seq: 4, senderId: 'other', createdAt: now + 191000 }];
  const html = render.conversation({ friend: { id: 'g', name: 'Group' }, conversation: { group: { id: 'g' }, members: [friend, { id: 'other', name: 'Sam' }], messages }, account, social: {}, notify() {} });
  assert.equal((html.match(/class="social-message-sender"/g) || []).length, 3);
  assert.equal((html.match(/is-continuation/g) || []).length, 1);
  assert.equal((html.match(/aria-label="رسالة من أحمد"/g) || []).length, 3);
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


test('unified chat header retains one title, navigation and direct tools in page and drawer presentations', () => {
  const tools = React.createElement(React.Fragment, null,
    React.createElement('button', { type: 'button', 'aria-label': 'يلا نلعب' }),
    React.createElement('button', { type: 'button', 'aria-label': 'مكالمة صوتية', disabled: true }));
  const props = { friend, conversation: { messages: [] }, account, social: {}, notify() {}, onBack() {}, onMenu() {}, compactHeader: true, headerActions: tools };
  for (const drawer of [false, true]) {
    const html = render.conversation({ ...props, onClose: drawer ? () => {} : undefined });
    assert.equal((html.match(/<header/g) || []).length, 1);
    assert.equal((html.match(/<header[\s\S]*?<\/header>/)?.[0].match(/<h2>/g) || []).length, 1);
    assert.match(html, /class="social-chat-head is-unified"/);
    assert.match(html, /aria-label="العودة للأصدقاء"/);
    assert.match(html, /aria-label="عرض بروفايل أحمد"/);
    assert.match(html, /aria-label="خيارات المحادثة"[^>]+aria-haspopup="dialog"/);
    assert.match(html, /aria-label="أدوات المحادثة"/);
    assert.match(html, /aria-label="يلا نلعب"/);
    assert.match(html, /aria-label="مكالمة صوتية" disabled=""/);
    assert.equal(html.includes('aria-label="إغلاق اللّمة والعودة للعبة"'), drawer);
    assert.match(html, /aria-label="اكتب رسالة"/);
  }
});
