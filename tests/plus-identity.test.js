import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = process.cwd();
await mkdir(path.join(root, '.cache'), { recursive: true });
const dir = await mkdtemp(path.join(root, '.cache/plus-identity-'));
after(() => rm(dir, { recursive: true, force: true }));
await build({ stdin: { contents: `import React from 'react';import{renderToStaticMarkup}from'react-dom/server';import{ProfileAvatar,frameDetail}from'./src/profiles/ProfileAvatar.jsx';import{PlayerName,PlayerIdentity,MembershipBadge}from'./src/profiles/PlayerIdentity.jsx';import{ProductPreview}from'./src/plus/ProductPreview.jsx';export{frameDetail};export{cosmeticPosterSources}from'./src/profiles/identity-assets.js';const render=(C,p)=>renderToStaticMarkup(React.createElement(C,p));export const avatar=p=>render(ProfileAvatar,p),name=p=>render(PlayerName,p),identity=p=>render(PlayerIdentity,p),badge=p=>render(MembershipBadge,p),preview=p=>render(ProductPreview,p);`, resolveDir: root, loader: 'jsx' }, outfile: path.join(dir, 'render.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', define: { __MAYDAN_ROOMS_URL__: JSON.stringify('https://identity.invalid') }, logLevel: 'silent' });
const view = await import(pathToFileURL(path.join(dir, 'render.mjs')));
const photo = 'https://identity.invalid/api/profiles/member/images/avatar/' + 'a'.repeat(64);
const user = { id: 'member', name: 'أحمد', avatarUrl: photo, theme: 'teal', avatarPreset: 'fox', cosmetics: { frameId: 'sahra.frame', badge: false } };

test('an equipped frame keeps the uploaded portrait inside its own crop and the decorative art outside it', () => {
  const html = view.avatar({ user, size: 40 });
  assert.ok(html.includes(photo));
  assert.match(html, /overflow:visible/);
  assert.match(html, /class="player-avatar-portrait"[^>]*><img[^>]*\/><\/span><span class="player-avatar-frame/);
  assert.doesNotMatch(html, /sahra-avatar\.webp/);
});

test('chat, seat and profile sizes select three distinct frame detail assets', () => {
  for (const [size, detail, filename] of [[24, 'small', 'frame-small.svg'], [40, 'medium', 'frame-medium.webp'], [100, 'large', 'frame.webp']]) {
    const html = view.avatar({ user, size });
    assert.equal(view.frameDetail(size), detail);
    assert.ok(html.includes(`data-frame-detail="${detail}"`));
    assert.ok(html.includes(filename));
    assert.ok(html.includes(`min-width:${size}px`));
  }
});

test('only an explicitly equipped character replaces the uploaded portrait and static posters do not claim motion', () => {
  const equipped = { ...user, cosmetics: { ...user.cosmetics, avatarId: 'artist.avatar' } };
  const html = view.avatar({ user: equipped });
  assert.match(html, /artist-avatar\.webp/);
  assert.doesNotMatch(html, new RegExp(photo));
  assert.doesNotMatch(html, /has-motion|plus-avatar-breathe/);
});

test('gold ownership and local premium-shaped fields cannot create the membership badge', () => {
  assert.equal(view.badge({ user }), '');
  assert.equal(view.badge({ user: { ...user, premium: true, plusMember: true, preferred: { badge: true } } }), '');
  assert.equal(view.badge({ user: { ...user, cosmetics: { badge: 1 } } }), '');
  const member = { ...user, cosmetics: { frameId: 'artist.frame', badge: true } };
  assert.match(view.identity({ user: member }), /aria-label="عضو ميدان بلس"/);
  assert.match(view.identity({ user: member }), /artist-frame/);
});

test('the name card is independent from the selected cover and escapes the actual player name', () => {
  const html = view.name({ user: { ...user, name: '<img src=x onerror=alert(1)>', cosmetics: { coverId: 'artist.cover', nameColorId: 'noir.nameColor', badge: false } }, card: true });
  assert.match(html, /noir-name-card\.webp/);
  assert.doesNotMatch(html, /artist-cover|sahra-cover/);
  assert.match(html, /<bdi[^>]*>&lt;img/);
  assert.doesNotMatch(html, /<img src="x"/);
});

test('missing new art has a bounded existing-art fallback without inventing a new collection URL', () => {
  assert.deepEqual(view.cosmeticPosterSources({ collectionId: 'artist', posterUrl: '/new.webp', assetUrl: '/new.webp' }), ['/new.webp', '/assets/plus/v1/artist.webp']);
  assert.deepEqual(view.cosmeticPosterSources({ collectionId: '../private', posterUrl: '/new.webp' }), ['/new.webp']);
  assert.deepEqual(view.cosmeticPosterSources(null), []);
});

test('current Plus preview contains only profile presentation and preserves the original uploaded photograph', () => {
  const html=view.preview({user,items:[{id:'sahra.profileSkin',kind:'profileSkin'}]});
  assert.match(html,/معاينة بروفايلك/);assert.ok(html.includes(photo));
  assert.match(html,/profile-sahra-background\.webp/);
  assert.doesNotMatch(html,/assets\/council|council-scene|مقعد اللعب|RoomLook|plus-room-entrance/);
});