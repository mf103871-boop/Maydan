import { tr, numberForLocale, getUiLocale, localeDirection } from '../../shared/i18n/core.js';
import React, { useId, useState } from 'react';
import { PresentationStyles } from '../../shared/ui/PresentationStyles.jsx';
import stylesheet from './progression.css?sheet';

const ROOT = './assets/progression/v1/';
const digits = new Intl.NumberFormat('ar', { useGrouping: false, numberingSystem: 'arab' });
const stateNames = { equipped: 'مجهّز', owned: 'مملوك', locked: 'مقفل', preview: 'للمعاينة' };
const typeNames = { frame: 'إطارات', collectible: 'مقتنيات', badge: 'أوسمة' };
const integer = value => Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
export const progressionNumber = value => numberForLocale(integer(value), getUiLocale(), { useGrouping:false });
export const progressionArt = key => typeof key === 'string' && /^[a-z0-9-]+$/.test(key) ? ROOT + key + '.webp' : undefined;
export const progressionFrameArt = id => {
  const level = typeof id === 'string' ? /^progression\.frame\.(1|10|20|30|40|50|60)$/.exec(id)?.[1] : null;
  return progressionArt(level ? 'frame-' + level : null);
};
const masteryArtwork = { badeeha: 'mastery-badeeha', mafia: 'mastery-mafia' };
const masteryNames = { badeeha: 'بديهة', mafia: 'مافيا', ersomha: 'ارسمها', meenfina: 'مين فينا؟', fabraka: 'فبركة', beep: 'قبل ما يطق!', mamnoo: 'ممنوع!', jabeen: 'على جبينك' };
const levelText = level => tr("المستوى ") + progressionNumber(level);
export const progressionRewardRequirement = reward => reward?.level === 1 ? tr("بعد أول مشاركة مؤهلة") : tr("عند الوصول إلى ") + levelText(reward?.level);

export function ProgressionStyles() { return <PresentationStyles sheet={stylesheet} />; }

export function ProgressionArt({ src, className = '', width, height, reportError = false, eager = false }) {
  const [unavailable, setUnavailable] = useState(null);
  if (!src || unavailable === src) return reportError && src ? <span className={className + ' pc-art-missing'}>{tr("تعذّر عرض الرسم")}</span> : null;
  return <img className={className} src={src} width={width} height={height} alt="" decoding="async" loading={eager ? 'eager' : 'lazy'} draggable={false} onError={() => setUnavailable(src)} />;
}

function ProfileAction({ onClick, className, children, label }) {
  return onClick
    ? <button className={className} type="button" aria-label={label} onClick={event => { event.currentTarget.focus({ preventScroll: true }); onClick(event); }}>{children}</button>
    : <div className={className}>{children}</div>;
}

export function ProgressionPortrait({ portraitSrc, portrait, layeredPortrait, frameId, frameSrc, heroSrc, level, name, className = '', onCatalog }) {
  const frame = frameSrc || progressionFrameArt(frameId);
  const label = name ? tr("صورة ") + name : tr("الصورة الشخصية");
  return <ProfileAction className={'pc-portrait ' + className + (heroSrc ? ' pc-portrait-reference' : '')} label={label + tr("، فتح خزانة المقتنيات")} onClick={onCatalog}>
    {heroSrc ? <ProgressionArt className="pc-reference-art" src={heroSrc} width={285} height={282} reportError eager /> : <>{layeredPortrait ? <span className="pc-layered-portrait">{layeredPortrait}</span> : <span className={'pc-portrait-hole' + (frame ? ' is-framed' : '')}>
      {portrait || (portraitSrc
        ? <ProgressionArt className="pc-portrait-photo" src={portraitSrc} width={256} height={256} reportError eager />
        : <span className="pc-avatar-initial" aria-hidden="true">{String(name || 'م').trim().slice(0, 1) || 'م'}</span>)}
    </span>}
    {frame && <ProgressionArt className="pc-portrait-frame" src={frame} width={320} height={320} reportError eager />}</>}
    {Number.isFinite(level) && level > 0 && <span className="pc-level" aria-label={levelText(level)}>
      {!heroSrc && <ProgressionArt className="pc-medallion-art" src={progressionArt('profile-medallion')} width={99} height={93} eager />}
      <span aria-hidden="true">{progressionNumber(level)}</span>
    </span>}
  </ProfileAction>;
}

export function ProgressionMeter({ value, max, label, className = '' }) {
  const limit = Math.max(1, integer(max));
  const progress = Math.min(limit, integer(value));
  return <div className={'pc-meter ' + className} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={limit}
    aria-valuenow={progress} aria-valuetext={progressionNumber(progress) + ' ' + tr('من') + ' ' + progressionNumber(limit)} dir="ltr">
    <span style={{ width: (progress / limit * 100) + '%' }} />
  </div>;
}

