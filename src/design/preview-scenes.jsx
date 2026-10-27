// Preview imports the actual production screens. Only data and external effects
// are synthetic; no second implementation of a game or its controls lives here.
import React, { useMemo } from 'react';
import { createDesignFixture } from './screen-catalog.js';
import { Home } from '../platform/screens/Home.jsx';
import { GameDetails } from '../platform/screens/GameDetails.jsx';
import { Players } from '../platform/screens/Players.jsx';
import { Settings } from '../platform/screens/Settings.jsx';
import { Store } from '../platform/screens/Store.jsx';
import { About } from '../platform/screens/About.jsx';
import { AudioCredits } from '../platform/screens/AudioCredits.jsx';
import { Privacy } from '../platform/screens/Legal.jsx';
import Badeeha from '../games/badeeha/App.js';
import { Game as Beep, SetupOptions as BeepSetup } from '../games/beep/Game.jsx';
import { Game as Mamnoo, SetupOptions as MamnooSetup } from '../games/mamnoo/Game.jsx';
import { Game as Jabeen, SetupOptions as JabeenSetup } from '../games/jabeen/Game.jsx';
import { Game as Meenfina, SetupOptions as MeenfinaSetup } from '../games/meenfina/Game.jsx';
import { Game as Fabraka, SetupOptions as FabrakaSetup } from '../games/fabraka/Game.jsx';
import { Entry, Lobby, Match, RoomChrome } from '../online/Online.jsx';
import { FabrakaMatch } from '../online/Fabraka.jsx';
import { BadeehaMatch, BadeehaSettings } from '../online/Badeeha.jsx';
import { MafiaHistory,MafiaPrivacy,MafiaSafety,MafiaRules,MafiaSettings,MafiaDirectory,MafiaLobbyInfo,MafiaMatch } from '../online/Mafia.jsx';
import { ErsomhaMatch } from '../online/Ersomha.jsx';
import { ProfileView, ProfileEditor, CropDialog, SafetyDialog } from '../profiles/ProfileScreen.jsx';
import { SocialHost, GameInviteDialog, GroupEditor, Preferences } from '../social/SocialHost.jsx';
import { Conversation, SearchDialog, ActionDialog } from '../social/SocialScreen.jsx';
import { VoiceRecorder } from '../social/LammaMedia.jsx';
import { CallControls } from '../social/CallDock.jsx';
import { AccountCard } from '../shared/account/AccountCard.jsx';
import { Paywall } from '../shared/account/Paywall.jsx';
import { Button, Modal, Sheet } from '../shared/ui/components.jsx';
import { PlayersSetup } from '../shared/setup/PlayersSetup.jsx';
import { TeamsSetup } from '../shared/setup/TeamsSetup.jsx';
import { PassPhoneScreen } from '../shared/setup/PassPhoneScreen.jsx';
import { SignInSheet } from '../shared/account/SignInSheet.jsx';

