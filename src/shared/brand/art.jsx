import React from 'react';
import gameIcons from './assets/game-icons.webp';
import avatarSheet from './assets/avatars.webp';
import trophy from './assets/trophy.webp';
import world from './assets/world.webp';
import mark from './assets/mark.webp';
import arabicFont from './assets/arabic.woff2';
import latinFont from './assets/latin.woff2';

// Data URLs keep the approved art and Arabic font available offline.
// Sprite windows preserve the original artwork and share one decoded image.
const GAMES = { badeeha: [0, 0], beep: [1, 0], mamnoo: [2, 0], jabeen: [0, 1], fabraka: [1, 1], meenfina: [2, 1] };
export const AVATAR_OPTIONS = [
  { emoji: '😎', label: 'الشخصية بالكنزة الفيروزية', index: 0 },
  { emoji: '🦋', label: 'الشخصية بالحجاب البنفسجي', index: 1 },
  { emoji: '🌟', label: 'الشخصية بالنظارة البنفسجية', index: 2 },
  { emoji: '🚀', label: 'الشخصية بالقبعة الذهبية', index: 3 },
];

export function BrandFonts() {
  return <style>{`
    @font-face { font-family: 'Maydan Round'; font-style: normal; font-weight: 400 800; font-display: swap; src: url('${latinFont}') format('woff2'); }
    @font-face { font-family: 'Maydan Round'; font-style: normal; font-weight: 400 800; font-display: swap; src: url('${arabicFont}') format('woff2'); unicode-range: U+0600-06FF,U+0750-077F,U+0870-089F,U+08A0-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FEFF; }
  `}</style>;
}

export function GameArtwork({ game, className = '', style = {} }) {
  const [column, row] = GAMES[game] || GAMES.badeeha;
  return <span className={`clay-art ${className}`} data-game={game} aria-hidden="true" style={{ backgroundImage: `url(${gameIcons})`, backgroundPosition: `${column * 50}% ${row * 100}%`, ...style }} />;
}

export function Avatar({ player, emoji, index, className = '', style = {} }) {
  const value = emoji || player?.emoji || '';
  const selected = AVATAR_OPTIONS.find((option) => option.emoji === value);
  // Older saved players keep their stored identity; their portrait is stable.
  const fallback = Array.from(value || player?.id || '0').reduce((sum, char) => sum + char.codePointAt(0), 0) % 4;
  const position = index ?? selected?.index ?? fallback;
  return <span className={`clay-avatar ${className}`} data-index={position} aria-hidden="true" style={{ backgroundImage: `url(${avatarSheet})`, backgroundPosition: `${position % 2 * 100}% ${Math.floor(position / 2) * 100}%`, ...style }} />;
}

// حامل الرسم: يملك ظل التلامس (::after) ويحرّك الغلاف الداخلي لا الرسم نفسه.
// idle: طفو خفيف بعد الهبوط. react: 'clay-jump' | 'clay-wiggle' | 'clay-squash' (يُدار بـ useReaction).
export function ClayStage({ className = '', idle = false, react = '', as: Tag = 'span', style, children, ...rest }) {
  return <Tag className={`clay-stage ${idle ? 'clay-idle' : ''} ${react} ${className}`.trim()} style={style} {...rest}>
    <span className="clay-lift">{children}</span>
  </Tag>;
}

export function AvatarPicker({ value, onChange }) {
  return <div className="avatar-picker" role="group" aria-label="اختر شخصيتك">{AVATAR_OPTIONS.map((option) => (
    <button key={option.emoji} type="button" className={`avatar-choice ${value === option.emoji ? 'selected' : ''}`} aria-label={option.label} aria-pressed={value === option.emoji} onClick={() => onChange(option.emoji)}>
      <ClayStage className="clay-static"><Avatar index={option.index} /></ClayStage>
    </button>
  ))}</div>;
}

export function TrophyArtwork({ className = '' }) {
  return <img className={`clay-trophy ${className}`} src={trophy} alt="" width="700" height="700" draggable="false" />;
}

export function BrandMark({ className = '' }) {
  return <img className={`brand-mark ${className}`} src={mark} alt="" width="256" height="256" draggable="false" />;
}

export function Wordmark({ sculpted = false }) {
  return <span className={sculpted ? 'wordmark-art' : 'brand-name'}>ميدان</span>;
}

export function WorldArtwork({ className = '' }) {
  return <img className={`clay-world ${className}`} src={world} alt="" width="900" height="1350" draggable="false" />;
}
