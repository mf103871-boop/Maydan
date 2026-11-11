import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Modal } from '../../src/shared/ui/components.jsx';
import {
  ProgressionArt, ProgressionCatalog, ProgressionPortrait, ProgressionProfile, ProgressionStyles,
  progressionArt, progressionFrameArt, progressionNumber,
} from '../../src/profiles/progression/ProgressionProfile.jsx';
import {
  ACHIEVEMENTS, BOARD_FRAMES, EARNED_TITLES, EQUIPPED_REFERENCE, FENNEC, INVENTORY, NEXT_REWARD, PREVIEW_ART,
  REFERENCE_FRAME, REFERENCE_HERO, REFERENCE_PLAYER, SHOWCASE_OBJECTS, TRACKS, equipFixture, loadFixture,
  moveFixtureBadge, newFixtureState, saveFixture, titleFixture, toggleFixtureBadge,
} from './fixture-data.js';
import ui from '../../src/shared/ui/ui.css';
import tokens from '../../src/shared/theme/tokens.css';
import showcaseStyles from './showcase.css';

const routes = new URLSearchParams(window.location.search);
const initialView = routes.get('view') === 'phone' ? 'phone' : 'board';
const cases = { normal: 'المرجع', loading: 'جارٍ التحميل', error: 'تعذّر البروفايل', missing: 'تعذّر أصل فني',
  empty: 'دون إنجازات', long: 'اسم ونبذة طويلان' };
const typeFilters = [['', 'كل الأنواع'], ['frame', 'إطارات'], ['collectible', 'مقتنيات'], ['badge', 'أوسمة']];
const stateFilters = [['', 'كل الحالات'], ['owned', 'مملوك'], ['equipped', 'مجهّز'], ['locked', 'مقفل'], ['preview', 'للمعاينة']];
const states = Object.fromEntries(stateFilters.slice(1));
const labelForPanel = panel => ({
  catalog: 'خزانة المقتنيات', item: panel.item?.title, achievement: panel.achievement?.label,
  mastery: 'مسار ' + (panel.track?.label || ''), customize: 'تخصيص البروفايل',
})[panel.kind];

function safeStorage() {
  try { return window.localStorage; } catch { return null; }
}

function Control({ children, primary = false, onClick, ...props }) {
  return <button type="button" {...props} onClick={onClick ? event => { event.currentTarget.focus({ preventScroll: true }); onClick(event); } : undefined} className={'pc-control' + (primary ? ' is-primary' : '')}>{children}</button>;
}

function PreviewBoard({ children, frames, onItem }) {
  return <main className="pc-preview-board" data-visual-stage="board">
    <div className="pc-board-scene" aria-hidden="true">
      <ProgressionArt className="pc-board-scene-left" src={PREVIEW_ART + 'board-left.webp'} width={115} height={1024} eager />
      <ProgressionArt className="pc-board-scene-right" src={PREVIEW_ART + 'board-right.webp'} width={59} height={1024} eager />
    </div>
    <section className="pc-board-gallery" dir="rtl" aria-label="مقتنيات الرحلة">
      <p className="pc-board-caption"><span>تصوّر مقترح</span></p>
      <header className="pc-preview-heading">
        <h1><span>رحلتك</span> تصنع اسمك</h1>
        <div className="pc-board-rule" aria-hidden="true"><i /></div>
        <p>مقتنيات تعبر عن رحلتك في ميدان</p>
      </header>
      <ProgressionCatalog board filters={false} items={frames} onSelect={onItem} />
      <div className="pc-board-objects">
        {SHOWCASE_OBJECTS.map(item => <button type="button" className={'pc-board-object ' + item.id} key={item.id} onClick={() => onItem(item)}>
          <ProgressionArt className="pc-board-object-art" src={progressionArt(item.art)} width={320} height={240} reportError />
          <strong>{item.title}</strong><span>{item.detail}</span>
        </button>)}
      </div>
      <p className="pc-board-footer">المستوى <span>•</span> الإتقان <span>•</span> الإنجازات</p>
    </section>
    <div className="pc-board-profile">{children}</div>
  </main>;
}

