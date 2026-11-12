import React, { useMemo, useState } from 'react';
import { useAccount } from '../shared/account/context.js';
import { useI18n } from '../shared/i18n/react.jsx';
import { Screen, IconButton } from '../shared/ui/components.jsx';
import { IconBack, IconRotate, IconUsers, IconClock, IconTrophy, IconPlay } from '../shared/ui/icons.jsx';
import { PresentationStyles } from '../shared/ui/PresentationStyles.jsx';
import { navigate } from '../platform/router.js';
import { CREATOR_COPY, GAME_LABELS, SCREEN_LABELS } from './copy.js';
import { otherEnvironmentUrl, reportingDay, TIMEZONE } from './analytics.js';
import { useCreatorAnalytics } from './useCreatorAnalytics.js';
import styles from './creator.css?sheet';

const PAGE_SIZE = 8;
const modeLabel = (mode, copy) => mode === 'online' ? copy.onlineMode : mode === 'local' ? copy.localMode : copy.none;

function Metric({ label, value, hint, icon, number, accent = false }) {
  return <article className={`creator-metric${accent ? ' creator-metric-primary' : ''}`}>
    <div className="creator-metric-heading"><span>{label}</span><span className="creator-metric-icon" aria-hidden="true">{icon}</span></div>
    <strong className="creator-value">{number(value)}</strong><p>{hint}</p>
  </article>;
}

function HistoryChart({ rows, kind, copy, locale, number }) {
  const max = Math.max(1, ...rows.filter(row => row.tracked).map(row => row.uniquePlayers));
  const tracked = rows.some(row => row.tracked);
  const labels = rows.map(row => kind === 'hourly' ? `${String(row.hour).padStart(2, '0')}:00` : new Intl.DateTimeFormat(locale === 'ar' ? 'ar-JO' : 'en-GB', { timeZone: TIMEZONE, month: 'short', day: 'numeric' }).format(new Date(`${row.day}T12:00:00+03:00`)));
  return <section className="creator-panel creator-history" data-design-id={`creator-${kind}`}>
    <header><h2>{copy[kind]}</h2><span className="creator-caption">{copy.unique}</span>{kind === 'daily' && rows.length > 0 && <span className="creator-caption"><bdi>{labels[0]} — {labels[labels.length - 1]}</bdi></span>}</header>
    {tracked ? <div className={`creator-chart creator-chart-${kind}`} dir="ltr" aria-hidden="true">
      <div className="creator-chart-axis"><span>{number(max, { notation: 'compact', maximumFractionDigits: 1 })}</span><span>{number(0)}</span></div>
      <div className="creator-chart-bars">{rows.map((row, index) => <div key={`${row.day}-${row.hour ?? 'day'}`} className={`creator-bar-column${row.tracked ? '' : ' is-untracked'}`} title={`${labels[index]} · ${row.tracked ? number(row.uniquePlayers) : copy.untracked}`}>
        <div className="creator-bar-track"><span className="creator-bar" style={{ height: row.tracked && row.uniquePlayers > 0 ? `${Math.max(2, row.uniquePlayers / max * 100)}%` : '0%' }} /></div>
        <span className="creator-chart-label">{kind === 'hourly' ? (index % 4 === 0 || index === rows.length - 1 ? number(row.hour) : '') : number(Number(row.day.slice(-2)))}</span>
      </div>)}</div>
    </div> : <p className="creator-empty">{copy.noHistory}</p>}
    <details className="creator-values"><summary>{copy.values}</summary><div className="creator-data-table-wrap"><table>
      <thead><tr><th scope="col">{kind === 'hourly' ? copy.hour : copy.day}</th><th scope="col">{copy.unique}</th><th scope="col">{copy.peakShort}</th></tr></thead>
      <tbody>{rows.map((row, index) => <tr key={`${row.day}-${row.hour ?? 'day'}`}><th scope="row"><bdi>{labels[index]}</bdi></th>{row.tracked ? <><td>{number(row.uniquePlayers)}</td><td>{number(row.peakOnline)}</td></> : <td colSpan="2">{copy.untracked}</td>}</tr>)}</tbody>
    </table></div></details>
  </section>;
}

function GameActivity({ data, copy, locale, number }) {
  const [page, setPage] = useState(0);
  const rows = [...data.byGame].sort((a, b) => b.count - a.count || a.game.localeCompare(b.game) || a.mode.localeCompare(b.mode));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const displayed = rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  return <section className="creator-panel" data-design-id="creator-game-activity"><header><h2>{copy.gameActivity}</h2><p>{copy.gameHint}</p></header>
    {rows.length ? <div className="creator-game-table" role="table" aria-label={copy.gameActivity}>
      <div className="creator-game-head" role="row"><span role="columnheader">{copy.game} / {copy.mode}</span><span role="columnheader">{copy.players}</span><span role="columnheader">{copy.share}</span></div>
      {displayed.map(row => <div className="creator-game-row" role="row" key={`${row.game}-${row.mode}`}><div role="rowheader"><strong>{GAME_LABELS[locale][row.game]}</strong><span>{modeLabel(row.mode, copy)}</span></div><strong role="cell">{number(row.count)}</strong><span role="cell">{number(data.summary.onlinePlayers > 0 ? row.count / data.summary.onlinePlayers : 0, { style: 'percent', maximumFractionDigits: 0 })}</span></div>)}
    </div> : <p className="creator-empty">{copy.noGames}</p>}
    {pages > 1 && <nav className="creator-pagination" aria-label={copy.gameActivity}><button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>{copy.previous}</button><span>{copy.page} {number(current + 1)} {copy.of} {number(pages)}</span><button type="button" disabled={current + 1 === pages} onClick={() => setPage(current + 1)}>{copy.next}</button></nav>}
  </section>;
}

