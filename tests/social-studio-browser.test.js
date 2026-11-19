import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';

const root = process.cwd();
const output = process.env.SOCIAL_STUDIO_EVIDENCE_DIR || path.join(root, '.cache/social-studio');
await mkdir(output, { recursive: true });
const hash = value => createHash('sha256').update(value).digest('hex');
const sources = Object.fromEntries(await Promise.all([
  'src/social/SocialHost.jsx', 'src/social/SocialScreen.jsx', 'src/social/LammaMedia.jsx',
  'src/social/lamma.css', 'src/social/social.css', 'src/social/assets/search-loupe-v1.webp',
  'src/platform/BottomNavigation.jsx', 'src/profiles/identity.css', 'src/shared/i18n/en-social.js',
].map(async file => [file, hash(await readFile(path.join(root, file)))])));

const account = { id: 'owner', name: 'ليان', avatarPreset: 'human-01', code: 'M7K2P9', theme: 'teal' };
const people = [
  { id: 'sara', name: 'سارة', avatarPreset: 'human-03', online: true, theme: 'teal' },
  { id: 'omar', name: 'عمر', avatarPreset: 'human-02', online: true, theme: 'teal' },
  { id: 'noor', name: 'نور', avatarPreset: 'human-04', online: false, theme: 'teal', lastActiveAt: Date.now() - 600000 },
];
const groups = [
  { id: 'weekend', name: 'شلّة الخميس', avatarPreset: 'controller', memberCount: 4, lastMessage: { kind: 'game_invite' } },
  { id: 'campus', name: 'أصحاب الجامعة', avatarPreset: 'spark', memberCount: 5, lastMessage: { kind: 'voice' } },
  { id: 'family', name: 'لمة العائلة', avatarPreset: 'lion', memberCount: 5 },
];
const now = Date.now();
const waveform = Buffer.alloc(44 + 16000 * 2 * 12);
waveform.write('RIFF');
waveform.writeUInt32LE(waveform.length - 8, 4);
waveform.write('WAVEfmt ', 8);
waveform.writeUInt32LE(16, 16);
waveform.writeUInt16LE(1, 20);
waveform.writeUInt16LE(1, 22);
waveform.writeUInt32LE(16000, 24);
waveform.writeUInt32LE(32000, 28);
waveform.writeUInt16LE(2, 32);
waveform.writeUInt16LE(16, 34);
waveform.write('data', 36);
waveform.writeUInt32LE(waveform.length - 44, 40);
const olderMessages = Array.from({ length: 27 }, (_, index) => ({
  seq: index + 1, clientId: 'old-' + index, senderId: index % 2 ? 'owner' : 'omar',
  kind: 'text', text: index % 2 ? 'See you after the game · ' + index : 'نلعب الجولة الثانية؟ · ' + index, createdAt: now - 86400000 + index * 6000,
}));
const recentMessages = [
  { seq: 28, senderId: 'owner', kind: 'text', text: 'جاهز نلعب ارسمها؟' },
  { seq: 29, senderId: 'omar', kind: 'text', text: 'أكيد، أرسل الدعوة.' },
  { seq: 30, senderId: 'omar', kind: 'voice', attachment: { id: 'voice-1', durationMs: 12000, mimeType: 'audio/wav' } },
  { seq: 31, senderId: 'omar', kind: 'game_invite', roomInvitation: { id: 'invite-1', game: 'ersomha', roomCode: '482761', expiresAt: now + 3600000 } },
].map((message, index) => ({ ...message, clientId: 'recent-' + index, createdAt: now - 240000 + index * 60000 }));

let state;
function resetState(locale) {
  const isEnglish = locale === 'en';
  const friends = people.map((person, index) => ({
    ...person, name: isEnglish ? ['Sara', 'Omar', 'Noor'][index] : person.name,
    conversationId: 'direct-' + person.id,
    unreadCount: 0,
    lastMessage: index === 1 ? { kind: 'voice', createdAt: now - 1000 } : { kind: 'text', text: isEnglish ? ['Ready to play?', '', 'See you around 9'][index] : ['جاهزين نلعب؟', '', 'متفقين الساعة ٩'][index], createdAt: now - (index + 1) * 2000 },
  }));
  const messages = recentMessages.map((message, index) => ({ ...message, ...(isEnglish && index < 2 ? { text: ['See you at 9.', 'Send an invite when you’re ready.'][index] } : {}) }));
  state = {
    friends, groups, messages, writes: [], failNext: true,
    incoming: [{ id: 'in-1', user: { id: 'mazin', name: isEnglish ? 'Mazin' : 'مازن', avatarPreset: 'fox' } }],
    outgoing: [{ id: 'out-1', user: { id: 'yusuf', name: isEnglish ? 'Yusuf' : 'يوسف', avatarPreset: 'falcon' } }],
    invitations: [{ id: 'group-in-1', groupId: 'weekend', group: groups[0] }],
  };
}

