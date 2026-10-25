// The preview uses production React components with private, memory-only fixture
// contexts. None of the real account/social/media providers is ever mounted.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { PlatformContext } from '../platform/context.js';
import { AccountContext, NULL_ACCOUNT } from '../shared/account/context.js';
import { SocialContext } from '../social/SocialProvider.jsx';
import { LammaContext } from '../social/LammaProvider.jsx';
import { SocialUIContext } from '../social/SocialUIProvider.jsx';
import { ProfileContext } from '../profiles/ProfileProvider.jsx';
import { ToastProvider, Screen, TopBar, Button, Card, Modal, Sheet, ConfirmModal } from '../shared/ui/components.jsx';
import { Home } from '../platform/screens/Home.jsx';
import { Settings } from '../platform/screens/Settings.jsx';
import { Store } from '../platform/screens/Store.jsx';
import { GameDetails } from '../platform/screens/GameDetails.jsx';
import { Players } from '../platform/screens/Players.jsx';
import { About } from '../platform/screens/About.jsx';
import { AudioCredits } from '../platform/screens/AudioCredits.jsx';
import { Privacy } from '../platform/screens/Legal.jsx';
import { BottomNavigation } from '../platform/BottomNavigation.jsx';
import { GameFrame } from '../platform/GameFrame.jsx';
import { getGame } from '../platform/registry.js';
import { SocialHost, GroupEditor, GameInviteDialog, Preferences } from '../social/SocialHost.jsx';
import { SearchDialog, ActionDialog, Conversation } from '../social/SocialScreen.jsx';
import { LammaButton, VoiceMessage } from '../social/LammaMedia.jsx';
import { CallControls } from '../social/CallDock.jsx';
import { ProfileScreen, ProfileEditor, CropDialog, SafetyDialog } from '../profiles/ProfileScreen.jsx';
import { AccountCard } from '../shared/account/AccountCard.jsx';
import { Paywall } from '../shared/account/Paywall.jsx';
import { BrandFonts, Avatar } from '../shared/brand/art.jsx';
import tokensCss from '../shared/theme/tokens.css';
import brandCss from '../shared/brand/brand.css';
import uiCss from '../shared/ui/ui.css';
import setupCss from '../shared/setup/setup.css';
import platformCss from '../platform/platform.css';
import accountCss from '../shared/account/account.css';
import socialCss from '../social/social.css';
import lammaCss from '../social/lamma.css';

