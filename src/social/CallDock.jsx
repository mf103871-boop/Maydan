import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from '../shared/ui/components.jsx';
import { useVisualViewport } from '../shared/ui/useVisualViewport.js';
import { ProfileAvatar } from '../profiles/ProfileAvatar.jsx';
import { LammaIcon, durationLabel } from './LammaMedia.jsx';
import { socialInterruption } from './interruption.js';
import { clampFloatingDockPosition, dockCapacity, normalizeCallParticipants, selectDockParticipants, stableCallParticipants } from './call-dock-model.js';
import dockCss from './call-dock.css';

const EMPTY = [];
const editable = element => !!element?.closest?.('input, textarea, [contenteditable="true"], [role="textbox"]');
const viewportHeight = () => typeof window === 'undefined' ? 768 : window.innerHeight;
const viewportWidth = () => typeof window === 'undefined' ? 390 : window.innerWidth;

function DockButton({ label, icon, children, className = '', ...props }) {
  return <button type="button" className={'call-dock-button ' + className} aria-label={label} title={label} {...props}>{icon && <LammaIcon name={icon} size={20} />}{children}</button>;
}

function useDockViewport() {
  const [viewport, setViewport] = useState(() => ({ width: viewportWidth(), height: viewportHeight(), keyboard: false }));
  useEffect(() => {
    let frame;
    const update = () => {
      frame = null;
      const visual = window.visualViewport;
      if (visual && Math.abs(Number(visual.scale ?? 1) - 1) > .001) return;
      const height = Number(visual?.height || window.innerHeight);
      const width = Number(visual?.width || window.innerWidth);
      const keyboard = editable(document.activeElement) && window.innerHeight - height > 120;
      setViewport(previous => previous.width === width && previous.height === height && previous.keyboard === keyboard ? previous : { width, height, keyboard });
    };
    const schedule = () => { if (frame == null) frame = window.requestAnimationFrame(update); };
    update();
    window.addEventListener('resize', schedule); window.visualViewport?.addEventListener('resize', schedule);
    document.addEventListener('focusin', schedule); document.addEventListener('focusout', schedule);
    return () => { if (frame != null) window.cancelAnimationFrame(frame); window.removeEventListener('resize', schedule); window.visualViewport?.removeEventListener('resize', schedule); document.removeEventListener('focusin', schedule); document.removeEventListener('focusout', schedule); };
  }, []);
  return viewport;
}

