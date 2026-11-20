import React from 'react';
import { getPlayfulSceneArt } from './playful-scenes.js';
import { tr } from '../i18n/core.js';
import mafiaArt from './assets/playful-studio/mafia-b-v2.webp';
import ersomhaArt from './assets/playful-studio/ersomha-v2.webp';
import badeehaArt from './assets/playful-studio/badeeha-b-v2.webp';
import beepArt from './assets/playful-studio/beep-v2.webp';
import mamnooArt from './assets/playful-studio/mamnoo.webp';
import jabeenArt from './assets/playful-studio/jabeen-v2.webp';
import fabrakaArt from './assets/playful-studio/fabraka-v2.webp';
import meenfinaArt from './assets/playful-studio/meenfina-v2.webp';
import { getLegacyAvatarArt, LEGACY_AVATAR_URLS } from './legacy-avatar-art.js';
import trophy from './assets/trophy.webp';
import world from './assets/world.webp';
import mark from './assets/playful-studio/brand-mark.webp';
import latin400 from './assets/fonts/latin-400.woff2';
import latin500 from './assets/fonts/latin-500.woff2';
import latin600 from './assets/fonts/latin-600.woff2';
import latin700 from './assets/fonts/latin-700.woff2';
import latin800 from './assets/fonts/latin-800.woff2';
import arabic400 from './assets/fonts/arabic-400.woff2';
import arabic500 from './assets/fonts/arabic-500.woff2';
import arabic600 from './assets/fonts/arabic-600.woff2';
import arabic700 from './assets/fonts/arabic-700.woff2';
import arabic800 from './assets/fonts/arabic-800.woff2';
import { AVATAR_OPTIONS, resolveAvatarIndex } from './avatar-identity.js';
export { AVATAR_OPTIONS } from './avatar-identity.js';

// The build ships the art and fonts as content-hashed files the service worker
// installs before activation, so they stay available offline.
// Independent alpha artwork shares one source across the menu and game screens.
// Existing avatar identities retain their saved indices and emoji mappings.
const GAMES = Object.freeze({ mafia: mafiaArt, ersomha: ersomhaArt, badeeha: badeehaArt, beep: beepArt, mamnoo: mamnooArt, jabeen: jabeenArt, fabraka: fabrakaArt, meenfina: meenfinaArt });
export const GAME_ARTWORK_IDS = Object.freeze(Object.keys(GAMES));
export const SHELL_ARTWORK_URLS = Object.freeze([mark, ...LEGACY_AVATAR_URLS, ...Object.values(GAMES)]);

export function BrandFonts() {
  // Some WebKit renderers apply variable advance widths but keep the default
  // glyph outlines. These are static instances of the same licensed font,
  // preserving its family and shaping while selecting a real face per weight.
  const weights = [400, 500, 600, 700, 800];
  const latin = [latin400, latin500, latin600, latin700, latin800];
  const arabic = [arabic400, arabic500, arabic600, arabic700, arabic800];
  const arabicRange = 'U+0600-06FF,U+0750-077F,U+0870-089F,U+08A0-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FEFF';
  const faces = weights.map((weight, index) => `
    @font-face { font-family: 'Maydan Round'; font-style: normal; font-weight: ${weight}; font-display: swap; src: url('${latin[index]}') format('woff2'); }
    @font-face { font-family: 'Maydan Round'; font-style: normal; font-weight: ${weight}; font-display: swap; src: url('${arabic[index]}') format('woff2'); unicode-range: ${arabicRange}; }
  `).join('');
  return <style>{faces}</style>;
}

export function GameArtwork({ game, className = '', style = {}, variant = 'scene' }) {
  const artwork = variant === 'mark' && game === 'ersomha' ? getPlayfulSceneArt('drawing-pencil',64) : GAMES[game] || GAMES.badeeha;
  return <span className={`clay-art playful-game-art ${className}`} data-game={game} data-art-variant={variant} aria-hidden="true" style={style}><img src={artwork} alt="" width="512" height="512" decoding="async" draggable="false" /></span>;
}

export function Avatar({ player, emoji, index, className = '', style = {} }) {
  const position = resolveAvatarIndex({player,emoji,index});
  return <span className={`clay-avatar ${className}`} data-index={position} aria-hidden="true" style={{ backgroundImage: `url(${getLegacyAvatarArt(position, typeof style.width === 'number' ? style.width : 96)})`, backgroundPosition: 'center', backgroundSize: '100% 100%', ...style }} />;
}

// حامل الرسم: يملك ظل التلامس (::after) ويحرّك الغلاف الداخلي لا الرسم نفسه.
// idle: طفو خفيف بعد الهبوط. react: 'clay-jump' | 'clay-wiggle' | 'clay-squash' (يُدار بـ useReaction).
export function ClayStage({ className = '', idle = false, react = '', as: Tag = 'span', style, children, ...rest }) {
  return <Tag className={`clay-stage ${idle ? 'clay-idle' : ''} ${react} ${className}`.trim()} style={style} {...rest}>
    <span className="clay-lift">{children}</span>
  </Tag>;
}

export function AvatarPicker({ value, onChange, ...rest }) {
  return <div data-design-id="avatar-picker" className="avatar-picker" role="group" aria-label={tr("اختر شخصيتك")} {...rest}>{AVATAR_OPTIONS.map((option) => (
    <button key={option.emoji} type="button" data-design-id="avatar-choice" className={`avatar-choice ${value === option.emoji ? 'selected' : ''}`} aria-label={tr(option.label)} aria-pressed={value ===option.emoji} onClick={() => onChange(option.emoji)}>
      <ClayStage className="clay-static"><Avatar index={option.index} /></ClayStage>
    </button>
  ))}</div>;
}

export function TrophyArtwork({ className = '' }) {
  return <img className={`clay-trophy ${className}`} src={trophy} alt="" width="700" height="700" draggable="false" />;
}

export function BrandMark({ className = '' }) {
  return <img className={`brand-mark ${className}`} src={mark} alt="" width="512" height="512" draggable="false" />;
}

export function Wordmark({ sculpted = false }) {
  return <span className={sculpted ? 'wordmark-art' : 'brand-name'}>{tr('ميدان')}</span>;
}

export function WorldArtwork({ className = '' }) {
  return <img className={`clay-world ${className}`} src={world} alt="" width="900" height="1350" draggable="false" />;
}