const noop = () => {}, asyncNoop = async () => null;
function silentPreviewVoice() {
  const bytes = new Uint8Array(8044), view = new DataView(bytes.buffer);
  const text = (offset, value) => { for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index); };
  text(0, 'RIFF'); view.setUint32(4, 8036, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 8000, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true); text(36, 'data'); view.setUint32(40, 8000, true); bytes.fill(128, 44);
  return `data:audio/wav;base64,${btoa(String.fromCharCode(...bytes))}`;
}
const emptyStorage = { get: (_key, fallback) => fallback, set: () => true, remove: noop, clear: noop, keys: () => [], persistent: false };
const PEOPLE = [
  { id: 'studio-me', name: 'عبدالله', avatarPreset: 'falcon', theme: 'teal', online: true, code: 'MAYDAN01', avatar: 0 },
  { id: 'studio-sara', name: 'سارة', avatarPreset: 'cat', theme: 'rose', online: true, conversationId: 'studio-direct', unreadCount: 2, avatar: 1 },
  { id: 'studio-omar', name: 'عمر', avatarPreset: 'lion', theme: 'gold', online: true, conversationId: 'studio-direct-two', unreadCount: 0, avatar: 2 },
  { id: 'studio-lina', name: 'لينا', avatarPreset: 'owl', theme: 'violet', online: false, lastSeenAt: Date.now() - 3600000, unreadCount: 0, avatar: 3 },
];
const PROFILE = { ...PEOPLE[0], bio: 'اللّمّة الحلوة تبدأ بلعبة. أحب الرسم والتحديات والسوالف!', friendCount: 8, revision: 1, relationship: 'self', createdAt: 1780000000000, selectedTitle: 'companion', earnedTitles: ['member', 'distinctive', 'companion', 'host'], earnedBadges: ['welcome', 'identity', 'first-friend', 'host'], featuredBadges: ['welcome', 'first-friend', 'host'], stats: { localSessions: 12, onlineMatches: 28, onlineWins: 9, distinctGames: 7 }, achievements: [] };
const GROUP = { id: 'studio-group', name: 'شلّة الويكند', avatarPreset: 'controller', ownerId: PEOPLE[0].id, role: 'owner', memberCount: 4, unreadCount: 3, lastMessage: { text: 'مين جاهز للجولة الجاية؟', createdAt: Date.now() - 15000 } };
const members = PEOPLE.map((person, index) => ({ ...person, userId: person.id, user: person, role: index === 0 ? 'owner' : 'member', joinedAt: 1780000000000 }));
const fixtureMessages = () => [
  { seq: 1, senderId: PEOPLE[1].id, text: 'مساء الخير! شو نلعب اليوم؟', kind: 'text', createdAt: Date.now() - 80000, status: 'sent' },
  { seq: 2, senderId: PEOPLE[0].id, text: 'ارسمها؟ آخر مرة كانت الجولة رهيبة 😄', kind: 'text', createdAt: Date.now() - 65000, status: 'sent', read: true },
  { seq: 3, senderId: PEOPLE[1].id, text: 'يلا، ابعث الدعوة ونجمع الشباب.', kind: 'text', createdAt: Date.now() - 40000, status: 'sent' },
];
const PreviewContext = createContext(null);
export function PreviewProviders({ children, sceneId, previewState = 'normal' }) {
  const [settings, setSettingsState] = useState({ soundOn: true, soundVolume: .75, voiceOn: true, musicOn: true, musicVolume: .35, hapticsOn: true, reducedMotion: true });
  const [roster, setRoster] = useState(() => PEOPLE.map((person, index) => ({ ...person, emoji: index, color: ['#087d89', '#9250bd', '#b78118', '#c54543'][index] })));
  const [mine, setMine] = useState(PROFILE), [messages, setMessages] = useState(fixtureMessages);
  const [view, setView] = useState({ type: sceneId === 'social.conversation' ? 'direct' : 'list', id: PEOPLE[1].id, tab: 'friends' });
  const [listState, setListState] = useState({}), [drafts, setDrafts] = useState({}), [favorites, setFavorites] = useState([PEOPLE[1].id]);
  const [notifications, setNotifications] = useState({ enabled: true, previews: false, sound: true, mutedConversations: [] });
  const [callActive, setCallActive] = useState(sceneId === 'social.call'), [muted, setMuted] = useState(false), [speaking, setSpeaking] = useState(1);
  const [notice, setNotice] = useState(''), [paywall, setPaywall] = useState(false), [modalOpen, setModalOpen] = useState(true);
  const empty = previewState === 'empty', loading = previewState === 'loading', error = previewState === 'error', guest = previewState === 'guest';
  useEffect(() => { setView({ type: sceneId === 'social.conversation' || sceneId === 'social.voice' ? 'direct' : 'list', id: PEOPLE[1].id, tab: 'friends' }); setCallActive(sceneId === 'social.call'); setModalOpen(true); setPaywall(false); setNotice(''); }, [sceneId]);
  useEffect(() => { if (!callActive) return; const timer = setInterval(() => setSpeaking((value) => (value + 1) % PEOPLE.length), 1800); return () => clearInterval(timer); }, [callActive]);
  const notify = useCallback((message) => setNotice(message), []);
  const showFixtureAction = useCallback(() => { setNotice('هذا إجراء تجريبي داخل المعاينة فقط.'); return Promise.resolve(null); }, []);
  const loadProfile = useCallback(async () => PROFILE, []);
  const refresh = useCallback(async () => null, []);
  const account = useMemo(() => ({ ...NULL_ACCOUNT, ready: !loading, signedIn: !guest, user: guest ? null : PEOPLE[0], me: { user: PEOPLE[0], premium: { source: 'apple', active: false }, trials: {} }, platform: 'ios', productsStatus: 'ready', products: { monthly: { price: 'سعر معاينة', period: 'شهريًا' }, yearly: { price: 'سعر معاينة', period: 'سنويًا' } }, busy: '', offline: false, error: error ? 'NETWORK' : null, refresh, gameAccess: () => 'trial', trialAvailable: () => true, lockedPack: () => false, ensureTrial: async () => true, openPaywall: () => setPaywall(true), closePaywall: () => setPaywall(false), purchase: showFixtureAction, manageSubscription: showFixtureAction, restore: showFixtureAction, signIn: showFixtureAction, signOut: showFixtureAction, deleteAccount: showFixtureAction, requestAuthenticated: async () => { throw new Error('المعاينة لا تتصل بخدمات الحساب.'); }, authHeaders: () => ({}), loadProducts: refresh, retryProducts: refresh }), [loading, guest, error, refresh, showFixtureAction]);
  const socialActions = useMemo(() => ({ refresh, clearNotification: noop, openConversation: refresh, registerConversation: () => noop, setTyping: refresh, markRead: refresh, loadOlder: refresh, searchUsers: async () => PEOPLE.slice(1), sendRequest: showFixtureAction, acceptRequest: showFixtureAction, rejectRequest: showFixtureAction, cancelRequest: showFixtureAction, removeFriend: showFixtureAction, blockUser: showFixtureAction, unblockUser: showFixtureAction, reportUser: showFixtureAction, editMessage: async (_id, seq, text) => setMessages((current) => current.map((message) => message.seq === seq ? { ...message, text, editedAt: Date.now() } : message)), deleteMessage: async (_id, seq) => setMessages((current) => current.map((message) => message.seq === seq ? { ...message, deletedAt: Date.now() } : message)), sendMessage: async (_id, text) => { setMessages((current) => [...current, { seq: Date.now(), senderId: PEOPLE[0].id, text, kind: 'text', createdAt: Date.now(), status: 'sent' }]); return true; }, retryMessage: refresh }), [refresh, showFixtureAction]);
  const conversation = useMemo(() => ({ id: 'studio-direct', messages: empty ? [] : previewState === 'longText' ? messages.map((message) => ({ ...message, text: `${message.text} ${'هذا نص طويل لاختبار التفاف الأسطر وراحة القراءة. '.repeat(5)}` })) : messages, loading, loadingOlder: false, hasMore: false, error: error ? 'تعذّر الاتصال في المعاينة' : '', typing: false, readSeq: 3, peerReadSeq: 3, members }), [empty, previewState, messages, loading, error]);
  const social = useMemo(() => ({ ...socialActions, profile: mine, friends: empty ? [] : PEOPLE.slice(1), incoming: empty ? [] : [{ id: 'studio-request', user: PEOPLE[3], createdAt: Date.now() }], outgoing: [], blocked: [], conversationList: [{ id: 'studio-direct', user: PEOPLE[1] }], conversations: { [PEOPLE[1].id]: conversation }, loading, error: error ? 'تعذّر الاتصال. أعد المحاولة.' : '', offline: error, connected: !error, unreadCount: empty ? 0 : 2, notification: null }), [socialActions, mine, empty, conversation, loading, error]);
  const groupDetail = useMemo(() => ({ ...conversation, id: GROUP.id, group: GROUP, members, messages: conversation.messages }), [conversation]);
  const activeCall = useMemo(() => callActive ? { id: 'studio-call', scope: 'group', conversationId: GROUP.id, name: GROUP.name, status: 'active', initiatorId: PEOPLE[0].id, acceptedAt: Date.now() - 62000, _ownerId: PEOPLE[0].id } : null, [callActive]);
  const media = useMemo(() => ({ userId: PEOPLE[0].id, connected: callActive && !error, connecting: callActive && error, muted, audioBlocked: false, outputId: 'default', outputs: [{ deviceId: 'default', label: 'السماعة الافتراضية' }], participants: PEOPLE.map((person, index) => ({ ...person, identity: person.id, userId: person.id, isLocal: index === 0, speaking: index === speaking && (index !== 0 || !muted) && !error, muted: index === 0 ? muted : false, audioLevel: index === speaking ? .6 : 0 })) }), [error, muted, speaking, callActive]);
  const lammaActions = useMemo(() => ({ refreshGroups: refresh, createGroup: async () => ({ group: GROUP }), loadGroup: async () => groupDetail, selectGroup: () => noop, loadOlderGroup: refresh, markGroupRead: refresh, sendGroupMessage: socialActions.sendMessage, retryGroupMessage: refresh, inviteGroupMembers: showFixtureAction, removeGroupMember: showFixtureAction, leaveGroup: showFixtureAction, renameGroup: showFixtureAction, acceptGroupInvite: showFixtureAction, rejectGroupInvite: showFixtureAction, setGroupRole: showFixtureAction, transferGroupOwnership: showFixtureAction, changeGroupMessage: showFixtureAction, sendGameInvite: showFixtureAction, acceptGameInvite: showFixtureAction, rejectGameInvite: showFixtureAction, updateGroupAvatar: showFixtureAction, reportGroupMessage: showFixtureAction, getVoiceUrl: async () => silentPreviewVoice(), sendVoiceNote: showFixtureAction, setNotificationPreferences: async (patch) => setNotifications((current) => ({ ...current, ...patch })), setConversationMuted: showFixtureAction, requestNotifications: async () => ({ authorized: false }), loadCallMembers: async () => members, startCall: async () => setCallActive(true), acceptCall: async () => setCallActive(true), declineCall: showFixtureAction, endCall: async () => setCallActive(false), setCallMuted: async (value) => setMuted(Boolean(value)), setAudioOutput: showFixtureAction, resumeCallAudio: showFixtureAction, clearNotification: noop }), [refresh, groupDetail, socialActions.sendMessage, showFixtureAction]);
  const lamma = useMemo(() => ({ ...lammaActions, groups: empty ? [] : [GROUP], groupInvites: [], groupConversations: { [GROUP.id]: groupDetail }, callMembers: { [GROUP.id]: members }, calls: activeCall ? [activeCall] : [], activeCall, incomingCall: null, media, loading, error: '', offline: error, notifications, capabilities: { voiceMessages: false, liveCalls: true, pushNotifications: false }, notification: null }), [lammaActions, empty, groupDetail, activeCall, media, loading, error, notifications]);
  const ui = useMemo(() => ({ open: sceneId.startsWith('social.') && sceneId !== 'social.call', presentation: 'page', drawerOpen: false, view, favorites, drafts, listState, invite: null, show: (next) => setView(next || { type: 'list', tab: 'friends' }), close: () => setView({ type: 'list', tab: 'friends' }), back: () => setView({ type: 'list', tab: 'friends' }), openChat: (id) => setView({ type: 'direct', id }), openGroup: (id) => setView({ type: 'group', id }), openProfile: (id) => setView({ type: 'profile', id }), setDraft: (key, text) => setDrafts((current) => ({ ...current, [key]: text })), updateListState: (key, patch) => setListState((current) => ({ ...current, [key]: { ...current[key], ...patch } })), toggleFavorite: (id) => setFavorites((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]), clearInvite: noop }), [sceneId, view, favorites, drafts, listState]);
  const profiles = useMemo(() => ({ ready: !loading, mine: empty ? null : mine, profiles: { [PEOPLE[1].id]: { ...PROFILE, ...PEOPLE[1], relationship: 'friend' } }, errors: error ? { me: 'تعذّر عرض الملف في المعاينة.' } : {}, loading: {}, saving: false, loadProfile, saveProfile: async (patch) => { setMine((current) => ({ ...current, ...patch, revision: current.revision + 1 })); return { ...mine, ...patch }; }, uploadImage: showFixtureAction, removeImage: showFixtureAction, beginSession: asyncNoop, completeSession: asyncNoop }), [loading, empty, mine, error, loadProfile, showFixtureAction]);
  const platform = useMemo(() => ({ settings, setSettings: (patch) => setSettingsState((current) => ({ ...current, ...patch })), roster: empty ? [] : roster, setRoster, version: '1.8 · معاينة', storage: emptyStorage, storageFor: () => emptyStorage, sound: { play: noop, stop: noop, attach: noop, dispose: noop, enable: noop, volume: settings.soundVolume, setVolume: noop, setDucking: noop, voice: { enabled: settings.voiceOn, enable: noop }, music: { volume: settings.musicVolume, enable: noop, setVolume: noop, setScene: noop, stop: noop } }, haptics: { vibrate: noop, enable: noop }, toast: notify, confetti: noop }), [settings, empty, roster, notify]);
  const fixture = useMemo(() => ({ account, social, lamma, profiles, ui, notify, paywall, setPaywall, modalOpen, setModalOpen }), [account, social, lamma, profiles, ui, notify, paywall, modalOpen]);
  return <ToastProvider><PlatformContext.Provider value={platform}><AccountContext.Provider value={account}><SocialContext.Provider value={social}><LammaContext.Provider value={lamma}><SocialUIContext.Provider value={ui}><ProfileContext.Provider value={profiles}><PreviewContext.Provider value={fixture}><style>{tokensCss}{uiCss}{setupCss}{platformCss}{brandCss}{accountCss}{socialCss}{lammaCss}{`html,body{background:var(--bg);min-height:100%;}body{margin:0}.studio-platform-fixture{min-height:100dvh}.studio-fixture-banner{margin:12px 16px;padding:10px 14px;border:1px solid var(--stroke);border-radius:14px;font-size:12px;color:var(--muted);background:var(--surface)}.studio-preview-notice{position:fixed;bottom:15px;inset-inline:16px;background:var(--text);color:var(--bg);padding:13px 17px;border-radius:14px;z-index:99999;font-size:12px}.studio-fixture-profile-crop{display:block;width:100%;aspect-ratio:1;background:linear-gradient(135deg,#087d89,#d1ebbd)}`}</style><BrandFonts />{children}{notice && <button className="studio-preview-notice" onClick={() => setNotice('')}>{notice}</button>}{paywall && sceneId !== 'account.paywall' && <Paywall onClose={() => setPaywall(false)} />}</PreviewContext.Provider></ProfileContext.Provider></SocialUIContext.Provider></LammaContext.Provider></SocialContext.Provider></AccountContext.Provider></PlatformContext.Provider></ToastProvider>;
}