function api(url, method, body) {
  const pathname = url.pathname;
  if (method !== 'GET') state.writes.push({ pathname, method, body });
  if (pathname === '/api/social/state') return { user: account, friends: state.friends, incoming: state.incoming, outgoing: state.outgoing, blocked: [], conversations: state.friends.map(user => ({ id: user.conversationId, user, lastMessage: user.lastMessage, unreadCount: user.unreadCount })) };
  if (pathname === '/api/social/groups') return { groups: state.groups, incoming: state.invitations };
  if (pathname === '/api/social/preferences') return { preferences: { enabled: true, mutedConversations: [] } };
  if (pathname === '/api/social/calls') return { calls: [] };
  if (pathname === '/api/social/capabilities') return { capabilities: { voiceMessages: true, liveCalls: true } };
  if (pathname === '/api/social/live-ticket') return { error: 'SOCIAL_UNAVAILABLE' };
  if (pathname === '/api/social/search') {
    const query = url.searchParams.get('q');
    if (query === 'Zzz') return { users: [] };
    return { users: [
      { ...state.friends[2], relationship: 'friend' },
      { id: 'nuran', name: query === 'No' ? 'Nouran' : 'نوران', avatarPreset: 'human-01', relationship: 'none' },
      { ...state.outgoing[0].user, relationship: 'pending_outgoing' },
    ] };
  }
  if (pathname === '/api/social/requests/in-1/accept') { state.incoming = []; return { ok: true }; }
  if (pathname === '/api/social/requests/out-1') { state.outgoing = []; return { ok: true }; }
  if (pathname === '/api/social/groups/weekend/invites/group-in-1/decline' || pathname === '/api/social/groups/weekend/invites/group-in-1/reject') { state.invitations = []; return { ok: true }; }
  if (pathname === '/api/social/requests') return { ok: true };
  if (pathname === '/api/social/conversations/direct-omar/messages') {
    if (method === 'POST') {
      if (state.failNext) { state.failNext = false; return { error: 'SOCIAL_UNAVAILABLE' }; }
      const message = { ...body, seq: state.messages.at(-1).seq + 1, senderId: 'owner', createdAt: Date.now() };
      state.messages.push(message);
      return { message };
    }
    return { messages: state.messages, peerReadSeq: 28, readSeq: 31, hasMore: false };
  }
  if (pathname.startsWith('/api/social/conversations/') && pathname.endsWith('/read')) return { readSeq: body.seq };
  if (pathname.startsWith('/api/profiles/')) return { profile: { ...account, relationship: 'self' } };
  return {};
}

const fixtureSource = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AccountContext, NULL_ACCOUNT } from './src/shared/account/context.js';
import { PlatformContext } from './src/platform/context.js';
import { useRoute } from './src/platform/router.js';
import { BottomNavigation } from './src/platform/BottomNavigation.jsx';
import { BrandFonts } from './src/shared/brand/art.jsx';
import { PlusStyles } from './src/plus/PlusStyles.jsx';
import { setUiLocale, untranslatedUiKeys } from './src/shared/i18n/core.js';
import { ProfileProvider } from './src/profiles/ProfileProvider.jsx';
import { SocialProvider, useSocial } from './src/social/SocialProvider.jsx';
import { LammaProvider } from './src/social/LammaProvider.jsx';
import { SocialUIProvider } from './src/social/SocialUIProvider.jsx';
import { CallViewport } from './src/social/CallViewport.jsx';
import { SocialHost } from './src/social/SocialHost.jsx';
import tokens from './src/shared/theme/tokens.css';
import uiCss from './src/shared/ui/ui.css';
import platformCss from './src/platform/platform.css';
import brandCss from './src/shared/brand/brand.css';
import studioCss from './src/platform/playful-studio.css';

