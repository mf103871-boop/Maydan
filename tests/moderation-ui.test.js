import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { emptyModeration } from '../src/moderation/client.js';
const root = process.cwd(); const cache = path.join(root, '.cache'); mkdirSync(cache, { recursive: true });
const dir = mkdtempSync(path.join(cache, 'moderation-ui-'));
after(() => { assert.equal(path.dirname(path.resolve(dir)), path.resolve(cache)); rmSync(dir, { recursive: true, force: true }); });
await build({ stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server'; import {ModerationView,ReportCard,PendingImageCard} from './src/moderation/ModerationScreen.jsx'; import {ImageReviewStatus} from './src/profiles/ImageReviewStatus.jsx'; import {AccountCard} from './src/shared/account/AccountCard.jsx'; import {AccountContext} from './src/shared/account/context.js'; const html=(C,p)=>renderToStaticMarkup(React.createElement(C,p)).replace(/<style>[\\s\\S]*?<\\/style>/g,''); export const screen=p=>html(ModerationView,p); export const report=p=>html(ReportCard,p); export const image=p=>html(PendingImageCard,p); export const review=p=>html(ImageReviewStatus,p); export const account=p=>renderToStaticMarkup(React.createElement(AccountContext.Provider,{value:p},React.createElement(AccountCard)));`, resolveDir: root, loader: 'jsx' }, outfile: path.join(dir, 'render.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
const render = await import(pathToFileURL(path.join(dir, 'render.mjs')));
const account = { signedIn: true, user: { id: 'owner' } };
const report = { id: 'r', reportedUser: { id: 'u', name: 'لاعب', code: 'MDN-AAAA000000', revision: 4 }, reason: 'PRIVATE_REASON', messageText: '<img src=x onerror=alert(1)>', messageSeq: 1, createdAt: 1000 };
const state = { ...emptyModeration(), userId: 'owner', ready: true, moderator: true, reports: [report] };
const client = { start() {}, load() {}, act() {} };

test('moderation UI conceals cached evidence from guests, denied accounts and switched identities', () => {
  for (const props of [{ account: { signedIn: false }, state }, { account, state: { ...state, moderator: false } }, { account: { signedIn: true, user: { id: 'other' } }, state }]) {
    const html = render.screen({ ...props, client }); assert.doesNotMatch(html, /PRIVATE_REASON|MDN-AAAA000000|إزالة الرسالة/);
  }
});

test('authorized report UI escapes content and presents versioned, explicit review actions', () => {
  const html = render.screen({ account, state, client });
  assert.match(html, /PRIVATE_REASON/); assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img[^>]*onerror/);
  for (const label of ['إغلاق البلاغ', 'إزالة الرسالة', 'تعليق الحساب', 'إزالة الاسم والنبذة', 'سجل القرارات']) assert.ok(html.includes(label), label);
  assert.match(render.report({ report: { ...report, reportedUser: { ...report.reportedUser, suspended: true } }, onDecision() {} }), /إعادة تفعيل الحساب/);
});

test('pending image views do not insert private URLs in img src and make approval explicit', () => {
  const html = render.image({ image: { id: 'review-1', kind: 'avatar', version: 'a'.repeat(64), user: { name: 'ليان' }, previewUrl: '/api/moderation/images/review-1/' + 'a'.repeat(64) }, onDecision() {} });
  assert.match(html, /لم تُنشر بعد/); assert.match(html, /اعتماد الصورة/); assert.match(html, /رفض الصورة/);
  assert.doesNotMatch(html, /<img|\/api\/moderation\/images/);
});

test('owner review notices distinguish pending, rejected and removed, and escape review notes', () => {
  const pending = render.review({ kind: 'cover', review: { status: 'pending', previewUrl: '/api/profiles/me/images/cover/pending/' + 'a'.repeat(64) } });
  assert.match(pending, /بانتظار المراجعة/); assert.match(pending, /تبقى النسخة المعتمدة السابقة/); assert.match(pending, /معاينة صورتي المرسلة/);
  assert.doesNotMatch(pending, /<img|pending\//);
  assert.match(render.review({ kind: 'avatar', review: { status: 'rejected', rejectionReason: '<script>unsafe</script>' } }), /لم تُقبل.*&lt;script&gt;/s);
  assert.match(render.review({ kind: 'avatar', review: { status: 'removed' } }), /أُزيلت/);
});

test('suspended account keeps deletion, subscription management, restore and signout available', () => {
  const html = render.account({ ...account, platform: 'ios', premium: true, me: { premium: { active: true, source: 'apple', until: Date.now()+100000 }, moderation: { suspended: true, reason: 'سبب المراجعة' } }, refresh() {} });
  for (const label of ['حسابك معلّق', 'سبب المراجعة', 'إدارة الاشتراك', 'استعادة المشتريات', 'حذف الحساب', 'تسجيل الخروج', 'التواصل مع الدعم']) assert.ok(html.includes(label), label);
  assert.doesNotMatch(html, /بروفايلي وإنجازاتي/);
});