function PreviewProfileCrop({ fixture }) {
  const [image, setImage] = useState(null);
  useEffect(() => { const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 800; const context = canvas.getContext('2d'), gradient = context.createLinearGradient(0, 0, 800, 800); gradient.addColorStop(0, '#087d89'); gradient.addColorStop(1, '#9250bd'); context.fillStyle = gradient; context.fillRect(0, 0, 800, 800); context.fillStyle = '#fff7e7'; context.beginPath(); context.arc(400, 300, 120, 0, Math.PI * 2); context.fill(); context.beginPath(); context.ellipse(400, 720, 250, 240, 0, 0, Math.PI * 2); context.fill(); const url = canvas.toDataURL('image/png'), element = new Image(); element.src = url; element.onload = () => setImage({ width: 800, height: 800, url, element, dispose: noop }); return () => { element.onload = null; }; }, []);
  return image && fixture.modalOpen ? <CropDialog crop={{ kind: 'avatar', image }} profiles={fixture.profiles} revision={1} onClose={() => fixture.setModalOpen(false)} onDone={() => { fixture.setModalOpen(false); fixture.notify('عُدّل القص في المعاينة فقط.'); }} /> : <Card><p>اضبط صورة اللاعب التجريبية.</p><Button onClick={() => fixture.setModalOpen(true)}>فتح إطار القص</Button></Card>;
}