function PreviewApp() {
  const [view, setView] = useState(initialView);
  const [state, setState] = useState(() => loadFixture(safeStorage()));
  const [example, setExample] = useState(Object.hasOwn(cases, routes.get('state')) ? routes.get('state') : 'normal');
  const [panels, setPanels] = useState([]);
  const [filters, setFilters] = useState({ type: '', state: '' });
  const [notice, setNotice] = useState('');
  const panel = panels.at(-1);
  const activePanelHeading = useRef(null);
  useEffect(() => saveFixture(safeStorage(), state), [state]);
  useEffect(() => { if (panels.length > 1) activePanelHeading.current?.focus({ preventScroll: true }); }, [panels]);

  const push = next => setPanels(current => [...current, next]);
  const back = () => setPanels(current => current.slice(0, -1));
  const showItem = item => push({ kind: 'item', item });
  const showCatalog = () => push({ kind: 'catalog' });
  const showCustomize = () => push({ kind: 'customize' });
  const updateItem = item => ({ ...item, state: item.id === state.frame ? 'equipped' : item.state === 'equipped' ? 'owned' : item.state });
  const getBadge = id => ACHIEVEMENTS.find(badge => badge.id === id);
  const selectedBadges = state.badges.map(getBadge).filter(Boolean);
  const examplePlayer = example === 'long' ? { ...REFERENCE_PLAYER, name: 'ليان عبد الرحمن من بيت الميدان',
    bio: 'هنا نحب اللمة الطويلة والقصص التي تجمع الأصدقاء واللاعبين والعائلة في أمسية لا تُنسى.' } : REFERENCE_PLAYER;
  const isReferenceFrame = state.frame === REFERENCE_FRAME && example !== 'missing';
  const art = example === 'missing' ? PREVIEW_ART + 'missing-sample.webp' : FENNEC;
  const filtered = INVENTORY.map(updateItem).filter(item => (!filters.type || item.type === filters.type)
    && (!filters.state || filters.state === item.state || (filters.state === 'owned' && item.state === 'equipped')));
  const reset = () => {
    setState(newFixtureState()); setExample('normal'); setPanels([]); setFilters({ type: '', state: '' });
    setNotice('أُعيدت بيانات المقارنة إلى المرجع.');
  };
  const profile = <ProgressionProfile {...examplePlayer} title={state.title} reference
    portraitSrc={art} frameId={state.frame} heroSrc={isReferenceFrame ? REFERENCE_HERO : undefined}
    status={example === 'loading' ? 'loading' : example === 'error' ? 'error' : 'ready'}
    achievements={example === 'empty' ? [] : selectedBadges} mastery={TRACKS} nextReward={NEXT_REWARD}
    onRetry={() => setExample('normal')} onCatalog={showCatalog} onCustomize={showCustomize}
    onReward={showItem} onAchievement={achievement => push({ kind: 'achievement', achievement })}
    onMastery={track => push({ kind: 'mastery', track })} />;

  let panelContent = null;
  if (panel?.kind === 'catalog') {
    panelContent = <>
      <div className="pc-filters">
        <label>النوع<select aria-label="نوع المقتنيات" value={filters.type} onChange={event => setFilters({ ...filters, type: event.target.value })}>{typeFilters.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>الملكية<select aria-label="حالة الملكية" value={filters.state} onChange={event => setFilters({ ...filters, state: event.target.value })}>{stateFilters.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      </div>
      {state.previousFrame && <Control onClick={() => setState(previous => equipFixture(previous, previous.previousFrame))}>إعادة الإطار السابق</Control>}
      <ProgressionCatalog items={filtered.map(item => ({ ...item, artSrc: progressionArt(item.art) }))} portraitSrc={FENNEC} onSelect={showItem} filters={false} />
    </>;
  } else if (panel?.kind === 'item') {
    const item = updateItem(panel.item);
    const canEquip = item.type === 'frame' && item.state === 'owned';
    const detailArt = progressionArt(item.art) || progressionFrameArt(item.id);
    panelContent = <>
      {item.type === 'frame' && item.state !== 'preview' ? <ProgressionPortrait
        portraitSrc={FENNEC} frameId={item.id} heroSrc={item.id === EQUIPPED_REFERENCE.id ? REFERENCE_HERO : undefined} className="pc-item-detail-art" />
        : <ProgressionArt className="pc-item-detail-art" src={detailArt} width={220} height={220} reportError />}
      <dl><dt>المصدر</dt><dd>{item.source}</dd><dt>الحالة</dt><dd>{states[item.state]}</dd>
        {item.level && <><dt>طريقة الحصول</dt><dd>عند الوصول إلى المستوى {progressionNumber(item.level)}</dd></>}</dl>
      {item.detail && <p>{item.detail}</p>}
      {canEquip && <Control primary onClick={() => { setState(previous => equipFixture(previous, item.id)); setNotice('جُهّز ' + item.title + ' في المعاينة.'); }}>تجهيز الإطار</Control>}
      {item.state === 'equipped' && <p role="status">هذا الإطار مجهّز في المعاينة.</p>}
      {item.state === 'locked' && <p role="status">الإطار مقفل على المستوى الحالي.</p>}
      {state.previousFrame && item.state === 'equipped' && <Control onClick={() => setState(previous => equipFixture(previous, previous.previousFrame))}>إعادة الإطار السابق</Control>}
    </>;
  } else if (panel?.kind === 'achievement') {
    const badge = panel.achievement;
    panelContent = <>
      <ProgressionArt className="pc-item-detail-art" src={progressionArt(badge.art)} width={140} height={112} />
      <dl><dt>الشرط</dt><dd>{badge.condition}</dd><dt>التقدم</dt><dd>{badge.progress}</dd>
        <dt>مصدر الاحتساب</dt><dd>{badge.source}</dd><dt>المكافأة</dt><dd>{badge.reward}</dd>
        <dt>تاريخ الحصول</dt><dd>{badge.date}</dd></dl>
      <Control onClick={() => setState(previous => toggleFixtureBadge(previous, badge.id))}>
        {state.badges.includes(badge.id) ? 'إخفاء من البروفايل' : 'إبراز الشارة'}
      </Control>
      <Control onClick={showCustomize}>إدارة الشارات واللقب</Control>
    </>;
  } else if (panel?.kind === 'mastery') {
    const track = panel.track;
    panelContent = <><ProgressionArt className="pc-item-detail-art" src={progressionArt(track.art)} width={94} height={94} />
      <p>الإتقان {progressionNumber(track.grade)} من {progressionNumber(track.maxGrade)}</p>
      <p>قيمة عرض لمسار {track.label} في لوحة المقارنة. لكل لعبة مسار مستقل عن مستوى الحساب.</p></>;
  } else if (panel?.kind === 'customize') {
    panelContent = <>
      <label className="pc-detail-field">اللقب المختار
        <select value={state.title} onChange={event => setState(previous => titleFixture(previous, event.target.value))}>
          {EARNED_TITLES.map(title => <option key={title}>{title}</option>)}
        </select>
      </label>
      <p>اختر حتى ثلاث شارات. يظهر ترتيبها من اليمين إلى اليسار.</p>
      <ol className="pc-badge-editor">
        {selectedBadges.map((badge, index) => <li key={badge.id}><strong>{badge.label}</strong>
          <div className="pc-panel-actions">
            <Control aria-label={'قدّم ' + badge.label} disabled={index === 0} onClick={() => setState(previous => moveFixtureBadge(previous, badge.id, -1))}>قدّم</Control>
            <Control aria-label={'أخّر ' + badge.label} disabled={index === selectedBadges.length - 1} onClick={() => setState(previous => moveFixtureBadge(previous, badge.id, 1))}>أخّر</Control>
            <Control aria-label={'أخفِ ' + badge.label} onClick={() => setState(previous => toggleFixtureBadge(previous, badge.id))}>أخفِ</Control>
          </div>
        </li>)}
      </ol>
      {ACHIEVEMENTS.filter(badge => !state.badges.includes(badge.id)).map(badge =>
        <Control key={badge.id} aria-label={'أبرز ' + badge.label} onClick={() => setState(previous => toggleFixtureBadge(previous, badge.id))}>أبرز {badge.label}</Control>)}
    </>;
  }

  return <>
    <style>{tokens}</style><style>{ui}</style><style>{showcaseStyles}</style><ProgressionStyles />
    {view === 'board' ? <PreviewBoard frames={BOARD_FRAMES.map(updateItem)} onItem={showItem}>{profile}</PreviewBoard>
      : <main className="pc-preview-phone" data-visual-stage="phone">{profile}</main>}
    <aside className="pc-preview-tools" dir="rtl" aria-label="أدوات المعاينة">
      <p><strong>معاينة محلية ببيانات تجريبية</strong><br />ليان حالة المقارنة. لا اتصال بحسابات ميدان.</p>
      <div className="pc-panel-actions">
        <Control aria-pressed={view === 'board'} onClick={() => setView('board')}>لوحة المكتب</Control>
        <Control aria-pressed={view === 'phone'} onClick={() => setView('phone')}>بروفايل الهاتف</Control>
        <Control onClick={showCatalog}>افتح خزانة المقتنيات</Control>
        <Control onClick={showCustomize}>تخصيص الشارات واللقب</Control>
        <Control onClick={reset}>إعادة ضبط المرجع</Control>
      </div>
      <label className="pc-detail-field">حالة العرض
        <select value={example} onChange={event => setExample(event.target.value)}>{Object.entries(cases).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
      </label>
      <p role="status">{notice}</p>
    </aside>
    {panel && <Modal title={labelForPanel(panel)} className="pc-detail-dialog" onClose={back}>
      <div ref={activePanelHeading} tabIndex={-1} className="pc-panel-focus">
        {panels.length > 1 && <Control onClick={back}>رجوع</Control>}
        {panelContent}
      </div>
    </Modal>}
  </>;
}
createRoot(document.getElementById('root')).render(<PreviewApp />);