export function CreatorDashboard({ onBack, fetchAnalytics }) {
  const account = useAccount();
  const { locale: activeLocale, dir, number } = useI18n();
  const locale = activeLocale === 'en' ? 'en' : 'ar';
  const copy = CREATOR_COPY[locale];
  const enabled = account.ready && account.me?.creator?.enabled === true;
  const { data, error, accessError, loading, stale, hidden, refresh } = useCreatorAnalytics({ enabled, owner: account.user?.id ?? account.me?.user?.id ?? null, request: fetchAnalytics || account.requestAuthenticated });
  const day = data ? reportingDay(data.updatedAt) : null;
  const hourly = useMemo(() => data ? data.hourly.filter(row => row.day === day).sort((a, b) => a.hour - b.hour) : [], [data, day]);
  const daily = useMemo(() => data ? [...data.daily].sort((a, b) => a.day.localeCompare(b.day)) : [], [data]);
  const formatDate = value => new Intl.DateTimeFormat(locale === 'ar' ? 'ar-JO' : 'en-GB', { timeZone: TIMEZONE, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value));
  const environment = data?.environment.id;
  const environmentLink = otherEnvironmentUrl(environment);
  const navigateBack = onBack || (() => navigate('/settings'));
  return <Screen className="creator-dashboard" data-design-screen="platform.creator"><PresentationStyles sheet={styles} /><div dir={dir} className="creator-content">
    <header className="creator-heading"><IconButton label={copy.back} onClick={navigateBack} data-design-id="creator-back"><IconBack /></IconButton><div><h1>{copy.title}</h1><p>{copy.intro}</p></div></header>
    {!account.ready ? <p className="creator-message" role="status">{copy.loading}</p> : !enabled ? <p className="creator-message" role="status">{copy.restricted}</p> : <>
      <div className="creator-refresh-row"><div className="creator-status" role="status"><span className={`creator-status-badge${stale || error ? ' is-stale' : ''}`}>{loading ? copy.refreshing : stale || error ? copy.stale : data ? copy.live : copy.loading}</span><span>{hidden ? copy.paused : copy.polling}</span></div><button type="button" className="creator-refresh" data-design-id="creator-refresh" onClick={refresh} disabled={loading || accessError} aria-busy={loading || undefined}><IconRotate />{copy.refresh}</button></div>
      {error && <p className="creator-message creator-error" role="alert">{accessError ? copy.authError : copy.error}</p>}
      {!data && loading && <p className="creator-message" role="status">{copy.loading}</p>}
      {data && <>
        <section className="creator-environment" data-design-id="creator-environment"><div><span className="creator-caption">{copy.source}</span><strong>{copy[environment] || copy.unknown}</strong><p>{copy.signInNotice}</p></div>{environmentLink && <a href={environmentLink} target="_blank" rel="noopener noreferrer">{copy.otherEnvironment}</a>}</section>
        <div className="creator-updated"><span>{copy.updated}: <time dateTime={data.updatedAt}>{formatDate(data.updatedAt)}</time></span><span>{copy.timezone}: <bdi>{TIMEZONE}</bdi></span></div>
        {data.collection.status !== 'collecting' && <p className="creator-message" role="status">{data.collection.status === 'not-started' ? copy.notStarted : copy.limited}</p>}
        <div className="creator-metrics" data-design-id="creator-metrics">
          <Metric label={copy.online} value={data.summary.onlinePlayers} hint={copy.onlineHint} icon={<IconUsers />} number={number} accent />
          <Metric label={copy.today} value={data.summary.todayPlayers} hint={copy.todayHint} icon={<IconClock />} number={number} />
          <Metric label={copy.peak} value={data.summary.todayPeakOnline} hint={copy.peakHint} icon={<IconTrophy />} number={number} />
          <Metric label={copy.games} value={data.summary.activeGames} hint={copy.gamesHint} icon={<IconPlay />} number={number} />
        </div>
        <div className="creator-registration"><div><span>{copy.registered}</span><strong>{number(data.summary.registeredAccountsTotal)}</strong></div><div><span>{copy.registeredToday}</span><strong>{number(data.summary.registeredAccountsToday)}</strong></div><p>{copy.registeredHint}</p></div>
        <div className="creator-charts"><HistoryChart rows={hourly} kind="hourly" copy={copy} locale={locale} number={number} /><HistoryChart rows={daily} kind="daily" copy={copy} locale={locale} number={number} /></div>
        <p className="creator-note">{copy.partial}</p>
        <div className="creator-details-grid"><GameActivity data={data} copy={copy} locale={locale} number={number} />
          <section className="creator-panel" data-design-id="creator-screen-activity"><header><h2>{copy.screens}</h2><p>{copy.screenHint}</p></header>{data.byScreen.length ? <ul className="creator-screen-list">{[...data.byScreen].sort((a, b) => b.count - a.count).map(row => <li key={row.screen}><span>{SCREEN_LABELS[locale][row.screen]}</span><strong>{number(row.count)}</strong></li>)}</ul> : <p className="creator-empty">{copy.empty}</p>}
            {data.byMode.length > 0 && <div className="creator-mode-summary">{data.byMode.map(row => <span key={row.mode}>{modeLabel(row.mode, copy)} <b>{number(row.count)}</b></span>)}</div>}
          </section>
        </div>
        <footer className="creator-footnote"><p><strong>{copy.started}: </strong>{data.metricsStartedAt ? <time dateTime={data.metricsStartedAt}>{formatDate(data.metricsStartedAt)}</time> : copy.notStarted}</p><p>{copy.privacy}</p><p>{copy.method}</p></footer>
      </>}
    </>}
  </div></Screen>;
}