function SectionTitle({ id, children }) {
  return <h3 id={id} className="pc-section-title"><span>{children}</span></h3>;
}

function Chevron() {
  return <span aria-hidden="true" className="pc-chevron" />;
}

export function ProgressionProfile({
  name, bio, title, portraitSrc, portrait, layeredPortrait, coverSrc, cover, level, xpIntoLevel, xpForNextLevel,
  achievements = [], mastery = [], nextReward, frameId, frameSrc, heroSrc, owner = true, status = 'ready',
  onCatalog, onAchievement, onMastery, onReward, onCustomize, onRetry, reference = false,
}) {
  const id = useId();
  const showXp = owner && Number.isFinite(xpIntoLevel) && Number.isFinite(xpForNextLevel) && xpForNextLevel > 0;
  const displayName = name?.trim() || tr("لاعب ميدان");
  const brandArt = coverSrc || progressionArt('profile-header');
  const rewardId = nextReward?.itemId || nextReward?.id;
  return <section className={'pc-profile' + (reference ? ' pc-reference-profile' : '')} dir={localeDirection(getUiLocale())} aria-label={tr("بروفايل ") + displayName}>
    <div className="pc-profile-masthead">
      {cover || <ProgressionArt className="pc-masthead-art" src={brandArt} width={554} height={116} eager />}
      <span className="pc-wordmark">{tr("ميدان")}</span>
    </div>
    {status === 'loading' ? <div className="pc-profile-body pc-state" role="status" aria-busy="true"><div className="pc-loading-art" aria-hidden="true" /><p>{tr("جارٍ تحميل البروفايل…")}</p></div>
      : status === 'error' ? <div className="pc-profile-body pc-state" role="alert"><p>{tr("تعذّر تحميل البروفايل.")}</p>{onRetry && <button type="button" className="pc-control" onClick={onRetry}>{tr("حاول مجددًا")}</button>}</div>
      : <div className="pc-profile-body">
        <div className="pc-identity">
          <div className="pc-identity-copy">
            <h2><bdi>{displayName}</bdi></h2>
            {title && <ProfileAction className="pc-title-plaque" onClick={owner ? onCustomize : null} label={tr("اللقب الحالي: ") + title + tr("، اختر لقبًا")}><span>{title}</span></ProfileAction>}
            {bio && <p className="pc-bio" dir="auto">{bio}</p>}
          </div>
          <ProgressionPortrait portraitSrc={portraitSrc} portrait={portrait} layeredPortrait={layeredPortrait} frameId={frameId} frameSrc={frameSrc} heroSrc={heroSrc}
            level={level} name={displayName} onCatalog={owner ? onCatalog : null} />
        </div>
        {showXp && <div className="pc-xp">
          <div className="pc-xp-label"><bdi>{progressionNumber(xpIntoLevel)} {tr('من')} {progressionNumber(xpForNextLevel)}</bdi><strong>{tr("نقاط الخبرة")}</strong></div>
          <ProgressionMeter value={xpIntoLevel} max={xpForNextLevel} label={tr("نقاط الخبرة")} />
        </div>}
        {(achievements.length > 0 || owner) && <section className="pc-achievements" aria-labelledby={id + 'achievements'}>
          <SectionTitle id={id + 'achievements'}>{owner ? tr("إنجازاتي") : tr("الإنجازات")}</SectionTitle>
          {achievements.length > 0 ? <div className="pc-achievement-list">{achievements.slice(0, 3).map(achievement =>
            <ProfileAction key={achievement.id} className="pc-achievement" onClick={onAchievement ? () => onAchievement(achievement) : null}>
              {achievement.artNode || <ProgressionArt className="pc-achievement-art" src={achievement.artSrc || progressionArt(achievement.art)} width={134} height={107} reportError />}
              <strong>{tr(achievement.label)}</strong>
              {achievement.detail && <span className="pc-detail">{tr(achievement.detail)}</span>}
            </ProfileAction>
          )}</div> : <p className="pc-empty">{tr("تظهر هنا شارات الإنجازات التي تختارها من تخصيص البروفايل.")}</p>}
        </section>}
        {owner && nextReward && Number.isFinite(nextReward.level) && <ProfileAction className="pc-reward" label={tr("معاينة ") + (tr(nextReward.label || nextReward.title || "المكافأة التالية"))}
          onClick={onReward ? () => onReward(nextReward) : null}>
          <Chevron />
          <span className="pc-reward-copy">
            <strong>{tr(nextReward.label || nextReward.title || "الإطار التالي")}</strong>
            <span className="pc-detail">{progressionRewardRequirement(nextReward)}</span>
            <span className="pc-reward-stages" aria-hidden="true" dir="ltr">
              {Array.from({ length: 5 }, (_, n) => <i key={n} className={n < Math.min(4, Math.floor(integer(level) / nextReward.level * 4)) ? 'is-reached' : ''} />)}
            </span>
          </span>
          <ProgressionArt className="pc-reward-art" src={nextReward.artSrc || progressionFrameArt(rewardId)} width={150} height={126} reportError />
        </ProfileAction>}
        {owner && mastery.length > 0 && <section className="pc-mastery" aria-labelledby={id + 'mastery'}>
          <SectionTitle id={id + 'mastery'}>{tr("إتقان الألعاب")}</SectionTitle>
          <div className="pc-mastery-list">{mastery.map(track => {
            const label = tr(track.label || masteryNames[track.game] || track.game);
            const max = Math.max(1, integer(track.maxGrade || 10));
            const grade = Math.min(max, integer(track.grade));
            return <ProfileAction key={track.game} className={'pc-track' + (track.game === 'mafia' ? ' is-mafia' : '')}
              onClick={onMastery ? () => onMastery(track) : null}>
              <Chevron />
              <span className="pc-track-copy"><strong>{label}</strong><span className="pc-detail">{tr("الإتقان ")}{progressionNumber(grade)} {tr('من')} {progressionNumber(max)}</span>
                <ProgressionMeter value={grade} max={max} label={tr("إتقان ") + label} />
              </span>
              {track.artNode || <ProgressionArt className="pc-track-art" src={track.artSrc || progressionArt(masteryArtwork[track.game])} width={92} height={92} reportError />}
            </ProfileAction>;
          })}</div>
        </section>}
      </div>}
  </section>;
}

