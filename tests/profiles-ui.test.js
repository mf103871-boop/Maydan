import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { ACHIEVEMENTS } from '../src/profiles/catalog.js';

const root = process.cwd(); mkdirSync(path.join(root, '.cache'), { recursive: true });
const dir = mkdtempSync(path.join(root, '.cache', 'profiles-ui-'));
after(() => rmSync(dir, { recursive: true, force: true }));
await build({ stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {ProfileView,ProfileEditor,Achievements,ProfileStats,profileShareUrl,profilePresence,profileEditPatch} from './src/profiles/ProfileScreen.jsx'; const html=(C,p)=>renderToStaticMarkup(React.createElement(C,p)).replace(/<style>[\\s\\S]*?<\\/style>/g,''); export const screen=p=>html(ProfileView,p); export const editor=p=>html(ProfileEditor,p); export const achievements=p=>html(Achievements,p); export const stats=p=>html(ProfileStats,p); export {profileShareUrl,profilePresence,profileEditPatch};`, resolveDir: root, loader: 'jsx' }, outfile: path.join(dir, 'render.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
const render = await import(pathToFileURL(path.join(dir, 'render.mjs')));
const noop = () => {};
const profile = { id: 'me', name: 'عبدالله', code: 'MDN-A12B34C56D', bio: 'أحب جمعة الأصحاب', theme: 'teal', avatarPreset: 'falcon', selectedTitle: 'member', featuredBadges: ['welcome'], earnedTitles: ['member'], earnedBadges: ['welcome'], achievements: ACHIEVEMENTS.map(rule => ({ ...rule, current: rule.id === 'welcome' ? 1 : 0 })), stats: { localSessions: 8, onlineMatches: 6, onlineWins: 2, onlineDraws: 1, distinctGames: 4 }, friendCount: 3, relationship: 'self', revision: 1 };
const account = { ready: true, signedIn: true, user: { id: 'me' } };
const profiles = { mine: profile, profiles: {}, loading: {}, errors: {}, loadProfile: noop };
const social = {};

test('signed-out and startup states do not reveal previously loaded account details', () => {
  for (const auth of [{ ready: false, signedIn: false }, { ready: true, signedIn: false }]) {
    const html = render.screen({ account: auth, profiles, social });
    assert.doesNotMatch(html, /MDN-A12B34C56D|أحب جمعة الأصحاب|عبدالله|تعديل الملف/);
  }
  assert.match(render.screen({ account: { ready: true, signedIn: false }, profiles, social, profileId: 'friend' }), /تسجيل الدخول/);
});

test('owner profile displays identity, earned title, copy/share actions and edit control', () => {
  const html = render.screen({ account, profiles, social });
  for (const text of ['عبدالله', 'MDN-A12B34C56D', 'أحب جمعة الأصحاب', 'عضو ميدان', 'مشاركة الملف', 'نسخ رمز الصديق', 'تعديل الملف']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /إضافة صديق|خيارات الحساب/);
  assert.match(render.screen({ account, profiles, social, profileId: 'me' }), /تعديل الملف/);
});

test('public relationship states offer only the appropriate friendship action', () => {
  const cases = { none: 'إضافة صديق', friend: 'محادثة', pending_incoming: 'قبول الصداقة', pending_outgoing: 'إلغاء الطلب' };
  for (const [relationship, action] of Object.entries(cases)) {
    const other = { ...profile, id: 'friend', relationship };
    const html = render.screen({ account, profiles: { ...profiles, profiles: { friend: other } }, social, profileId: 'friend' });
    assert.ok(html.includes(action), relationship); assert.match(html, /خيارات الحساب/); assert.doesNotMatch(html, /تعديل الملف/);
    for (const otherAction of Object.values(cases).filter(value => value !== action)) assert.ok(!html.includes('>' + otherAction + '</button>'), relationship + ': ' + otherAction);
  }
});

test('blocked or unavailable profile errors conceal cached personal data', () => {
  const html = render.screen({ account, profiles: { ...profiles, profiles: { friend: { ...profile, id: 'friend' } }, errors: { friend: 'هذا البروفايل غير متاح.' } }, social, profileId: 'friend' });
  assert.match(html, /تعذّر عرض الملف/); assert.doesNotMatch(html, /MDN-A12B34C56D|أحب جمعة الأصحاب|مشاركة الملف/);
});

test('earned arrays govern rewards; inflated statistics do not unlock title or featured badge controls', () => {
  const unearned = { ...profile, selectedTitle: 'legend', featuredBadges: ['twenty-five-wins'], stats: { ...profile.stats, onlineWins: 999 } };
  const html = render.screen({ account, profiles: { ...profiles, mine: unearned }, social });
  assert.doesNotMatch(html, /profile-earned-title|profile-featured-badge/);
  const editor = render.editor({ profile: unearned, profiles, onClose: noop, onSaved: noop });
  assert.match(editor, /<option[^>]*value="legend"[^>]*disabled/);
  assert.match(editor, /aria-label="اسم في الميدان، لم تُفتح بعد"[^>]*disabled/);
  assert.match(editor, /شاراتك البارزة · <bdi dir="ltr">[٠0] \/ [٣3]/);
});

test('statistics distinguish hosted sessions, online wins and games without inventing old totals', () => {
  const html = render.stats({ profile });
  for (const label of ['جلسات مستضافة', 'مباريات أونلاين', 'انتصارات أونلاين', 'ألعاب مختلفة', 'منذ إطلاق الملفات الشخصية']) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /نسبة الفوز|إجمالي انتصاراتك/);
  const missing = render.stats({ profile: {} }); assert.equal((missing.match(/<strong>—<\/strong>/g) || []).length, 4);
});

test('achievement progress is bounded and locked state remains clear', () => {
  const html = render.achievements({ profile: { ...profile, achievements: [{ id: 'circle', current: 3 }] }, owner: true });
  assert.match(html, /aria-label="شلّة ميدان" aria-valuemin="0" aria-valuemax="5" aria-valuenow="3"/);
  assert.match(html, /width:60%/); assert.match(html, /لم يُفتح بعد/); assert.match(html, /أهلًا في الميدان، مكتمل/);
});

test('user biography is text, profile links are canonical, and missing last-active time stays unknown', () => {
  const html = render.screen({ account, profiles: { ...profiles, mine: { ...profile, bio: '<img src=x onerror=alert(1)>' } }, social });
  assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img[^>]*onerror/);
  assert.equal(render.profileShareUrl('abc-123'), 'https://maydan-game.mf103871.workers.dev/#/profile/abc-123');
  assert.equal(render.profilePresence({}), null); assert.equal(render.profilePresence({ online: true }), 'متصل الآن');
});

test('text saves retain the editor revision and never replace an uploaded avatar implicitly', () => {
  const draft = { name: '  عبدالله  ', bio: '  نبذة  ', avatarPreset: 'fox', theme: 'teal', selectedTitle: '', featuredBadges: ['welcome'] };
  const textOnly = render.profileEditPatch(draft, { revision: 7 });
  assert.equal(textOnly.revision, 7); assert.equal(textOnly.name, 'عبدالله'); assert.equal(textOnly.bio, 'نبذة');
  assert.equal(textOnly.selectedTitle, null); assert.equal(Object.hasOwn(textOnly, 'avatarPreset'), false);
  const explicitPreset = render.profileEditPatch(draft, { revision: 8, avatarChosen: true });
  assert.equal(explicitPreset.avatarPreset, 'fox'); assert.equal(explicitPreset.revision, 8);
});
