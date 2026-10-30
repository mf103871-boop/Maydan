import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

mkdirSync(path.resolve('.cache'), { recursive: true });
const dir = mkdtempSync(path.resolve('.cache/plus-stickers-ui-'));
after(() => rmSync(dir, { recursive: true, force: true }));
await build({ stdin: { contents: `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {StickerMessage,StickerPicker} from './src/social/PlusStickers.jsx';import {MessageBubble} from './src/social/SocialScreen.jsx';const render=(C,p)=>renderToStaticMarkup(React.createElement(C,p));export const sticker=p=>render(StickerMessage,p);export const bubble=p=>render(MessageBubble,p);export const picker=p=>render(StickerPicker,p);`, resolveDir: process.cwd(), loader: 'jsx' }, outfile: path.join(dir, 'render.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'silent' });
const render = await import(pathToFileURL(path.join(dir, 'render.mjs')));

test('historical sticker renders immutable local catalogue artwork, never a supplied external source', () => {
  const html = render.sticker({ message: { kind: 'sticker', stickerId: 'sahra.sticker.1', stickerVersion: 1,
    sticker: { assetUrl: 'https://attacker.invalid/tracking' }, text: 'ملصق: كفو' } });
  assert.match(html, /assets\/plus\/v1\/sahra-sticker-1.svg/); assert.match(html, /alt="كفو"/);
  assert.doesNotMatch(html, /attacker.invalid/);
});

test('unknown versions fall back to readable text and tombstones never render sticker metadata', () => {
  const message = { seq: 11, kind: 'sticker', stickerId: 'sahra.sticker.1', stickerVersion: 999, text: 'ملصق: كفو — حدّث التطبيق لعرضه' };
  const fallback = render.sticker({ message }); assert.match(fallback, /حدّث التطبيق/); assert.doesNotMatch(fallback, /<img/);
  const deleted = render.bubble({ message: { ...message, stickerVersion: 1, deletedAt: Date.now() }, mine: true });
  assert.match(deleted, /حُذفت هذه الرسالة/); assert.doesNotMatch(deleted, /كفو|sticker-1|<img/);
  const current = render.bubble({ message: { ...message, stickerVersion: 1 }, mine: true });
  assert.match(current, /sticker-1.svg/); assert.doesNotMatch(current, /message-edit/);
});

test('sticker composer has an explicit named control and is unavailable offline', () => {
  const html = render.picker({ account: { user: { id: 'one' }, premium: false }, disabled: true });
  assert.match(html, /ملصقات ميدان/); assert.match(html, /aria-expanded="false"/); assert.match(html, /disabled/);
  assert.doesNotMatch(html, /<img/);
});
