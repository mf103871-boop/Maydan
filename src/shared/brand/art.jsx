import React from 'react';
import { tr } from '../i18n/core.js';
import mafiaArt from './assets/playful-studio/mafia.webp';
import ersomhaArt from './assets/playful-studio/ersomha.webp';
import badeehaArt from './assets/playful-studio/badeeha.webp';
import beepArt from './assets/playful-studio/beep.webp';
import mamnooArt from './assets/playful-studio/mamnoo.webp';
import jabeenArt from './assets/playful-studio/jabeen.webp';
import fabrakaArt from './assets/playful-studio/fabraka.webp';
import meenfinaArt from './assets/playful-studio/meenfina.webp';
import avatarSheet from './assets/avatars.webp';
import trophy from './assets/trophy.webp';
import world from './assets/world.webp';
import mark from './assets/playful-studio/brand-mark.webp';
import arabicFont from './assets/arabic.woff2';
import latinFont from './assets/latin.woff2';
import { AVATAR_OPTIONS, resolveAvatarIndex } from './avatar-identity.js';
export { AVATAR_OPTIONS } from './avatar-identity.js';

// The build ships the art and fonts as content-hashed files the service worker
// installs before activation, so they stay available offline.
// Independent alpha artwork shares one source across the menu and game screens.
// Existing avatar identities continue to use their original sprite positions.
const GAMES = Object.freeze({ mafia: mafiaArt, ersomha: ersomhaArt, badeeha: badeehaArt, beep: beepArt, mamnoo: mamnooArt, jabeen: jabeenArt, fabraka: fabrakaArt, meenfina: meenfinaArt });
export const GAME_ARTWORK_IDS = Object.freeze(Object.keys(GAMES));
export const SHELL_ARTWORK_URLS = Object.freeze([mark, avatarSheet, ...Object.values(GAMES)]);

export function BrandFonts() {
  return <style>{`
    @font-face { font-family: 'Maydan Round'; font-style: normal; font-weight: 400 800; font-display: swap; src: url('${latinFont}') format('woff2'); }
    @font-face { font-family: 'Maydan Round'; font-style: normal; font-weight: 400 800; font-display: swap; src: url('${arabicFont}') format('woff2'); unicode-range: U+0600-06FF,U+0750-077F,U+0870-089F,U+08A0-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FEFF; }
  `}</style>;
}

export function GameArtwork({ game, className = '', style = {} }) {
  return <span className={`clay-art playful-game-art ${className}`} data-game={game} aria-hidden="true" style={style}><img src={GAMES[game] || GAMES.badeeha} alt="" width="512" height="512" decoding="async" draggable="false" /></span>;
}

export function Avatar({ player, emoji, index, className = '', style = {} }) {
  const position = resolveAvatarIndex({player,emoji,index});
  return <span className={`clay-avatar ${className}`} data-index={position} aria-hidden="true" style={{ backgroundImage: `url(${avatarSheet})`, backgroundPosition: `${position % 2 * 100}% ${Math.floor(position / 2) * 100}%`, ...style }} />;
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
