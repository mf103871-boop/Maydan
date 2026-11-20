/** @jsxRuntime classic */
/** @jsx React.createElement */
import React from '../../design/react.js';
import { createPortal } from 'react-dom';
import { tr, getUiLocale } from '../../shared/i18n/core.js';
import { ProfileAvatar } from '../../profiles/ProfileAvatar.jsx';
import { getPlayfulSceneArt } from '../../shared/brand/playful-scenes.js';
import { IconStar, IconSettings, IconUsers, IconBook, IconHome, IconFlask, IconBack } from '../../shared/ui/icons.jsx';
import { CategoryCover } from './Cover.jsx';
import { ScorePoints } from './parts.js';
import { GameFrameFooterContext } from '../../platform/context.js';

// These are decorative team illustrations, never player accounts or saved avatars.
// Stable team identity is independent of the name entered or the current rank.
export function StudioTeamPortrait({ index = 0, size = 76 }) {
  return <ProfileAvatar user={{ avatarPreset: ['human-01', 'human-02', 'human-03', 'human-04'][index % 4] }} size={size} presentation="cutout" />;
}

export function StudioHeading({ title, leading, trailing, controlsInFooter = false }) {
  const setControlsInFooter = React.useContext(GameFrameFooterContext);
  React.useLayoutEffect(() => {
    if (!controlsInFooter || !setControlsInFooter) return;
    setControlsInFooter(true);
    return () => setControlsInFooter(false);
  }, [controlsInFooter, setControlsInFooter]);
  const ref = React.useRef(null), marker = React.useRef(null);
  const [largeText, setLargeText] = React.useState(false);
  const [shell, setShell] = React.useState(null);
  React.useLayoutEffect(() => {
    setShell(marker.current?.closest('.game-frame')?.querySelector('.bl-shell-heading') || null);
  }, []);
  React.useLayoutEffect(() => {
    const heading = ref.current;
    if (!heading) return undefined;
    const label = heading.firstElementChild || heading;
    const measure = () => setLargeText(parseFloat(getComputedStyle(label).fontSize) > (shell ? 29 : 40));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(heading);
    if (label !== heading) observer.observe(label);
    return () => observer.disconnect();
  }, [shell]);
  const heading = <header data-design-id="header" className={'bl-heading' + (largeText ? ' is-large-text' : '')}>
    <div className="bl-heading-action">{leading}</div>
    <h1 ref={ref} data-design-id="title"><span>{title}</span></h1>
    <div className="bl-heading-action">{trailing}</div>
  </header>;
  return <><span hidden ref={marker} className={shell && largeText ? 'bl-heading is-large-text' : undefined}/>{shell ? createPortal(heading, shell) : heading}</>;
}

export function StudioTeamScores({ teams, turn, bumpId, undoFx, deltaFx, previous, detailed = false }) {
  return <div className="bl-scores" aria-label={tr('النتائج')}>
    {teams.map((team, index) => <div key={team.id} data-design-id="score-cards" className={'bl-score' + (index === turn ? ' is-turn' : '') + (bumpId === team.id ? ' is-bumped' : '') + (undoFx ? ' is-undone' : '')}>
      <StudioTeamPortrait index={index} size={92} />
      <div className="bl-score-copy"><bdi>{team.name}</bdi><ScorePoints value={team.score} from={previous?.get(team.id)} />
        {detailed && <small>{tr('إجابات {v0} · سرقات {v1}', { v0: team.correct, v1: team.steals })}</small>}
      </div>
      {deltaFx?.id === team.id && <span key={deltaFx.key} className={'m-delta' + (deltaFx.value < 0 ? ' is-neg' : '')} aria-hidden="true" dir="ltr">{deltaFx.value > 0 ? '+' : ''}{deltaFx.value}</span>}
    </div>)}
  </div>;
}

// A category outside the current artwork catalog can still use its legacy cover.
export function StudioCategoryArt({ category, compact = false }) {
  const size = compact ? 40 : 80;
  const art = getPlayfulSceneArt(`category-${category.id}`, size);
  return <span className={'bl-category-art' + (compact ? ' is-compact' : '')} data-category-art={category.id}>
    {art ? <img src={art} width={size} height={size} alt="" loading={compact ? undefined : 'lazy'} decoding="async" /> : <CategoryCover id={category.id} icon={null} />}
  </span>;
}

export function StudioModeArt({ mode }) {
  const art = getPlayfulSceneArt(mode === 'standard' ? 'badeeha-trophy' : `mode-${mode}`, 64);
  return art ? <img className="bl-mode-art" src={art} width="64" height="64" alt="" />
    : <span className="bl-mode-art is-pending" data-art-pending={mode}>{mode === 'family' ? <IconHome /> : <IconBook />}</span>;
}

export function StudioToolArt({ id }) {
  return id === 'double' ? <span className="bl-double" aria-hidden="true">×2</span>
    : <span className={'bl-tool-art' + (id === 'time' ? ' is-time' : '')}><img src={getPlayfulSceneArt(id === 'two' ? 'badeeha-cards' : 'badeeha-time', 76)} width="76" height="76" alt="" /></span>;
}

export function StudioPodium({ teams, title }) {
  const ranked = teams.map((team, originalIndex) => ({ ...team, originalIndex })).sort((a,b) => b.score-a.score);
  return <div className="bl-result-identity">
    <div className="bl-trophy" aria-hidden="true"><svg className="bl-trophy-rays" viewBox="0 0 180 90"><path d="m20 26 7 6m-14 13 9 2m137-21-7 6m14 13-9 2" /></svg><img src={getPlayfulSceneArt('badeeha-trophy', 144)} width="144" height="96" alt="" /></div>
    <h1 data-design-id="title">{title}</h1>
    <div className="bl-podium">{ranked.map((team, index) => {
      const rank = ranked.findIndex(other => other.score === team.score) + 1;
      return <div key={team.id} className={'bl-podium-place' + (rank === 1 ? ' is-winner' : '')} style={{ '--rank': index }}>
        <svg className={'bl-character-rays' + (index % 2 ? ' is-trailing' : '')} viewBox="0 0 30 45" aria-hidden="true"><path d="m7 22 10 5m-2-18 7 11m4-15 2 11" /></svg>
        <StudioTeamPortrait index={team.originalIndex} size={160} />
        <div className="bl-podium-base"><span className="bl-rank">{rank.toLocaleString(getUiLocale())}</span><bdi>{team.name}</bdi><div className="bl-podium-points">{rank === 1 && <StudioLaurel />}<strong>{team.score.toLocaleString(getUiLocale())}</strong>{rank === 1 && <StudioLaurel trailing />}</div></div>
      </div>;
    })}</div>
  </div>;
}

function StudioLaurel({ trailing = false }) {
  return <svg className={'bl-laurel' + (trailing ? ' is-trailing' : '')} viewBox="0 0 28 48" aria-hidden="true"><path className="bl-laurel-stem" d="M24 45C7 35 7 18 12 4" /><path d="M12 13C5 10 7 3 12 0C16 6 14 10 12 13ZM10 22C3 21 0 15 2 11C8 13 11 17 10 22ZM12 31C5 32 1 27 1 23C8 23 12 27 12 31ZM17 40C9 43 5 39 4 35C11 33 16 36 17 40ZM10 23C10 15 15 12 20 13C19 19 15 22 10 23ZM13 33C12 26 17 23 22 24C21 30 17 33 13 33ZM20 43C17 36 22 32 27 33C28 38 24 42 20 43Z" /></svg>;
}

export { IconStar, IconSettings, IconUsers, IconFlask, IconBack };