export function PlatformDesignScene({ sceneId, previewState = 'normal' }) {
  const fixture = useContext(PreviewContext);
  if (!fixture) throw new Error('PlatformDesignScene requires PreviewProviders');
  const { account, social, lamma, profiles, ui, notify, modalOpen, setModalOpen } = fixture;
  const close = () => setModalOpen(false);
  let content = null;
  if (sceneId === 'home') content = <Home />;
  else if (sceneId === 'settings') content = <Settings />;
  else if (sceneId === 'store') content = <Store />;
  else if (sceneId === 'game-details') content = <GameDetails id="ersomha" />;
  else if (sceneId === 'players') content = <Players />;
  else if (sceneId === 'about') content = <About />;
  else if (sceneId === 'audio-credits') content = <AudioCredits />;
  else if (sceneId === 'legal') content = <Privacy />;
  else if (sceneId === 'account.card') content = <Screen data-design-screen="account.card"><TopBar title="حساب ميدان" /><AccountCard /></Screen>;
  else if (sceneId === 'account.paywall') content = <><Home />{modalOpen ? <Paywall onClose={close} /> : <Button onClick={() => setModalOpen(true)}>فتح ميدان بلس</Button>}</>;
  else if (sceneId === 'profile') content = <ProfileScreen />;
  else if (sceneId === 'profile.editor') content = <><ProfileScreen />{modalOpen && <ProfileEditor profile={profiles.mine || PROFILE} profiles={profiles} onClose={close} onSaved={() => { close(); notify('حُفظ الملف التجريبي داخل المعاينة.'); }} />}</>;
  else if (sceneId === 'profile.crop') content = <PreviewProfileCrop fixture={fixture} />;
  else if (sceneId === 'profile.safety') content = <><ProfileScreen profileId={PEOPLE[1].id} />{modalOpen && <SafetyDialog action="report" profile={PEOPLE[1]} social={social} onClose={close} onDone={() => { close(); notify('هذا بلاغ تجريبي، ولم يُرسل لأي جهة.'); }} />}</>;
  else if (sceneId === 'social.group-editor') content = <><div className="studio-fixture-banner">معاينة إدارة الشلّة ببيانات تجريبية.</div>{modalOpen && <GroupEditor group={GROUP} detail={lamma.groupConversations[GROUP.id]} friends={social.friends} accountId={PEOPLE[0].id} lamma={lamma} onClose={close} onCreated={ui.openGroup} notify={notify} />}</>;
  else if (sceneId === 'social.preferences') content = modalOpen && <Preferences lamma={lamma} social={social} onClose={close} notify={notify} />;
  else if (sceneId === 'social.invite') content = modalOpen && <GameInviteDialog target={{ targetType: 'group', targetId: GROUP.id }} lamma={lamma} initialCode="123456" canCreate={false} memberCount={4} onClose={close} onLaunched={() => notify('الدعوة تجريبية فقط.')} notify={notify} />;
  else if (sceneId === 'social.search') content = modalOpen && <SearchDialog social={social} onClose={close} run={async (action) => action()} busy={false} onOpen={ui.openChat} onProfile={ui.openProfile} />;
  else if (sceneId === 'social.action') content = modalOpen && <ActionDialog action={{ kind: 'edit', user: PEOPLE[1], message: fixtureMessages()[1] }} social={social} onClose={close} onComplete={close} />;
  else if (sceneId === 'social.voice') content = <section data-design-screen="social.voice" className="lamma-host lamma-panel lamma-page-panel"><Conversation friend={PEOPLE[1]} designScreen={null} conversation={{ ...social.conversations[PEOPLE[1].id], messages: [...fixtureMessages(), { seq: 4, senderId: PEOPLE[1].id, createdAt: Date.now(), kind: 'voice', attachment: { id: 'studio-voice', durationMs: 12000 }, status: 'sent' }] }} account={account} social={social} onMenu={noop} onBack={noop} onAction={noop} notify={notify} draftValue={ui.drafts.voice || ''} onDraftChange={(text) => ui.setDraft('voice', text)} renderContent={(message) => message.kind === 'voice' ? <VoiceMessage attachment={message.attachment} getVoiceUrl={lamma.getVoiceUrl} /> : null} composerExtras={<LammaButton data-design-id="record" icon="mic" label="التسجيل الصوتي" onClick={() => notify('الميكروفون معزول داخل المعاينة. جرّب التسجيل الحقيقي على حساب التجربة.')} />} /></section>;
  else if (sceneId === 'social.call') content = <><Home />{lamma.activeCall && <CallControls call={lamma.activeCall} media={lamma.media} currentUserId={PEOPLE[0].id} privateTurn={false} panelOpen={false} onMute={lamma.setCallMuted} onEnd={lamma.endCall} onOpen={() => notify('محادثة الشلّة في المعاينة')} onOutput={lamma.setAudioOutput} onResume={lamma.resumeCallAudio} />}</>;
  else if (sceneId.startsWith('social.')) content = <><div data-social-page-slot /><SocialHost /></>;
  else if (sceneId === 'shell.navigation') content = <><Home /><BottomNavigation route={{ name: 'home', path: '/', params: {} }} /></>;
  else if (sceneId === 'shell.game-frame') content = <GameFrame game={getGame('fabraka')} inGame exitMessage="هذا خروج تجريبي من المعاينة فقط." onExit={() => notify('انتهت المعاينة التجريبية.')}><Card data-design-id="privacy"><Avatar index={1} /><h2>هذا دورك السري</h2><p>أعطِ الهاتف لصاحب الدور قبل المتابعة.</p><Button data-design-id="continue" variant="primary" onClick={() => notify('ستار الدور التجريبي')}>أنا جاهز</Button></Card></GameFrame>;
  else if (sceneId === 'system.dialog') content = <><Home />{modalOpen && <ConfirmModal title="تغادر المباراة؟" message="تبقى نتائج الأدوار المكتملة محفوظة. يمكنك العودة إلى القوائم." confirmLabel="غادر المباراة" cancelLabel="نكمل اللعب" onConfirm={close} onCancel={close} />}</>;
  else if (sceneId === 'system.sheet') content = <><Home /><Sheet open={modalOpen} onClose={close} title="خيارات ميدان"><Card><h3>على راحتك</h3><p>اختبر شكل الورقة السفلية والأزرار قبل اعتماد التصميم.</p><Button data-design-id="confirm" variant="primary" onClick={close}>تأكيد</Button><Button data-design-id="cancel" variant="ghost" onClick={close}>إلغاء</Button></Card></Sheet></>;
  else return null;
  return <div className={`studio-platform-fixture${previewState === 'longText' ? ' is-long-text' : ''}`} data-preview-fixture="platform">{content}</div>;
}