function ActiveCallControls({ call, media, currentUserId, privateTurn, panelOpen, inlineHost, onMute, onEnd, onOpen, onOutput, onResume }) {
  const [now, setNow] = useState(Date.now());
  const [expanded, setExpanded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [position, setPosition] = useState({ x: null, y: 0 });
  const [bounds, setBounds] = useState(() => ({ width: viewportWidth() - 16, height: viewportHeight() - 88, dockWidth: 52, dockHeight: 0 }));
  const [actionError, setActionError] = useState('');
  const ownsInterruption = useRef(false);
  const viewportRef = useRef(null);
  const railRef = useRef(null);
  const order = useRef([]);
  const previousPromotion = useRef(null);
  const previouslyConnected = useRef(false);
  const drag = useRef(null);
  const suppressClick = useRef(false);
  const viewport = useDockViewport();
  useVisualViewport(viewportRef, { heightProperty: '--call-dock-height', topProperty: '--call-dock-top' });
  const closeControls = useCallback(() => {
    setExpanded(false);
    if (ownsInterruption.current) { ownsInterruption.current = false; socialInterruption.close(); }
  }, []);
  const openControls = () => {
    if (!socialInterruption.getSnapshot().open) { ownsInterruption.current = true; socialInterruption.open(); }
    setExpanded(true);
  };
  useEffect(() => () => { if (ownsInterruption.current) { ownsInterruption.current = false; socialInterruption.close(); } }, []);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const participants = useMemo(() => normalizeCallParticipants(media.participants || EMPTY, { currentUserId: currentUserId || media.userId, muted: media.muted, connected: media.connected, connecting: media.connecting, privateTurn }), [media.participants, media.userId, media.muted, media.connected, media.connecting, currentUserId, privateTurn]);
  const ordered = stableCallParticipants(order.current, participants);
  order.current = ordered.map(person => person.id);
  // The measured viewport already excludes either the menu bar (including its
  // safe area) or the in-game friends button. Use that same space for seats.
  const availableHeight = bounds.height;
  const compact = collapsed || viewport.keyboard;
  const tiny = availableHeight < 230;
  const capacity = dockCapacity(availableHeight, ordered.length);
  const selection = selectDockParticipants(ordered, capacity, previousPromotion.current);
  previousPromotion.current = selection.promotedId;
  const effectiveMuted = !!(media.muted || privateTurn);
  const name = call.name || (call.scope === 'group' ? 'مكالمة اللّمة' : 'مكالمة صوتية');
  const started = call.acceptedAt || call.startedAt;
  // Native reconnect snapshots clear `connected`; remember this call's history.
  if (media.connected) previouslyConnected.current = true;
  const reconnecting = !!media.connecting && previouslyConnected.current;
  const status = reconnecting ? 'نعيد الاتصال بالمكالمة…' : media.connected && !media.connecting ? started ? durationLabel(now - Number(started)) : 'أنتم متصلون' : call.status === 'ringing' ? 'جارٍ الاتصال…' : 'جارٍ توصيل الصوت…';
  const mutedLabel = effectiveMuted ? privateTurn ? 'الميكروفون مكتوم خلال هذا الدور' : 'تشغيل الميكروفون' : 'كتم الميكروفون';
  const displayedPosition = clampFloatingDockPosition(position, bounds);
  useLayoutEffect(() => {
    if (panelOpen) return undefined;
    const viewportElement = viewportRef.current, rail = railRef.current;
    const measure = () => {
      if (!viewportElement || !rail) return;
      const next = { width: viewportElement.clientWidth, height: viewportElement.clientHeight, dockWidth: rail.offsetWidth, dockHeight: rail.offsetHeight };
      setBounds(previous => Object.keys(next).every(key => next[key] === previous[key]) ? previous : next);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (viewportElement) observer?.observe(viewportElement);
    if (rail) observer?.observe(rail);
    // Menu visibility and its measured CSS property can change without a
    // window resize. Keep the preferred X/Y; only reclamp its displayed value.
    const menuObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(measure);
    menuObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-menu-nav-visible'] });
    return () => { observer?.disconnect(); menuObserver?.disconnect(); };
  }, [viewport.width, viewport.height, compact, tiny, selection.visible.length, selection.hidden.length, panelOpen]);
  const act = async work => {
    setActionError('');
    try { await work?.(); }
    catch (error) { setActionError(error?.message && /[\u0600-\u06ff]/.test(error.message) ? error.message : 'تعذّر تنفيذ الطلب. حاول مجددًا.'); }
  };
  const toggleMute = () => { if (!privateTurn) act(() => onMute?.(!effectiveMuted)); };
  const dragStart = event => {
    if ((event.button != null && event.button !== 0) || event.isPrimary === false || drag.current) return;
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, position: displayedPosition, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const dragMove = event => {
    if (drag.current?.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.current.x, deltaY = event.clientY - drag.current.y;
    if (!drag.current.moved && Math.hypot(deltaX, deltaY) < 5) return;
    drag.current.moved = true; suppressClick.current = true;
    setPosition(clampFloatingDockPosition({ x: drag.current.position.x + deltaX, y: drag.current.position.y + deltaY }, bounds));
  };
  const dragEnd = event => { if (drag.current?.pointerId === event.pointerId) { drag.current = null; if (event.type === 'pointercancel') suppressClick.current = false; if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } };
  const movable = { onPointerDown: dragStart, onPointerMove: dragMove, onPointerUp: dragEnd, onPointerCancel: dragEnd };
  const moveWithKeyboard = event => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') { setPosition({ x: null, y: 0 }); return; }
    const next = { ...displayedPosition };
    if (event.key === 'End') next.y = bounds.height;
    else if (event.key === 'ArrowLeft') next.x -= 32;
    else if (event.key === 'ArrowRight') next.x += 32;
    else next.y += event.key === 'ArrowDown' ? 32 : -32;
    setPosition(clampFloatingDockPosition(next, bounds));
  };
  const personLabel = person => `${person.name}، ${person.muted ? 'الميكروفون مكتوم' : person.speaking ? 'يتحدث الآن' : 'الميكروفون مفتوح'}`;
  const muteButton = <DockButton label={mutedLabel} icon={effectiveMuted ? 'muted' : 'mic'} className={effectiveMuted ? 'is-muted' : ''} data-design-id="mute" data-design-required="true" data-testid="call-dock-mute" disabled={privateTurn} aria-pressed={effectiveMuted} onClick={toggleMute} />;
  const inline = <section data-design-screen="social.call" className="call-inline-controls" data-testid="call-inline-controls" aria-label="المكالمة الحالية"><button data-design-id="call-open" type="button" className="call-inline-summary" onClick={openControls} data-testid="call-dock-open"><LammaIcon name="phone" size={19} /><span><strong>{name}</strong><small>{status} · {ordered.length} مشارك</small></span></button>{muteButton}<DockButton label="إنهاء المكالمة" icon="end" className="is-danger" data-design-id="end-call" data-design-required="true" data-testid="call-dock-end" onClick={() => act(onEnd)} /></section>;
  const floating = <div ref={viewportRef} className="call-dock-viewport" hidden={panelOpen} aria-label="المحادثة الصوتية الجانبية"><section data-design-screen="social.call" ref={railRef} className={'call-dock' + (compact ? ' is-collapsed' : '') + (tiny ? ' is-tiny' : '') + (media.connecting ? ' is-connecting' : '')} style={{ transform: `translate(${displayedPosition.x}px, ${displayedPosition.y}px)` }} onPointerDownCapture={() => { suppressClick.current = false; }} onKeyDownCapture={() => { suppressClick.current = false; }} onClickCapture={event => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }} data-testid="call-dock" data-position-x={displayedPosition.x} data-position-y={displayedPosition.y} data-collapsed={compact} data-keyboard={viewport.keyboard} aria-label={name}>
    {!tiny && <button type="button" className="call-dock-button call-dock-grip" data-design-id="call-drag" data-testid="call-dock-drag" aria-label="تحريك دوائر المكالمة؛ اسحب أو استخدم الأسهم في الاتجاهات الأربعة" {...movable} onKeyDown={moveWithKeyboard}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" /></svg><i className={media.connected && !media.connecting ? 'is-connected' : ''} aria-hidden="true" /></button>}
    {compact || !ordered.length ? <DockButton label={`عرض أدوات المكالمة، ${ordered.length} مشارك، ${status}`} icon="people" data-design-id="call-open" data-testid="call-dock-open" onClick={openControls}><span className="call-dock-small-count" aria-hidden="true">{ordered.length}</span></DockButton> : <div className="call-dock-people">{selection.visible.map((person, seat) => <button type="button" data-design-id="speaker" className={'call-dock-person' + (person.speaking ? ' is-speaking' : '') + (person.muted ? ' is-muted' : '') + (selection.promotedId === person.id ? ' is-promoted' : '')} key={`seat-${seat}`} {...movable} onClick={openControls} aria-label={personLabel(person)} title={personLabel(person)} data-testid="call-dock-participant" data-user-id={person.id} data-speaking={person.speaking} data-muted={person.muted}><span className="call-dock-avatar"><ProfileAvatar user={person} size={36} />{person.muted ? <span className="call-dock-muted-mark"><LammaIcon name="muted" size={11} /></span> : person.speaking ? <span className="call-dock-voice-mark" aria-hidden="true"><i /><i /><i /></span> : null}</span>{selection.promotedId === person.id && <bdi className="call-dock-promoted-name">{person.name}</bdi>}</button>)}</div>}
    {!compact && selection.hidden.length > 0 && <DockButton label={`عرض جميع المشاركين، ${selection.hidden.length} آخرون${selection.hiddenSpeakingCount ? `، ${selection.hiddenSpeakingCount} يتحدثون الآن` : ''}`} className={selection.hiddenSpeakingCount ? 'has-speaking' : ''} data-testid="call-dock-more" onClick={openControls}><bdi>+{selection.hidden.length}</bdi>{selection.hiddenSpeakingCount > 0 && <span className="call-dock-more-speaking" aria-hidden="true">{selection.hiddenSpeakingCount}</span>}</DockButton>}
    {muteButton}
    {!viewport.keyboard && !tiny && <DockButton label={collapsed ? 'توسيع شريط المكالمة' : 'طي شريط المكالمة'} data-design-id="call-collapse" className="call-dock-collapse" data-testid="call-dock-collapse" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={collapsed ? 'm14 6-6 6 6 6' : 'm9 6 6 6-6 6'} /></svg></DockButton>}
    {(media.error || actionError) && <span className="call-dock-error-marker" role="img" aria-label="يوجد خطأ في الصوت؛ افتح أدوات المكالمة">!</span>}
    <span className="call-dock-sr-only" role="status">{reconnecting ? 'نعيد الاتصال بالمكالمة' : media.connecting ? 'جارٍ توصيل صوت المكالمة' : media.connected ? 'صوت المكالمة متصل' : 'المكالمة غير متصلة'}</span>
  </section></div>;
  const dialog = expanded && <Modal data-design-screen="social.call" title="المشاركون في المكالمة" className="call-controls-dialog" onClose={closeControls}><div className="call-controls-heading" data-testid="call-controls-dialog"><strong>{name}</strong><span>{status} · {ordered.length} مشارك</span></div><div data-design-id="participants" className="call-controls-members">{ordered.map(person => <div className={'call-controls-member' + (person.speaking ? ' is-speaking' : '')} key={person.id} data-user-id={person.id} data-speaking={person.speaking}><ProfileAvatar user={person} size={43} /><span><strong><bdi>{person.name}</bdi></strong><small>{person.muted ? 'الميكروفون مكتوم' : person.speaking ? 'يتحدث الآن' : media.connecting ? 'جارٍ الاتصال…' : 'الميكروفون مفتوح'}</small></span><LammaIcon name={person.muted ? 'muted' : 'mic'} size={20} /></div>)}</div>{!ordered.length && <p className="call-controls-note">سيظهر أصحابك هنا عند اكتمال الاتصال.</p>}{privateTurn && <p className="call-controls-note" role="status">الميكروفون مكتوم خلال هذا الدور. شغّله بنفسك عند انتهائه.</p>}<div className="call-controls-actions"><button data-design-id="mute" data-design-required="true" type="button" className={effectiveMuted ? 'is-muted' : ''} disabled={privateTurn} aria-pressed={effectiveMuted} onClick={toggleMute}><LammaIcon name={effectiveMuted ? 'muted' : 'mic'} size={20} />{mutedLabel}</button>{media.audioOutputs?.length > 0 && <label>مخرج الصوت<select data-design-id="audio-output" aria-label="مخرج صوت المكالمة" data-testid="call-dock-output" value={media.outputId || ''} onChange={event => act(() => onOutput?.(event.target.value))}>{media.audioOutputs.map(output => <option value={output.id || output.deviceId} key={output.id || output.deviceId}>{output.label || 'مكبر الصوت'}</option>)}</select></label>}<button data-design-id="friend-chat" type="button" data-testid="call-dock-return" onClick={() => { closeControls(); onOpen?.(); }}><LammaIcon name="chat" size={20} />العودة للمحادثة</button><button type="button" className="is-danger" data-design-id="end-call" data-design-required="true" data-testid="call-dock-end" onClick={() => act(onEnd)}><LammaIcon name="end" size={20} />إنهاء المكالمة</button></div>{(media.error || actionError) && <div className="call-controls-error" role="alert"><p>{actionError || media.error}</p><button data-design-id="resume-audio" type="button" data-testid="call-dock-resume" onClick={() => act(onResume)}>تشغيل صوت المكالمة</button></div>}</Modal>;
  return <><style>{dockCss}</style>{floating}{panelOpen && inlineHost ? createPortal(inline, inlineHost) : null}{dialog}</>;
}

export function CallControls({ call, media = {}, currentUserId, privateTurn = false, panelOpen = false, inlineHost = null, ...callbacks }) {
  if (!call || (currentUserId && media.userId && String(currentUserId) !== String(media.userId))) return null;
  return <ActiveCallControls key={`${currentUserId || media.userId || 'local'}:${call.id}`} call={call} media={media} currentUserId={currentUserId} privateTurn={privateTurn} panelOpen={panelOpen} inlineHost={inlineHost} {...callbacks} />;
}