function ItemArtwork({ item, portraitSrc, portrait }) {
  if (item.previewSrc) return <ProgressionArt src={item.previewSrc} className="pc-catalog-art" width={220} height={188} reportError />;
  const artSrc = item.artSrc || progressionFrameArt(item.id);
  if (item.type === 'frame' && (portraitSrc || portrait)) return <ProgressionPortrait className="pc-catalog-art" portraitSrc={portraitSrc} portrait={portrait} frameSrc={artSrc} />;
  return <ProgressionArt src={artSrc} className="pc-catalog-art" width={220} height={188} reportError />;
}

export function ProgressionCatalog({ items = [], portraitSrc, portrait, onSelect, board = false, filters = true }) {
  const [type, setType] = useState('');
  const [state, setState] = useState('');
  const visible = items.filter(item => (!type || item.type === type)
    && (!state || item.state === state || (state === 'owned' && item.state === 'equipped')));
  return <section className={'pc-catalog' + (board ? ' pc-catalog-board' : '')} dir={localeDirection(getUiLocale())} aria-label={tr("خزانة المقتنيات")}>
    {filters && <div className="pc-filters">
      <label>{tr("النوع")}<select value={type} onChange={event => setType(event.target.value)}><option value="">{tr("كل الأنواع")}</option>{Object.entries(typeNames).map(([id, label]) => <option key={id} value={id}>{tr(label)}</option>)}</select></label>
      <label>{tr("الملكية")}<select value={state} onChange={event => setState(event.target.value)}><option value="">{tr("كل الحالات")}</option>{Object.entries(stateNames).map(([id, label]) => <option key={id} value={id}>{tr(label)}</option>)}</select></label>
    </div>}
    {visible.length ? <div className="pc-catalog-grid">{visible.map(item =>
      <ProfileAction key={item.id} className="pc-catalog-item" onClick={onSelect ? () => onSelect(item) : null}
        label={[item.level ? levelText(item.level) : '', item.title || item.label, stateNames[item.state]].filter(Boolean).join('، ')}>
        <ItemArtwork item={item} portraitSrc={portraitSrc} portrait={portrait} />
        {item.level && <strong>{levelText(item.level)}</strong>}
        <span>{tr(item.title || item.label)}</span>
        {item.state && <small className={board ? 'pc-visually-hidden' : 'pc-catalog-state'}>{tr(stateNames[item.state])}</small>}
      </ProfileAction>)}</div> : <p className="pc-empty">{tr("لا توجد مقتنيات بهذا الاختيار.")}</p>}
  </section>;
}

export function ProgressionMatchSummary({ xpEarned, nextReward, onOpen }) {
  if (!Number.isFinite(xpEarned) || xpEarned < 0) return null;
  return <aside className="pc-match-summary" dir={localeDirection(getUiLocale())} aria-label={tr("تقدّم المباراة")}>
    <strong>{xpEarned > 0 ? tr("أضفت ") + progressionNumber(xpEarned) + tr(" نقطة خبرة") : tr("لم تُمنح نقاط خبرة في هذه المباراة")}</strong>
    {nextReward && <span>{tr(nextReward.label || nextReward.title || "المكافأة التالية")} {progressionRewardRequirement(nextReward)}</span>}
    {onOpen && <button type="button" className="pc-control" onClick={onOpen}>{tr("عرض تقدّمي")}</button>}
  </aside>;
}