const noop = () => {};
const resolved = async () => true;
export function createDesignMemoryStorage() {
  const values = new Map();
  return { persistent: true, get: (key, fallback = null) => values.has(key) ? values.get(key) : fallback, set: (key, value) => { values.set(key, value); return true; }, remove: key => values.delete(key), clear: () => values.clear(), keys: () => [...values.keys()] };
}
export function createDesignGameApi(platform = {}, designPreview = true) {
  const audio = { play: noop, stop: noop, enable: noop, volume: .75, music: { play: noop, enable: noop, sting: noop } };
  return { ...platform, designPreview, sound: audio, haptics: { vibrate: noop }, confetti: { fire: noop, burst: noop, clear: noop }, toast: noop,
    settings: { soundOn: false, musicOn: false, hapticsOn: false, reducedMotion: true }, storage: createDesignMemoryStorage(), roster: [],
    setInGame: noop, setSetupValid: noop, setGameOptions: noop, setExitMessage: noop, setBeforeExit: noop, resumeGame: noop,
    requestExit: noop, restart: noop, backToSetup: noop, matchStart: noop, matchSnapshot: () => null, matchResume: noop, matchOver: noop,
  };
}
export function createDesignDrawingClient() {
  const listeners = new Set(); let seq = 0, epoch = 1;
  const emit = value => listeners.forEach(listener => listener(value));
  return { ws: { bufferedAmount: 0 }, subscribeDrawing(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async command(type, payload = {}) {
      if (type === 'drawing_sync') queueMicrotask(() => emit({ kind: 'sync', epoch, seq, ops: [], undoneIds: [] }));
      else if (type === 'drawing_batch') emit({ kind: 'append', epoch, seq: ++seq, op: payload });
      else if (type === 'drawing_clear') emit({ kind: 'clear', epoch: ++epoch, seq: ++seq });
      return true;
    },
  };
}

export function DesignScene({ sceneId = 'home', previewState, platform, account, social, lamma, profiles, renderPlatform }) {
  const fixture = useMemo(() => createDesignFixture(sceneId, { now: Date.now() }), [sceneId]);
  const api = useMemo(() => createDesignGameApi(platform, fixture.badeeha || true), [platform, fixture]);
  const client = useMemo(createDesignDrawingClient, [sceneId]);
  const state = previewState || fixture.state;
  const common = { api, players: fixture.players, teams: fixture.teams, designPreviewState: state, onExit: noop };
  if (fixture.scene.game === 'badeeha' && fixture.scene.mode !== 'online') return <Badeeha key={sceneId} api={api} />;
  const local = { beep: Beep, mamnoo: Mamnoo, jabeen: Jabeen, meenfina: Meenfina, fabraka: Fabraka };
  if (fixture.scene.renderer === 'local-game' && local[fixture.scene.game]) { const Game = local[fixture.scene.game]; return <Game key={sceneId} {...common} />; }
  const setup = { 'setup.beep': BeepSetup, 'setup.mamnoo': MamnooSetup, 'setup.jabeen': JabeenSetup, 'setup.meenfina': MeenfinaSetup, 'setup.fabraka': FabrakaSetup }[sceneId];
  if (setup) { const Options = setup; const settings = <Options api={api} storage={api.storage} />; return sceneId === 'setup.mamnoo' ? <TeamsSetup min={2} max={4} api={api} onStart={noop}>{settings}</TeamsSetup> : <PlayersSetup roster={fixture.players} setRoster={noop} min={2} max={8} api={api} onStart={noop}>{settings}</PlayersSetup>; }
  const roomProps = { state, me: fixture.me, isHost: true, disabled: false, act: resolved, clockOffset: 0 };
  if (sceneId === 'online.entry') return <section data-design-screen="online.entry" className="stack online-screen"><Entry initialGame="ersomha" onJoined={noop} /></section>;
  if (sceneId === 'online.lobby') return <Lobby {...roomProps} />;
  if (sceneId === 'online.chrome') return <RoomChrome state={state} code="123456" status="connected" error={null} onExit={noop} onKick={noop} onReconnect={noop}><Lobby {...roomProps} /></RoomChrome>;
  if (sceneId.startsWith('online.meenfina.')) return <Match {...roomProps} />;
  if (sceneId.startsWith('online.fabraka.')) return <FabrakaMatch {...roomProps} />;
  if (sceneId === 'online.badeeha.setup') return <BadeehaSettings value={state.settings} onChange={noop} disabled={false} />;
  if (sceneId.startsWith('online.badeeha.')) return <BadeehaMatch {...roomProps} />;
  if(sceneId === 'online.mafia.privacy') return <MafiaPrivacy/>;
  if(sceneId === 'online.mafia.history') return <MafiaHistory data={{retentionDays:30,matches:[{matchKey:'demo',roleId:'investigator',faction:'town',won:1,draw:0,finishedAt:1800000000000}],stats:[{roleId:'investigator',faction:'town',matches:3,wins:2,draws:1}]}}/>;
  if(sceneId === 'online.mafia.guide') return <MafiaRules defaultOpen/>;
  if(sceneId === 'online.mafia.safety') return <MafiaSafety player={fixture.players[1]} onClose={noop} onSafety={resolved}/>;
  if(sceneId === 'online.mafia.setup') return <MafiaSettings value={state.settings} onChange={noop}/>;
  if(sceneId === 'online.mafia.directory') return <MafiaDirectory enabled rooms={[{code:'123456',hostName:'ليان',mode:'classic',capacity:8,players:6,ready:4}]} mode="classic" onCreate={noop}/>;
  if(sceneId === 'online.mafia.lobby') return <MafiaLobbyInfo state={state} isHost act={resolved}/>;
  if(fixture.scene.game === 'mafia') return <MafiaMatch {...roomProps} accountId="design-preview" voice={{status:'connected',muted:true,canPublish:state.phase==='discussion',participants:[],audioOutputs:[{deviceId:'default',label:'السماعة'},{deviceId:'speaker',label:'مكبر الصوت'}],outputId:'default',onMute:noop,onLeave:noop,onSpeaker:noop}}/>;
  if (fixture.scene.game === 'ersomha') return <ErsomhaMatch {...roomProps} client={client} status="connected" drawerReady={sceneId !== 'ersomha.private-wait'} onReport={resolved} />;
  const profile = fixture.profile;
  const fakeProfiles = profiles || { mine: profile, profiles: {}, ready: true, errors: {}, loadProfile: resolved, saveProfile: resolved };
  const fakeAccount = account || { ready: true, signedIn: true, user: profile };
  const fakeSocial = social || { offline: false, friends: [], incoming: [], outgoing: [], blocked: [], sendRequest: resolved, acceptRequest: resolved, cancelRequest: resolved, report: resolved, block: resolved };
  if (sceneId === 'profile') return <ProfileView account={fakeAccount} profiles={fakeProfiles} social={fakeSocial} />;
  if (sceneId === 'profile.editor') return <ProfileEditor profile={profile} profiles={fakeProfiles} onClose={noop} onSaved={noop} />;
  if (sceneId === 'profile.safety') return <SafetyDialog action="report" profile={profile} social={fakeSocial} onClose={noop} onDone={noop} />;
  if (sceneId === 'profile.crop') return <CropDialog crop={{ kind: 'avatar', image: { width: 600, height: 600, url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="600" height="600"%3E%3Crect width="600" height="600" fill="%2318B7BE"/%3E%3Ccircle cx="300" cy="220" r="95" fill="%23FFF7E7"/%3E%3Cellipse cx="300" cy="500" rx="170" ry="155" fill="%23FFF7E7"/%3E%3C/svg%3E' } }} profiles={fakeProfiles} revision={1} onClose={noop} onDone={noop} />;
  if (sceneId === 'social.list') return <><div data-social-page-slot /><SocialHost /></>;
  if (sceneId === 'social.conversation') return <Conversation friend={{ ...fixture.players[1], online: true }} account={fakeAccount} social={{ ...fakeSocial, markRead: resolved, setTyping: resolved, sendMessage: resolved, loadOlder: resolved }} conversation={{ messages: [{ id: 'demo-message', seq: 1, senderId: fixture.players[1].id, text: 'مين جاهز نلعب ارسمها؟ 🎨', createdAt: Date.now() }], peerReadSeq: 0 }} onMenu={noop} onBack={noop} onAction={noop} notify={noop} />;
  if (sceneId === 'social.search') return <SearchDialog social={{ ...fakeSocial, search: async () => [] }} onClose={noop} run={resolved} busy="" onOpen={noop} />;
  if (sceneId === 'social.action') return <ActionDialog action={{ kind: 'report', user: fixture.players[1], message: { seq: 1, text: 'رسالة للمعاينة' } }} social={fakeSocial} onClose={noop} onComplete={noop} />;
  if (sceneId === 'social.invite') return <GameInviteDialog target={{ targetType: 'group', targetId: 'demo-group' }} lamma={lamma || { sendGameInvite: resolved }} onClose={noop} onLaunched={noop} notify={noop} />;
  if (sceneId === 'social.group-editor') return <GroupEditor friends={fixture.players.slice(1)} accountId={fixture.players[0].id} lamma={lamma || { createGroup: resolved }} onClose={noop} onCreated={noop} notify={noop} />;
  if (sceneId === 'social.preferences') return <Preferences social={fakeSocial} lamma={lamma || { notifications: { enabled: true, previews: false, sound: true }, capabilities: {}, setNotificationPreferences: resolved }} onClose={noop} notify={noop} />;
  if (sceneId === 'social.voice') return <VoiceRecorder disabled unavailableReason="معاينة التصميم؛ التسجيل الفعلي معطّل هنا." onSend={resolved} onError={noop} />;
  if (sceneId === 'social.call') return <CallControls call={{ id: 'demo-call', scope: 'group', status: 'active', name: 'شلّة الخميس', startedAt: Date.now() }} currentUserId={fixture.players[0].id} media={{ connected: true, userId: fixture.players[0].id, muted: false, participants: fixture.players.map((p, i) => ({ ...p, identity: p.id, speaking: i === 1, local: i === 0, muted: i === 2 })) }} onMute={resolved} onEnd={noop} onOpen={noop} />;
  if (sceneId === 'home') return <Home />;
  if (sceneId === 'game-details') return <GameDetails id="ersomha" />;
  if (sceneId === 'players') return <Players />;
  if (sceneId === 'settings') return <Settings />;
  if (sceneId === 'store') return <Store />;
  if (sceneId === 'about') return <About />;
  if (sceneId === 'audio-credits') return <AudioCredits />;
  if (sceneId === 'legal') return <Privacy />;
  if (sceneId === 'account.card') return <AccountCard />;
  if (sceneId === 'account.paywall') return <Paywall onClose={noop} />;
  if (sceneId === 'account.signin') return <SignInSheet open onClose={noop} />;
  if (sceneId === 'system.dialog') return <Modal title="تأكيد الإجراء" onClose={noop} footer={<><Button variant="ghost" onClick={noop}>إلغاء</Button><Button variant="primary" onClick={noop}>تأكيد</Button></>}><p>معاينة نافذة ميدان الفعلية.</p></Modal>;
  if (sceneId === 'system.sheet') return <Sheet title="خيارات ميدان" onClose={noop}><Button full onClick={noop}>متابعة</Button></Sheet>;
  if (sceneId === 'play-setup') return <PlayersSetup roster={fixture.players} setRoster={noop} min={2} max={8} api={api} onStart={noop} />;
  if (sceneId === 'play-setup.teams') return <TeamsSetup min={2} max={4} api={api} onStart={noop} />;
  if (sceneId === 'setup.add-player') return <PlayersSetup roster={fixture.players} setRoster={noop} min={2} max={8} api={api} onStart={noop} designPreviewAdding />;
  if (sceneId === 'setup.pass-phone') return <PassPhoneScreen player={fixture.players[0]} api={api}><p>محتوى الدور السري في المعاينة</p></PassPhoneScreen>;
  return renderPlatform ? renderPlatform(sceneId, fixture) : null;
}
