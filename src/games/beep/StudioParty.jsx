import React from 'react';
import { Avatar } from '../../shared/brand/art.jsx';
import { tr } from '../../shared/i18n/core.js';
import { ProfileAvatar } from '../../profiles/ProfileAvatar.jsx';
import { PresentationStyles } from '../../shared/ui/PresentationStyles.jsx';
import css from './studio-party.css?sheet';
import trophy from './illustrations/trophy.webp';

export function PartyStyles() {
  return <PresentationStyles sheet={css} />;
}

export function PartyPortrait({ player, index }) {
  return player.profile && index === undefined
    ? <ProfileAvatar user={player.profile} size={96} />
    : <Avatar player={player} index={index} />;
}

export function PartyPodium({ entries, showPlaces = false, teamLabels = false, portraitIndex }) {
  const ranking = entry => Number.isFinite(entry.rankScore) ? entry.rankScore : entry.score;
  const sorted = [...entries].sort((first, second) => ranking(second) - ranking(first));
  const placeOf = entry => sorted.findIndex(candidate => ranking(candidate) === ranking(entry)) + 1;
  const podium = sorted.length >= 2 ? [sorted[1], sorted[0], ...sorted.slice(2, 3)] : sorted;
  const otherPlayers = sorted.slice(3);
  const tied = sorted.length >= 2 && ranking(sorted[0]) === ranking(sorted[1]);

  return (
    <div data-design-id="podium" className="party-podium" aria-label={tied ? tr("تعادل جميل!") : undefined}>
      <div className="party-trophy party-sparks"><img src={trophy} alt="" width="288" height="288" decoding="async" /></div>
      {tied && <p className="party-ribbon">{tr("تعادل جميل!")}</p>}
      <div className={`party-podium-stage ${showPlaces ? 'shows-places' : ''}`}>
        {podium.map(entry => (
          <article key={entry.id} className="party-podium-player" data-rank={placeOf(entry)}>
            <div className="party-podium-portrait"><PartyPortrait player={entry} index={portraitIndex?.(entry)} /></div>
            <div className="party-podium-step">
              {showPlaces && <b aria-label={`${tr("الترتيب")} ${placeOf(entry)}`}>{placeOf(entry)}</b>}
              {!showPlaces && <>{!teamLabels && <span dir="auto">{entry.name}</span>}<b>{entry.score}</b></>}
            </div>
            {showPlaces && <div className="party-podium-score"><span dir="auto">{entry.name}</span><b>{entry.score}</b></div>}
            {teamLabels && <span dir="auto" className="party-podium-name">{entry.name}</span>}
          </article>
        ))}
      </div>
      {otherPlayers.length > 0 && <div className="party-result-list">
        {otherPlayers.map(entry => (
          <div key={entry.id} className="party-result-row">
            <PartyPortrait player={entry} index={portraitIndex?.(entry)} />
            <strong dir="auto">{entry.name}</strong>
            <b>{entry.score}</b>
          </div>
        ))}
      </div>}
    </div>
  );
}
