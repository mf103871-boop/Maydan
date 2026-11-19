import React from 'react';
import { GameArtwork, TrophyArtwork } from '../../shared/brand/art.jsx';
import { getPlayfulSceneArt } from '../../shared/brand/playful-scenes.js';
import { tr } from '../../shared/i18n/core.js';
import { ChoicePortrait } from '../meenfina/Studio.jsx';
import lockArt from './fabraka-lock-v1-320.webp';
import factsArt from './fabraka-mode-facts-v1.webp';
import picturesArt from './fabraka-mode-pictures-v1.webp';
import friendsArt from './fabraka-mode-friends-v1.webp';

const MODE_ART = { classic: factsArt, mixed: getPlayfulSceneArt('category-science', 48), pictures: picturesArt, friends: friendsArt };
const MODE_TEXT = { classic: '🎭 حقائق', mixed: '✨ مزيج', pictures: '🖼️ صور', friends: '👋 أصحابنا' };

export function fabrakaModeLabel(mode) {
  return tr(MODE_TEXT[mode] || MODE_TEXT.classic).replace(/^\S+\s/u, '');
}

export function FabrakaModeArt({ mode }) {
  return <img className="fab-mode-art" src={MODE_ART[mode]} alt="" width="59" height="51" decoding="async" />;
}

export function FabrakaLock() {
  return <span className="fab-lock-art" aria-hidden="true">
    <img src={lockArt} alt="" width="178" height="178" decoding="async" />
  </span>;
}

export function FabrakaRoster({ players, score, format = String, ...props }) {
  return <div className="fab-roster" {...props}>
    {players.map(player => <div key={player.id}>
      <ChoicePortrait player={player} size={58} />
      <b dir="auto">{player.name}</b>
      {score && <strong>{format(score(player))}</strong>}
    </div>)}
  </div>;
}

export function FabrakaAwardArt({ stat }) {
  return <span className="fab-award-icon" aria-hidden="true">
    {stat === 'fooled' ? <TrophyArtwork /> : stat === 'truths'
      ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg>
      : <GameArtwork game="fabraka" />}
  </span>;
}
