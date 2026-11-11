// Private loopback fixture. Real screens and audio controllers, synthetic data;
// no Account/Social providers, sockets, credentials or microphone are created.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PreviewProviders, PlatformDesignScene } from '../../src/design/preview-platform.jsx';
import { DesignProvider } from '../../src/design/DesignProvider.jsx';
import { createDesignFixture, DESIGN_SCENES } from '../../src/design/screen-catalog.js';
import { DesignScene, createDesignGameApi, createDesignDrawingClient } from '../../src/design/preview-scenes.jsx';
import { PlatformContext, usePlatform } from '../../src/platform/context.js';
import { createRoomAudioAdapter } from '../../src/shared/fx/room-audio.js';
import { createLocalMatchAudio, createOnlineMatchAudio } from '../../src/shared/fx/match-audio.js';
import { createMafiaPhaseAudio, createMafiaPublicAudio, createMafiaCountdownAudio } from '../../src/games/mafia/audio.js';
import Badeeha from '../../src/games/badeeha/App.js';
import { Game as Beep } from '../../src/games/beep/Game.jsx';
import { Game as Mamnoo } from '../../src/games/mamnoo/Game.jsx';
import { Game as Jabeen } from '../../src/games/jabeen/Game.jsx';
import { Game as Meenfina } from '../../src/games/meenfina/Game.jsx';
import { Game as Fabraka } from '../../src/games/fabraka/Game.jsx';
import { Lobby, Match } from '../../src/online/Online.jsx';
import { BadeehaMatch } from '../../src/online/Badeeha.jsx';
import { FabrakaMatch } from '../../src/online/Fabraka.jsx';
import { ErsomhaMatch } from '../../src/online/Ersomha.jsx';
import { MafiaMatchView } from '../../src/online/Mafia.jsx';

const LOCAL = { beep: Beep, mamnoo: Mamnoo, jabeen: Jabeen, meenfina: Meenfina, fabraka: Fabraka };
const noop = () => {};
const stageLayout = `body:has(.audio-review-stage){overflow:auto!important}.audio-review-stage .ersomha.is-drawing-focus{position:relative!important;inset:auto!important;height:680px!important;width:100%!important;max-width:100%!important;z-index:1!important}.audio-review-stage .ers-canvas-panel{max-width:100%}.audio-review-stage .ers-board-wrap{max-width:100%!important}`;
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const audioProjection = state => { const value = clone(state); if (value) delete value._designPreview; return value; };
const validScene = (game, id) => game === 'home' ? DESIGN_SCENES.find(scene => scene.id === 'home') : DESIGN_SCENES.find(scene => scene.game === game && scene.id === id) || DESIGN_SCENES.find(scene => scene.game === game && scene.phase === (['ersomha', 'mafia'].includes(game) ? 'lobby' : 'play')) || DESIGN_SCENES.find(scene => scene.game === game);

export function AudioReviewStage(props) {
  if (!props.sound) return <p role="status">جارٍ تجهيز ناقل الصوت المحلي…</p>;
  const scene = validScene(props.game, props.sceneId);
  if (!scene) return <p role="status">لا توجد واجهة فعلية لهذه الحالة.</p>;
  return <PreviewProviders sceneId={scene.id}><DesignProvider preview><Stage key={props.game} {...props} sceneId={scene.id}/></DesignProvider></PreviewProviders>;
}

