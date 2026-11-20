import React from 'react';
import { Avatar, GameArtwork } from '../../shared/brand/art.jsx';
import { tr } from '../../shared/i18n/core.js';
import { IconCheck } from '../../shared/ui/icons.jsx';
import { ProfileAvatar } from '../../profiles/ProfileAvatar.jsx';

export function ChoicePortrait({ player, size = 80, cutout = false }) {
  return player.profile
    ? <ProfileAvatar user={player.profile} size={size} presentation={cutout ? 'cutout' : 'avatar'} className="choice-portrait" />
    : <Avatar player={player} index={player.avatar} className="choice-portrait" style={{ width: size, height: size }} />;
}

export function MeenQuestion({ text, art, className = '' }) {
  return <div data-design-id="question" className={`meen-statement ${art ? 'with-art' : ''} ${className}`}>
    <strong dir="auto">{text}</strong>
    {art && <GameArtwork game="meenfina" />}
  </div>;
}

export function MeenChoice({ player, selected, onClick, disabled, portraitSize = 88, className = '' }) {
  return <button type="button" data-design-id="option" className={`meen-pick ${className} ${selected ? 'selected' : ''}`} aria-pressed={selected} disabled={disabled} onClick={onClick}>
    <ChoicePortrait player={player} size={portraitSize} />
    <b dir="auto">{player.name}</b>
    {player.left && <small>{tr("غادر الجولة")}</small>}
    {selected && <span className="meen-pick-mark" aria-hidden="true"><IconCheck /></span>}
  </button>;
}

export function MeenScoreTotals({ players, score, format = String, ...props }) {
  return <div className="meen-totals" {...props}>
    <h3 className="meen-result-title">{tr("إجمالي النقاط")}</h3>
    <div className="meen-score-chips">
      {players.map(player => <div key={player.id}><b dir="auto">{player.name}</b><strong>{format(score(player))}</strong></div>)}
    </div>
  </div>;
}

export function ChoicePodium({ sorted, format = String, showScore = false }) {
  const lead = sorted.slice(0, 4);
  const podium = lead.length > 1 ? [lead[1], lead[0], ...lead.slice(2)] : lead;
  return <div data-design-id="podium" className="choice-podium">
    {podium.map(player => {
      const rank = sorted.findIndex(item => item.score === player.score) + 1;
      return <div key={player.id} data-rank={rank} className="choice-podium-player">
        <ChoicePortrait player={player} size={80} cutout />
        <span className="choice-podium-rank" aria-label={showScore ? undefined : `${tr("الترتيب")} ${format(rank)}`}>
          {format(showScore ? player.score : rank)}
        </span>
        <b dir="auto">{player.name}</b>
      </div>;
    })}
  </div>;
}

export function MeenFinal({ sorted, format = String }) {
  return <>
    <h2 className="meen-section-title">{tr("النتائج والألقاب")}</h2>
    <ChoicePodium sorted={sorted} format={format} />
    <div className="meen-titles">
      {sorted.map(player => <div key={player.id}>
        <ChoicePortrait player={player} size={48} />
        <b dir="auto">{player.name}</b>
        <strong className="badge">{format(player.score)}</strong>
        <span>{player.title || tr("بلا لقب هذه المرة")}</span>
      </div>)}
    </div>
  </>;
}