await setUiLocale(new URLSearchParams(location.search).get('locale'));
if (new URLSearchParams(location.search).has('large')) document.documentElement.style.fontSize = '32px';
const requestAuthenticated = async (route, options = {}) => {
  const response = await fetch(route, {
    method: options.method || 'GET', headers: { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (options.raw) return response;
  if (options.responseType === 'blob') return response.blob();
  const data = await response.json();
  if (data.error) throw Object.assign(new Error(data.error), { code: data.error });
  return data;
};
const account = { ...NULL_ACCOUNT, ready: true, signedIn: true, user: ${JSON.stringify(account)}, requestAuthenticated, refresh: async () => {} };
const platform = { sound: { play() {}, setDucking() {} }, haptics: { vibrate() {} }, toast() {}, settings: {}, roster: [], storage: { get() {}, set() {} } };
function Screen() {
  const route = useRoute();
  const social = useSocial();
  window.refreshSocial = social.refresh;
  window.untranslated = untranslatedUiKeys;
  return <><CallViewport><div data-social-page-slot /></CallViewport><BottomNavigation route={route} /></>;
}
createRoot(document.getElementById('root')).render(
  <AccountContext.Provider value={account}><PlatformContext.Provider value={platform}>
    <BrandFonts /><style>{tokens + uiCss + platformCss + brandCss + studioCss}</style><PlusStyles />
    <SocialProvider><LammaProvider><SocialUIProvider><ProfileProvider>
      <Screen /><SocialHost />
    </ProfileProvider></SocialUIProvider></LammaProvider></SocialProvider>
  </PlatformContext.Provider></AccountContext.Provider>
);`;

const result = await build({
  stdin: { contents: fixtureSource, resolveDir: root, loader: 'jsx' },
  bundle: true, write: false, format: 'esm', jsx: 'automatic', logLevel: 'silent',
  loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' },
  define: { __MAYDAN_ROOMS_URL__: JSON.stringify('same-origin') },
});
const bundle = result.outputFiles[0].contents;
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://local');
  if (url.pathname === '/bundle.js') {
    response.writeHead(200, { 'content-type': 'text/javascript' }); response.end(bundle); return;
  }
  if (url.pathname === '/api/social/attachments/voice-1/content') {
    response.writeHead(200, { 'content-type': 'audio/wav', 'content-length': waveform.length });
    response.end(waveform); return;
  }
  if (url.pathname.startsWith('/api/')) {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const data = api(url, request.method, raw ? JSON.parse(raw) : undefined);
    response.writeHead(data.error ? 503 : 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(data)); return;
  }
  response.writeHead(200, { 'content-type': 'text/html;charset=utf-8' });
  response.end('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/bundle.js"></script></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
test.after(() => new Promise(resolve => server.close(resolve)));
const node = (page, id) => page.locator('[data-design-id="' + id + '"]');
const settle = page => page.evaluate(async () => {
  await document.fonts.ready;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
});
const elementsFit = selector => {
  const overflow = document.documentElement.scrollWidth > window.innerWidth;
  const outside = [...document.querySelectorAll(selector)].filter(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.width && (bounds.x < -1 || bounds.right > window.innerWidth + 1);
  }).map(element => element.className);
  return { overflow, outside };
};

for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) for (const locale of ['ar', 'en']) {
  test(engineName + '/' + locale + ' approved social presentation with normal input', { timeout: 90000 }, async () => {
    resetState(locale);
    const width = 390, height = 844;
    const browser = await engine.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    const errors = [], checks = [], captures = [];
    let playback = null;
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        return play.call(this).catch(error => {
          window.socialPlaybackError = { name: error.name, message: error.message };
          throw error;
        });
      };
    });
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const name = label => path.join(output, engineName + '-' + locale + '-' + label + '.png');
    const save = async label => {
      await settle(page);
      const file = name(label);
      const png = await page.screenshot({ path: file });
      captures.push({ file: path.basename(file), sha256: hash(png), viewport: page.viewportSize() });
    };
    try {
      await page.goto(origin + '/?locale=' + locale + '#/friends');
      const tabs = key => node(page, 'tab.' + key);
      const row = page.locator('.lamma-friend-row').filter({ has: node(page, 'friend-chat') });
      await row.first().waitFor();
      const nav = page.locator('.menu-navigation');
      assert.equal(await nav.locator('.menu-navigation-dot').isVisible(), true);
      assert.equal(await nav.locator('.menu-navigation-badge').count(), 0);
      checks.push('request-only-dock-indicator');
      state.friends = state.friends.map((friend, index) => ({ ...friend, unreadCount: [3, 1, 0][index] }));
      state.groups = groups.map((group, index) => ({ ...group, unreadCount: index === 0 ? 2 : 0 }));
      await page.reload();
      await row.first().waitFor();
      for (const [tab, expected] of [['chats', 4], ['groups', 2], ['requests', 2]]) {
        const badge = tabs(tab).locator('b');
        await badge.waitFor();
        assert.equal(await badge.textContent(), expected.toLocaleString(locale));
      }
      if (locale === 'en') assert.match(await row.last().innerText(), /Last seen \d+ minutes ago/);
      await nav.locator('.menu-navigation-badge').waitFor();
      const portraitGeometry = await row.first().locator('.player-avatar-portrait').evaluate(element => {
        const style = getComputedStyle(element);
        return { radius: style.borderRadius, overflow: style.overflow, width: element.getBoundingClientRect().width };
      });
      assert.deepEqual(portraitGeometry, { radius: '50%', overflow: 'hidden', width: 62 });
      await row.first().locator('.lamma-favorite').click();
      await page.locator('.lamma-friend-filters button').last().click();
      assert.equal(await row.count(), 1);
      await page.locator('.lamma-friend-filters button').first().click();
      await save('friends-list');
      await tabs('chats').click();
      assert.equal(await page.locator('.lamma-online-shortcuts button').count(), 2);
      await save('chats-list');
      await tabs('groups').click();
      assert.equal(await node(page, 'group-row').count(), 3);
      await save('groups-list');
      await tabs('requests').click();
      assert.equal(await page.locator('.lamma-request').count(), 3);
      await save('requests');
      checks.push('four-tabs-presence-favorites-previews-requests');
      await node(page, 'add-friend').click();
      const search = page.locator('.social-friend-search');
      await search.locator('input').fill(locale === 'en' ? 'No' : 'نور');
      await search.locator('.social-search-result').nth(2).waitFor();
      assert.equal(await search.locator('.social-search-result .btn-primary').count(), 2);
      assert.equal(await search.locator('.social-status-pill').count(), 1);
      await save('search-relationships');
      await search.locator('input').fill('Zzz');
      await search.locator('.social-search-loupe').waitFor();
      await page.setViewportSize({ width, height: 490 });
      await save('search-empty-short-viewport');
      assert.ok((await search.boundingBox()).y >= -1);
      await page.setViewportSize({ width, height });
      await search.locator('[data-design-id="close"]').click();
      await search.waitFor({ state: 'detached' });
      await node(page, 'friend-accept').click();
      await page.waitForFunction(() => !document.querySelector('[data-design-id="friend-accept"]'));
      assert.ok(state.writes.some(item => item.pathname === '/api/social/requests/in-1/accept'));
      await page.locator('.lamma-notice button').click();
      checks.push('relationship-search-sheet-no-results-and-request-action');
      await tabs('chats').click();
      await page.locator('.lamma-online-shortcuts button').nth(1).click();
      const log = page.locator('.social-message-scroll');
      const composer = page.locator('.social-composer textarea');
      await node(page, 'game-invite-join').waitFor();
      assert.equal(await composer.getAttribute('dir'), locale === 'ar' ? 'rtl' : 'ltr');
      assert.match(await page.locator('.social-message.is-theirs .social-bubble.is-invite').evaluate(bubble => getComputedStyle(bubble).backgroundImage), /linear-gradient/);
      assert.equal(await node(page, 'game-invite-join').isEnabled(), true);
      assert.equal(await node(page, 'record').isEnabled(), true);
      assert.equal(await node(page, 'call').isEnabled(), true);
      assert.equal(await page.locator('.lamma-voice-player progress').getAttribute('max'), '12000');
      const ownBox = await page.locator('[data-message-key="message-28"]').boundingBox();
      const peerBox = await page.locator('[data-message-key="message-29"]').boundingBox();
      assert.equal(locale === 'ar' ? ownBox.x < peerBox.x : ownBox.x + ownBox.width > peerBox.x + peerBox.width, true);
      assert.equal(await page.locator('[data-message-key="message-28"] time').count(), 1);
      assert.equal(await page.locator('[data-message-key="message-28"] .social-delivery.is-read').count(), 1);
      assert.equal(await page.locator('[data-message-key="message-29"] p').getAttribute('dir'), 'auto');
      await save('chat-voice-invitation');
      const voiceResponse = page.waitForResponse(response => response.url().endsWith('/api/social/attachments/voice-1/content'));
      await node(page, 'voice-play').click();
      const response = await voiceResponse;
      await page.waitForFunction(() => Number(document.querySelector('.lamma-voice-player progress').value) > 100 || document.querySelector('.lamma-voice-message [role="alert"]'));
      playback = await page.locator('.lamma-voice-message audio').evaluate(element => ({
        played: !element.paused && element.currentTime > .1, currentTime: element.currentTime,
        canPlayWav: element.canPlayType('audio/wav'),
        playError: window.socialPlaybackError ?? null, mediaError: element.error?.code ?? null,
        alert: element.closest('.lamma-voice-message').querySelector('[role="alert"]')?.textContent ?? null,
      }));
      playback.http = { status: response.status(), mime: response.headers()['content-type'], length: response.headers()['content-length'] };
      assert.equal(playback.http.status, 200);
      assert.equal(playback.http.mime, 'audio/wav');
      if (playback.played) {
        await save('chat-voice-playing');
        await node(page, 'voice-play').click();
        assert.equal(await page.locator('.lamma-voice-message audio').evaluate(element => element.paused), true);
      } else {
        assert.equal(engineName, 'webkit');
        assert.ok(playback.alert && playback.playError);
        assert.equal(await node(page, 'voice-play').isEnabled(), true);
        await save('chat-voice-playback-error');
      }
      await composer.fill(locale === 'ar' ? 'رح أنضم بعد دقيقة.' : 'Joining in a minute.');
      await node(page, 'send').click();
      const failed = page.locator('.social-message.is-failed');
      await failed.waitFor();
      assert.equal(await failed.locator('.social-message-actions').count(), 0);
      await page.locator('.lamma-notice button').click();
      await page.locator('[data-message-key="message-28"] .social-message-actions button').click();
      await node(page, 'message-edit').waitFor();
      await save('chat-failed-and-actions');
      await page.keyboard.press('Escape');
      await failed.locator('[data-design-id="message-retry"]').click();
      await failed.waitFor({ state: 'detached' });
      const sent = state.writes.filter(item => item.pathname.endsWith('/messages') && item.method === 'POST');
      assert.equal(sent.length, 2);
      assert.equal(sent[0].body.clientId, sent[1].body.clientId);
      checks.push('rtl-ltr-bubbles-metadata-voice-invitation-retry');
      state.messages = [...olderMessages, ...state.messages];
      await page.evaluate(() => window.refreshSocial({ quiet: true }));
      await page.locator('[data-message-key="message-1"]').waitFor();
      await log.evaluate(element => { element.scrollTop = 90; });
      await page.waitForFunction(() => document.querySelector('.social-message-scroll').scrollTop <= 92);
      const at = await log.evaluate(element => element.scrollTop);
      await composer.fill(locale === 'ar' ? 'Ready الساعة ٩' : 'Ready at الساعة ٩');
      await page.evaluate(() => {
        Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 500 });
        window.visualViewport.dispatchEvent(new Event('resize'));
      });
      await page.waitForFunction(() => document.querySelector('.social-composer').getBoundingClientRect().bottom <= 502);
      state.messages.push({ seq: state.messages.at(-1).seq + 1, senderId: 'omar', kind: 'text', text: 'New while reading', createdAt: Date.now() });
      await page.evaluate(() => window.refreshSocial({ quiet: true }));
      await node(page, 'new-messages').waitFor();
      assert.ok(Math.abs(await log.evaluate(element => element.scrollTop) - at) <= 2);
      const jumpLayout = await node(page, 'new-messages').evaluate(button => {
        const action = button.getBoundingClientRect();
        const log = button.parentElement.querySelector('.social-message-scroll').getBoundingClientRect();
        const composer = button.closest('.social-chat').querySelector('.social-composer').getBoundingClientRect();
        return { action: action.toJSON(), log: log.toJSON(), composer: composer.toJSON() };
      });
      assert.ok(jumpLayout.log.height >= 50 && jumpLayout.action.top >= jumpLayout.log.bottom - 1);
      assert.ok(jumpLayout.action.bottom <= jumpLayout.composer.top + 1 && jumpLayout.action.height >= 47.9);
      await save('chat-reading-keyboard-viewport');
      await node(page, 'new-messages').click();
      await page.waitForFunction(() => {
        const element = document.querySelector('.social-message-scroll');
        return element.scrollHeight - element.scrollTop - element.clientHeight < 8;
      });
      assert.equal(await composer.inputValue(), locale === 'ar' ? 'Ready الساعة ٩' : 'Ready at الساعة ٩');
      checks.push('short-visual-viewport-composer-reading-anchor-jump');
      await page.setViewportSize({ width: 360, height });
      await page.evaluate(() => {
        Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 320 });
        window.visualViewport.dispatchEvent(new Event('resize'));
      });
      await settle(page);
      const trigger = log.locator('.social-message.is-mine .social-message-actions button').last();
      await trigger.click();
      const edit = node(page, 'message-edit');
      await edit.waitFor();
      const hit = await page.locator('.social-message-menu button').evaluateAll(buttons => buttons.map(button => {
        const rect = button.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= document.querySelector('.social-composer').getBoundingClientRect().top &&
          button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      }));
      assert.deepEqual(hit, [true, true]);
      await save('chat-actions-short-360');
      await edit.click();
      const dialog = page.locator('[data-design-screen="social.action"]');
      await dialog.waitFor();
      await dialog.locator('[data-design-id="cancel"]').click();
      await dialog.waitFor({ state:'detached' });
      assert.equal(await composer.inputValue(), locale === 'ar' ? 'Ready الساعة ٩' : 'Ready at الساعة ٩');
      checks.push('message-actions-hit-test-and-real-edit-dialog-at-360x320');
      await page.evaluate(() => { delete window.visualViewport.height; window.visualViewport.dispatchEvent(new Event('resize')); });
      await page.setViewportSize({ width, height });
      await page.locator('.social-chat-head [data-design-id="back"]').click();
      if (await page.locator('.lamma-notice button').isVisible()) await page.locator('.lamma-notice button').click();
      await tabs('friends').click();
      for (const checkWidth of [360, 390, 430]) {
        await page.setViewportSize({ width: checkWidth, height });
        await settle(page);
        assert.deepEqual(await page.evaluate(elementsFit, '.lamma-tab,.lamma-friend-row,.lamma-copy-code'), { overflow: false, outside: [] });
        const targets = await page.locator('.lamma-tabs button,.lamma-friend-row button,.lamma-list-footer button').evaluateAll(elements => elements.map(element => {
          const bounds = element.getBoundingClientRect();
          return [element.getAttribute('data-design-id'), bounds.width, bounds.height];
        }));
        for (const [id, targetWidth, targetHeight] of targets) assert.ok(targetWidth >= 47.9 && targetHeight >= 47.9, String(id) + ' touch target at ' + checkWidth);
      }
      for (const checkWidth of [360, 390, 430]) {
        await page.setViewportSize({ width: checkWidth, height });
        await page.goto(origin + '/?locale=' + locale + '&large#/friends');
        await row.first().waitFor();
        await settle(page);
        assert.deepEqual(await page.evaluate(elementsFit, '.lamma-tabs button,.lamma-friend-row,.lamma-copy-code'), { overflow: false, outside: [] });
        const title = await page.locator('.lamma-panel-title h2 bdi').evaluate(element => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return { font: getComputedStyle(element).fontSize, lines: range.getClientRects().length };
        });
        assert.deepEqual(title, { font: '64px', lines: 1 }, 'large title must remain readable as a whole word');
        const geometry = await page.evaluate(() => {
          const button = document.querySelector('.lamma-list-footer [data-design-id="add-friend"]');
          const text = [...button.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
          const range = document.createRange();
          range.selectNodeContents(text);
          const actionLines = range.getClientRects().length;
          const overlaps = [...document.querySelectorAll('.lamma-tabs button:has(b)')].some(tab => {
            const label = tab.querySelector('span');
            const badge = tab.querySelector('b').getBoundingClientRect();
            range.selectNodeContents(label);
            return [...range.getClientRects()].some(rect => rect.left < badge.right && rect.right > badge.left
              && rect.top < badge.bottom && rect.bottom > badge.top);
          });
          return { actionLines, overlaps };
        });
        assert.deepEqual(geometry, { actionLines: 1, overlaps: false });
        await save('friends-text200-' + checkWidth);
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(await page.evaluate(() => window.untranslated()), []);
      checks.push('touch-targets-and-overflow-360-390-430-plus-css-text-scale');
      await writeFile(path.join(output, engineName + '-' + locale + '.json'), JSON.stringify({
        passed: true, engine: engineName, locale, checks, captures, sources, bundleSha256: hash(bundle), errors, playback,
        scope: 'Real components/providers/router, generated fixtures, local HTTP including PCM playback and simulated visualViewport. Native keyboard, microphone and external calls remain untested here.',
      }, null, 2));
    } catch (error) {
      await save('failure').catch(() => {});
      await writeFile(path.join(output, engineName + '-' + locale + '-failure.json'), JSON.stringify({ error: String(error), checks, errors, writes: state.writes, sources, playback }, null, 2));
      throw error;
    } finally {
      await browser.close();
    }
  });
}