function Stage({ sound, game, sceneId, running = true, onEvent = noop, onControls = noop }) {
  const platform = usePlatform();
  const callbacks = useRef({ onEvent, onControls }); callbacks.current = { onEvent, onControls };
  const [epoch, setEpoch] = useState(0), [owner, setOwner] = useState('audio-lab-owner-1');
  const [connected, setConnected] = useState(true), [hidden, setHidden] = useState(false);
  const [publicPhase, setPublicPhase] = useState(null);
  const [override, setOverride] = useState(null), [localSession, setLocalSession] = useState(0);
  const activeSceneId = override?.sceneId === sceneId ? override.templateId || sceneId : sceneId;
  // Explicit reset must recreate the frozen fixture and its local time baseline.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fixture = useMemo(() => createDesignFixture(activeSceneId, { now: Date.now() }), [activeSceneId, epoch]);
  const room = fixture.scene.renderer === 'room';
  const latest = useRef({}), serial = useRef(0), revision = useRef(0), phaseSerial = useRef(0), phaseIdentity = useRef(null), baseline = useRef(false);
  const sequenceGeneration = useRef(0), sequenceWaiters = useRef(new Set()), requestedScene = useRef(null);
  const cancelSequence = useCallback(() => { sequenceGeneration.current++; for (const finish of [...sequenceWaiters.current]) finish(); }, []);
  const mountedScene = useRef(null), renderScope = useRef(null), alive = useRef(false), stageRoot = useRef(null), musicOwner = useRef(Symbol('audio-review-scene'));
  const snapshot = useRef(null);
  if (snapshot.current?.fixture !== fixture || snapshot.current?.override !== override) { snapshot.current = { fixture, override }; revision.current++; }
  const snapshotRevision = revision.current;
  const state = useMemo(() => {
    const next = clone(override?.sceneId === sceneId ? override.state : fixture.state);
    if (!next || !room) return next;
    next._designPreview = true; next.revision = snapshotRevision;
    next.matchId = 1;
    const identity = JSON.stringify([next.game, next.matchId, next.round, next.phase]);
    if (phaseIdentity.current !== identity) { phaseIdentity.current = identity; phaseSerial.current++; }
    next.phaseId = phaseSerial.current;
    return next;
  }, [fixture, override, sceneId, room, snapshotRevision]);
  const scopeKey = `${activeSceneId}:${epoch}:${owner}`;
  if (requestedScene.current?.id !== sceneId || requestedScene.current?.sound !== sound) { requestedScene.current = { id: sceneId, sound }; sequenceGeneration.current++; }
  if (renderScope.current?.key !== scopeKey || renderScope.current?.sound !== sound) { renderScope.current = { key: scopeKey, sound }; mountedScene.current = {}; baseline.current = false; }
  const scopeToken = mountedScene.current;
  latest.current = { state, fixture, sceneId, activeSceneId, connected, hidden, running, owner, room, meId: override?.sceneId === sceneId ? override.meId || fixture.me?.id : fixture.me?.id };
  const report = useCallback(row => { if (alive.current) callbacks.current.onEvent({ ...row, type: row.name || row.kind, detail: row.decision, synthetic: true, at: Date.now() }); }, []);
  const observed = useMemo(() => new Proxy(sound, { get(target, key) {
    if (key !== 'play' && key !== 'emit') return Reflect.get(target, key);
    return (name, options = {}) => {
      const current = latest.current, token = mountedScene.current;
      const allowed = alive.current && baseline.current && current.running && !current.hidden;
      const priorGuard = options.guard;
      const guard = () => alive.current && token === mountedScene.current && baseline.current && latest.current.running && !latest.current.hidden && (typeof priorGuard !== 'function' || priorGuard());
      const result = allowed ? target[key](name, { ...options, guard }) : false;
      report({ kind: 'audio-request', method: key, name, decision: !allowed ? 'baseline-or-paused' : result === false ? 'suppressed-or-silent' : 'queued-or-started' });
      return result;
    };
  } }), [sound, report]);
  // Snapshot projections use the real bus directly: their own controllers own
  // silent baselines. Local mount effects use the observed guard above.
  const makeAudio = useCallback(() => {
    const monitor = new Proxy(sound, { get(target, key) {
      if (!['play', 'emit'].includes(key)) return Reflect.get(target, key);
      return (name, options) => { const result = target[key](name, options); report({ kind: 'projection-request', method: key, name, decision: result === false ? 'suppressed-or-silent' : 'queued-or-started' }); return result; };
    } });
    return { room: createRoomAudioAdapter(monitor, { available: () => latest.current.running && !latest.current.hidden }),
      online: createOnlineMatchAudio(monitor, 'audio-lab-room'), local: createLocalMatchAudio(observed, game, 'audio-lab'),
      phase: createMafiaPhaseAudio(monitor), events: createMafiaPublicAudio(monitor), clock: createMafiaCountdownAudio(monitor) };
  }, [sound, game, observed, report]);
  const controllers = useRef(null);
  const audio = useMemo(() => new Proxy({}, { get(_target, key) { return controllers.current?.[key]; } }), []);
  const options = useCallback(() => ({ ownerId: latest.current.owner, seatId: latest.current.meId || '', code: latest.current.state?.code || 'audio-lab-room', hidden: latest.current.hidden || !latest.current.running, preview: false }), []);
  useLayoutEffect(() => { const current = makeAudio(); controllers.current = current; alive.current = true; current.local.begin(); return () => { alive.current = false; cancelSequence(); for (const item of Object.values(current)) item.dispose(); if (controllers.current === current) controllers.current = null; }; }, [makeAudio, cancelSequence]);
  useLayoutEffect(() => { if (!running) cancelSequence(); }, [running, cancelSequence]);
  useLayoutEffect(() => { cancelSequence(); }, [sceneId, sound, cancelSequence]);
  useLayoutEffect(() => {
    audio.room.connection(connected ? 'connected' : 'reconnecting', options());
    if (room && state) {
      const projected = audioProjection(state), config = options();
      audio.room.update(projected, { ...config, receivedAt: Date.now() });
      audio.online.update(projected, { connected, hidden: hidden || !running });
      if (game === 'mafia') { const info = { hidden: hidden || !running || !connected, ownerId: owner }; audio.phase.update(projected, info); audio.events.update(projected, info); audio.clock.update(projected, { ...info, remaining: null }); }
    }
  }, [audio, state, room, connected, hidden, running, owner, game, options]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => { baseline.current = true; });
    return () => { baseline.current = false; cancelAnimationFrame(frame); };
  }, [activeSceneId, epoch, owner, sound]);
  useLayoutEffect(() => {
    const lease = musicOwner.current, root = stageRoot.current;
    let current, disposed = false;
    const apply = phase => {
      if (disposed || current === phase) return;
      current = phase;
      // A missing/unregistered public root must not fall through to the entry's
      // lower-priority intro music. This is an owner lease, not a saved setting.
      if (!phase) sound.music.setSuppressed(true, lease);
      sound.music.scene(lease, game, phase || 'audio-review-unknown', 30);
      if (phase) sound.music.setSuppressed(false, lease);
      setPublicPhase(previous => previous?.token === scopeToken && previous.phase === phase ? previous : { token: scopeToken, phase });
    };
    if (room || game === 'home') apply(state?.phase || fixture.scene.phase || 'idle');
    else {
      const read = () => {
        // Read only the public semantic screen ID inside this isolated root.
        // No text, words, role/faction fields or internal reducer are inspected.
        const id = root?.querySelector('[data-design-screen]')?.getAttribute('data-design-screen');
        const scene = DESIGN_SCENES.find(item => item.id === id && item.game === game && item.renderer === 'local-game');
        apply(scene?.phase || null);
      };
      read();
      const observer = new MutationObserver(read);
      if (root) observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-design-screen'] });
      return () => { disposed = true; observer.disconnect(); sound.music.releaseScene(lease); sound.music.setSuppressed(false, lease); };
    }
    return () => { disposed = true; sound.music.releaseScene(lease); sound.music.setSuppressed(false, lease); };
  }, [sound, game, room, state?.phase, fixture.scene.phase, scopeToken]);

  const reset = useCallback(() => { if (!alive.current) return; cancelSequence(); audio.room.suspend(); audio.phase.suspend(); audio.events.suspend(); audio.clock.suspend(); sound.stop(); setOverride(null); setEpoch(value => value + 1); setLocalSession(value => value + 1); audio.local.begin(); report({ kind: 'control', name: 'reset', decision: 'next-snapshot-is-baseline' }); }, [audio, sound, report, cancelSequence]);
  const update = useCallback(change => {
    const current = latest.current;
    if (!alive.current || !current.room || !current.state) return false;
    setOverride({ sceneId: current.sceneId, templateId: current.activeSceneId, meId: current.meId, state: change(clone(current.state)) }); return true;
  }, []);
  const showTemplate = useCallback((phase, { id, mutate } = {}) => {
    const current = latest.current;
    const candidates = DESIGN_SCENES.filter(scene => scene.game === game && scene.renderer === (current.room ? 'room' : 'local-game'));
    const target = candidates.find(scene => scene.id === id) || candidates.find(scene => scene.phase === phase && !scene.id.includes('spectator') && !scene.id.includes('tools'));
    if (!target || !alive.current) return false;
    const next = createDesignFixture(target.id, { now: Date.now() });
    setOverride({ sceneId: current.sceneId, templateId: target.id, meId: next.me?.id, state: mutate ? mutate(clone(next.state)) : clone(next.state) });
    report({ kind: 'fixture-transition', name: target.id, decision: 'existing-synthetic-template' }); return true;
  }, [game, report]);
  const accepted = useCallback((type, fields = {}, ok = true) => {
    if (!alive.current) return false;
    const requestId = `lab-${++serial.current}`, ticket = audio.room.capture(type, requestId);
    const decision = audio.room.accepted(ticket, { requestId, ok });
    report({ kind: 'synthetic-ack', name: type, decision: !ok ? 'rejected-no-audio' : decision ? 'accepted-requested' : 'accepted-no-audio', requestId });
    return ok;
  }, [audio, report]);
  const act = useCallback(async (type, fields = {}) => {
    if (!latest.current.running || latest.current.hidden || !latest.current.connected) return false;
    cancelSequence();
    // These controls acknowledge a clearly synthetic command. Full game rules
    // remain in the actual game/reducers; no server success is manufactured.
    const result = accepted(type, fields, true);
    if (type === 'ready') update(next => { next.members = next.members.map(member => member.id === latest.current.meId ? { ...member, ready: fields.ready ?? !member.ready } : member); return next; });
    else if (type === 'start') showTemplate({badeeha:'board',ersomha:'select',fabraka:'write',meenfina:'vote',mafia:'opening'}[game]);
    else if (type === 'open' && game === 'badeeha') showTemplate('question');
    else if (type === 'reveal') showTemplate('reveal');
    else if (type === 'judge' && game === 'badeeha') update(next => { next.verdict = { qid: next.current?.qid, teamId: fields.teamId || null, steal: false }; return next; });
    else if (type === 'finish_writing') showTemplate('discussion');
    else if (type === 'start_vote') showTemplate('vote');
    else if (type === 'select_word') showTemplate('draw', { id: 'ersomha.draw.drawer' });
    else if (type === 'guess' && game === 'ersomha') update(next => { next.guessedIds = [...new Set([...(next.guessedIds || []), latest.current.meId])]; return next; });
    else if (type === 'vote') update(next => { next.myVote = { submitted: true }; return next; });
    else if (type === 'lie' || type === 'truth') update(next => { next.mySubmission = { submitted: true }; return next; });
    else if (type === 'night_action') update(next => { next.you.nightAction = fields.targetId ? { targetId: fields.targetId } : null; return next; });
    else if (type === 'mafia_vote') update(next => { next.you.killTarget = fields.targetId || null; return next; });
    else if (type === 'next') showTemplate('over');
    else if (type === 'end') showTemplate('over');
    else if (type === 'restart') reset();
    else if (type === 'leave') report({ kind: 'synthetic-command', name: 'leave', decision: 'no-external-room' });
    return result;
  }, [accepted, reset, report, update, showTemplate, game, cancelSequence]);
  const simulate = useCallback((action, fields = {}, sequenceOwned = false) => {
    if (!alive.current) return false;
    if (!sequenceOwned) cancelSequence();
    if (action === 'accepted' || action === 'rejected') return accepted(fields.type || 'vote', fields, action === 'accepted');
    if (action === 'cancel-pending') { audio.room.suspend(); audio.phase.suspend(); audio.events.suspend(); audio.clock.suspend(); sound.stop(); return true; }
    return update(next => {
      if (action === 'member-join') next.members.push({ id: `audio-lab-guest-${++serial.current}`, name: 'ضيف تجريبي', ready: false, connected: true, left: false, avatar: 0 });
      else if (action === 'member-leave') { const last = [...next.members].reverse().find(member => !member.left && member.id !== latest.current.fixture.me?.id); if (last) last.left = true; }
      else if (action === 'ready' || action === 'all-ready') next.members = next.members.map((member, index) => action === 'all-ready' || index === 0 ? { ...member, ready: action === 'all-ready' ? true : !member.ready, connected: true } : member);
      else if (action === 'public-hint' && next.game === 'ersomha') next.publicWord.letters = [...(next.publicWord.letters || []), { index: 0, letter: 'ق' }];
      else if (action === 'public-correct' && next.game === 'ersomha') next.guessedIds = [...new Set([...(next.guessedIds || []), `audio-lab-guesser-${++serial.current}`])];
      else if (action === 'public-event' && next.game === 'mafia') next.log = [...next.log, { id: Math.max(0, ...next.log.map(item => item.id)) + 1, type: 'eliminated', reason: 'night', at: Date.now(), round: next.round }];
      return next;
    });
  }, [accepted, audio, sound, update, cancelSequence]);
  const background = useCallback((value = true, { dispatchEvents = true } = {}) => { if (!alive.current) return false; cancelSequence(); if (value) { audio.room.suspend(); audio.phase.suspend(); audio.events.suspend(); audio.clock.suspend(); } setHidden(Boolean(value)); if (dispatchEvents) { window.dispatchEvent(new Event(value ? 'pagehide' : 'pageshow')); window.dispatchEvent(new CustomEvent('maydan-audio-lifecycle', { detail: { state: value ? 'background' : 'foreground' } })); } report({ kind: 'control', name: 'background', decision: value ? 'suspended' : 'fresh-baseline-required' }); }, [audio, report, cancelSequence]);
  const reconnect = useCallback((value = true) => { if (!alive.current) return false; cancelSequence(); setConnected(Boolean(value)); report({ kind: 'control', name: 'connection', decision: value ? 'connected-next-baseline' : 'disconnected' }); }, [report, cancelSequence]);
  const changeIdentity = useCallback(() => { if (!alive.current) return false; cancelSequence(); sound.resetIdentity(`audio-lab-owner-${++serial.current}`); setOwner(`audio-lab-owner-${serial.current}`); setOverride(null); setEpoch(value => value + 1); setLocalSession(value => value + 1); report({ kind: 'control', name: 'identity', decision: 'old-guards-invalidated' }); }, [sound, report, cancelSequence]);
  const session = useCallback(async () => {
    if (!alive.current) return false;
    cancelSequence(); const token = sequenceGeneration.current;
    const path = latest.current.room ? ({ ersomha:['select','draw','result','over'], badeeha:['board','question','reveal','over'], fabraka:['write','discussion','vote','reveal','result','over'], meenfina:['vote','result','over'], mafia:['lobby','opening','night','dawn','discussion','nomination','defense','verdict','over'] }[game] || []) : [...new Set(DESIGN_SCENES.filter(scene => scene.game === game && scene.renderer === 'local-game' && scene.mode === latest.current.fixture.scene.mode).map(scene => scene.phase))];
    report({ kind: 'control', name: 'sequence', decision: 'existing-template-sequence-not-a-real-match' });
    for (const phase of path) {
      if (!alive.current || token !== sequenceGeneration.current || !latest.current.running) return;
      showTemplate(phase);
      await new Promise(resolve => { let timer; const finish = () => { clearTimeout(timer); sequenceWaiters.current.delete(finish); resolve(); }; timer = setTimeout(finish, 2500); sequenceWaiters.current.add(finish); });
    }
    for (const action of ['accepted', 'rejected', 'cancel-pending']) {
      if (!alive.current || token !== sequenceGeneration.current || !latest.current.running) return;
      simulate(action, {}, true);
    }
    report({ kind: 'control', name: 'sequence', decision: 'synthetic-template-and-ACK-sequence-finished' });
  }, [simulate, showTemplate, game, report, cancelSequence]);
  const localSound = useMemo(() => new Proxy(observed, { get(target, key) {
    if (key !== 'play' && key !== 'emit') return Reflect.get(target, key);
    return (name, options = {}) => { if (scopeToken !== mountedScene.current) return false; const guard = options.guard; return target[key](name, { ...options, guard: () => scopeToken === mountedScene.current && (typeof guard !== 'function' || guard()) }); };
  } }), [observed, scopeToken]);
  const api = useMemo(() => ({ ...createDesignGameApi(platform, fixture.badeeha || true), sound: localSound, audioReview: true,
    matchStart: () => scopeToken === mountedScene.current && audio.local?.begin(), matchOver: ({ completed = false } = {}) => scopeToken === mountedScene.current && audio.local?.complete(completed),
    restart: reset, backToSetup: reset, requestExit: reset }), [platform, fixture.badeeha, localSound, audio, reset, scopeToken]);
  const nested = useMemo(() => ({ ...platform, sound: observed, settings: { ...platform.settings, soundOn: sound.enabled, musicOn: sound.music.enabled } }), [platform, observed, sound]);
  const client = useMemo(createDesignDrawingClient, [game, epoch]);
  const currentPublicPhase = publicPhase?.token === scopeToken ? publicPhase.phase : null;
  useEffect(() => { callbacks.current.onControls({ session, sessionInfo: { game, sceneId: activeSceneId, kind: room ? 'room' : 'local', phase: currentPublicPhase, revision: state?.revision || null, ownerId: owner, connected, hidden, synthetic: true }, cases: [{id:'accepted',label:'قبول ACK مصطنع'},{id:'rejected',label:'رفض ACK بلا تأكيد'},{id:'cancel-pending',label:'إلغاء العمل المؤجل'},...(room?[{id:'member-join',label:'تغيّر عضو علني'},{id:'ready',label:'جاهزية علنية'},{id:'all-ready',label:'جاهزية الجميع'}]:[]),...(game==='ersomha'?[{id:'public-hint',label:'تلميح منشور'},{id:'public-correct',label:'تخمين صحيح منشور'}]:[]),...(game==='mafia'?[{id:'public-event',label:'حدث سجل علني'}]:[])], simulate, reset, background, reconnect, changeIdentity }); }, [session, game, activeSceneId, room, state, owner, connected, hidden, currentPublicPhase, simulate, reset, background, reconnect, changeIdentity]);
  useEffect(() => () => callbacks.current.onControls(null), []);

  let content;
  const me = room ? state.members?.find(member => member.id === latest.current.meId) || fixture.me : fixture.me;
  const common = { state, me, isHost: state?.hostId === me?.id, disabled: !running || hidden || !connected, act, clockOffset: 0, connection: connected ? 'connected' : 'reconnecting' };
  if (game === 'home') content = <PlatformDesignScene sceneId="home"/>;
  else if (/\.(directory|setup|guide|privacy|safety|history)$/.test(activeSceneId)) content = <DesignScene sceneId={activeSceneId} platform={nested}/>;
  else if (room) {
    if (state.phase === 'lobby') content = <Lobby {...common}/>;
    else if (game === 'mafia') content = <MafiaMatchView {...common} accountId={owner} sound={null} voice={{ status: 'idle', muted: true, canPublish: false }}/ >;
    else if (game === 'ersomha') content = <ErsomhaMatch {...common} client={client} status={connected ? 'connected' : 'reconnecting'} drawerReady onReport={async () => false}/>;
    else if (game === 'badeeha') content = <BadeehaMatch {...common}/>;
    else if (game === 'fabraka') content = <FabrakaMatch {...common}/>;
    else content = <Match {...common}/>;
  } else if (game === 'badeeha') content = <Badeeha key={`${activeSceneId}:${localSession}:${epoch}`} api={api}/>;
  else { const Component = LOCAL[game]; content = Component ? <Component key={`${activeSceneId}:${localSession}:${epoch}`} api={api} players={fixture.players} teams={fixture.teams} designPreviewState={state} onExit={reset}/> : <p>هذه الحالة ليست واجهة لعب محلية.</p>; }
  return <PlatformContext.Provider value={nested}><section ref={stageRoot} className="audio-review-stage" data-audio-stage={game} data-audio-scene={activeSceneId} data-audio-music-phase={currentPublicPhase || 'unknown'} data-audio-synthetic="true" dir="rtl" style={{position:'relative',contain:'layout paint',isolation:'isolate',minHeight:720}}><style>{stageLayout}</style><p role="note" className="studio-fixture-banner">مباراة مصطنعة محلية · لا حسابات أو اتصال أو ميكروفون. سجل الصوت يثبت الطلب/القرار فقط.</p>{!room&&game!=='home'&&<p className="studio-fixture-banner">قالب الواجهة الحقيقي؛ مؤقته ثابت. أزرار تتطلب عدّادًا يعمل قد تبقى معطّلة. سلسلة القوالب لا تثبت مباراة كاملة أو هذه الأزرار.</p>}{!room&&game==='badeeha'&&<p className="studio-fixture-banner">بديهة المحلية تمنع مؤثرات الأفعال داخل قالب Studio. جرّب الكشف والحكم من مراحل بديهة أونلاين هنا؛ لا ندّعي اختبار مؤثرات هذه النسخة المحلية.</p>}{content}</section></PlatformContext.Provider>;
}
