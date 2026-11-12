import { tr, getUiLocale, localeDirection } from '../shared/i18n/core.js';
import { MafiaSettings } from '../online/Mafia.jsx';
import { BadeehaSettings, normalizeBadeehaOptions, buildBadeehaRoom, badeehaReady } from '../online/Badeeha.jsx';
import { CATS } from '../data/categories/index.js';
import { readBadeehaState } from '../games/badeeha/persistence.js';
import { readSaved, save } from '../online/client.js';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useAccount } from '../shared/account/context.js';
import { resolveAccountServer } from '../shared/account/api.js';
import { SignInSheet } from '../shared/account/SignInSheet.jsx';
import { Button, Modal, Sheet } from '../shared/ui/components.jsx';
import { useVisualViewport } from '../shared/ui/useVisualViewport.js';
import { activateDialog } from '../shared/ui/dialog-interaction.js';
import { usePlatform } from '../platform/context.js';
import { navigate, useRoute } from '../platform/router.js';
import { useProfiles } from '../profiles/ProfileProvider.jsx';
import { ProfileView } from '../profiles/ProfileScreen.jsx';
import { ProfileAvatar } from '../profiles/ProfileAvatar.jsx';
import { PlayerName } from '../profiles/PlayerIdentity.jsx';
import { AVATAR_PRESETS } from '../profiles/catalog.js';
import { normalizeCode, validCode } from '../online/shared.js';
import { useSocial } from './SocialProvider.jsx';
import { useSocialUI, conversationDraftKey } from './SocialUIProvider.jsx';
import { useLamma } from './LammaProvider.jsx';
import { socialInterruption } from './interruption.js';
import { CallControls } from './CallDock.jsx';
import { useCallDockLayout } from './CallViewport.jsx';
import { hasVisibleMafiaCallControls } from './mafia-call-controls.js';
import { ActionDialog, Conversation, PersonAvatar, SearchDialog, presenceLabel } from './SocialScreen.jsx';
import { LammaButton, LammaIcon, VoiceRecorder, VoiceMessage, GameInviteCard, mediaError } from './LammaMedia.jsx';
import { createSocialNotificationAudio } from './media.js';
import { liveNotificationAudio,confirmSocialSend } from './audio-feedback.js';
import { useSocialSendAudio } from './useSocialSendAudio.js';
import { createSocialGameLauncher } from './game-launch.js';
import { errorText as roomErrorText } from '../online/shared.js';
import socialCss from './social.css';
import lammaCss from './lamma.css?sheet';
import { PresentationStyles } from '../shared/ui/PresentationStyles.jsx';
import friendsChatIllustration from '../shared/brand/assets/friends-chat-20261103.webp';

const EMPTY = [];
const nameOf = user => user?.name?.trim() || tr("لاعب ميدان");
export const groupMemberCount = group => group?.memberCount ?? group?.members?.length ?? 0;
export const groupPreview = group => group?.lastMessage?.deletedAt ? tr("حُذفت رسالة") : group?.lastMessage?.kind === 'voice' ? tr("رسالة صوتية") : ['game_invite', 'room_invite'].includes(group?.lastMessage?.kind) ? tr("دعوة للّعب") : group?.lastMessage?.text || tr("{v0} من الأصحاب", {v0: groupMemberCount(group).toLocaleString(getUiLocale())});
export const isConversationMuted = (preferences, scope, conversationId) => (preferences?.mutedConversations || []).some(item => item.scope === scope && item.conversationId === conversationId);

function Empty({ title, children, icon = 'people', illustration = false, action }) {
  return <div className="lamma-empty">{illustration ? <img className="lamma-empty-art" src={friendsChatIllustration} width="108" height="108" alt="" aria-hidden="true" /> : <span><LammaIcon name={icon} size={36} /></span>}<h3>{title}</h3><p>{children}</p>{action}</div>;
}
function GroupAvatar({ group, size = 44 }) {
  return <span className="lamma-group-avatar" style={{ width: size, height: size }} aria-hidden="true">{group?.avatarPreset ? <ProfileAvatar user={{ avatarPreset: group.avatarPreset, theme: 'teal' }} size={size} /> : <LammaIcon name="people" size={Math.round(size * .55)} />}</span>;
}
export function FriendListItem({ friend, onChat, onProfile, onInvite, inviting, favorite = false, onFavorite }) {
  const message = friend.lastMessage;
  const preview = message?.deletedAt ? tr("حُذفت رسالة") : message?.kind === 'voice' ? tr("رسالة صوتية") : ['game_invite', 'room_invite'].includes(message?.kind) ? tr("دعوة للّعب") : message?.text;
  return <div data-design-id="friend-row" className="lamma-friend-row"><button type="button" data-design-id="friend-avatar" className="lamma-avatar-link" aria-label={tr("عرض بروفايل ") + nameOf(friend)} onClick={onProfile}><PersonAvatar user={friend} presence /></button><button type="button" data-design-id="friend-chat" className="lamma-person-copy" onClick={onChat}><strong><PlayerName user={friend} card compact />{friend.unreadCount > 0 && <b className="lamma-unread">{friend.unreadCount > 99 ? '99+' : friend.unreadCount}</b>}</strong><small>{preview || presenceLabel(friend)}</small></button>{onFavorite && <LammaButton data-design-id="favorite" className={'lamma-favorite' + (favorite ? ' is-favorite' : '')} label={(favorite ? tr("إزالة ") : tr("إضافة ")) + nameOf(friend) + (favorite ? tr(" من المفضّلين") : tr(" إلى المفضّلين"))} icon="star" aria-pressed={favorite} onClick={onFavorite} />}{onInvite ? <button type="button" data-design-id="friend-invite" data-sound="none" className="lamma-small-primary" onClick={onInvite} disabled={inviting}>{tr("دعوة")}</button> : <LammaButton label={tr("محادثة مع ") + nameOf(friend)} icon="chat" onClick={onChat} />}</div>;
}

function ProfilePreview({ id, onBack, onInvite, run }) {
  const account = useAccount(); const profiles = useProfiles(); const social = useSocial(); const ui = useSocialUI(); const lamma = useLamma();
  const friend = social.friends.find(item => item.id === id);
  const conversationId = friend?.conversationId || social.conversationList.find(item => item.user?.id === id)?.id;
  const move = path => {
    if (path.startsWith('/friends/')) ui.openChat(decodeURIComponent(path.slice(9)));
    else onBack();
  };
  return <div className="lamma-profile-preview">{friend && <div className="lamma-profile-actions"><button data-design-id="call" type="button" disabled={!lamma.capabilities?.liveCalls || !!lamma.activeCall || !conversationId} onClick={() => run(() => lamma.startCall({ targetType: 'direct', targetId: conversationId }), 'profile-call')}><LammaIcon name="phone" size={18} />{tr("مكالمة صوتية")}</button><button data-design-id="game-invite" type="button" disabled={!conversationId} onClick={() => onInvite({ targetType: 'direct', targetId: conversationId })}><LammaIcon name="game" size={18} />{tr("دعوة للعبة")}</button></div>}<ProfileView account={account} profiles={profiles} social={social} profileId={id} onNavigate={move} /></div>;
}

export function GameInviteDialog({ target, lamma, initialCode = '', canCreate = true, memberCount = 2, onClose, onLaunched, notify }) {
  const account = useAccount();
  const sendAudio=useSocialSendAudio(account.user?.id,target.targetType,target.targetId);
  const sendGameInvite=payload=>confirmSocialSend(sendAudio,{scope:payload.targetType,id:payload.targetId},()=>lamma.sendGameInvite(payload));
  const [mode, setMode] = useState(initialCode || !canCreate ? 'existing' : 'create');
  const [game, setGame] = useState(memberCount > 8 ? 'meenfina' : 'fabraka');
  const [mafiaSettings,setMafiaSettings] = useState({mode:memberCount>8?'shadow':'classic',capacity:memberCount>8?Math.max(10,Math.min(12,memberCount)):8,visibility:'private'});
  // The same saved choice as the rooms screen: the host's last six categories.
  const [badeehaSettings, setBadeehaSettings] = useState(() => normalizeBadeehaOptions(readSaved(resolveAccountServer(), 'badeehaSettings')));
  const badeehaOk = useMemo(() => game === 'badeeha' && badeehaSettings.categories.length === 6 && badeehaReady(badeehaSettings).ok, [game, badeehaSettings]);
  const [code, setCode] = useState(initialCode); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [created, setCreated] = useState(null);
  const alive = useRef(true); const owner = useRef(account.user?.id); owner.current = account.user?.id;
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const launcher = useRef(null);
  if (!launcher.current) { const id = account.user?.id; launcher.current = createSocialGameLauncher({ account, target, server: resolveAccountServer(), isCurrent: () => alive.current && owner.current === id }); }
  const submit = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (mode === 'create') {
        let settings = game === 'mafia' ? mafiaSettings : null;
        // A Badeeha round is dealt on the host's phone from its own bank and history, as on the rooms screen.
        if (game === 'badeeha' && !launcher.current.room) {
          settings = buildBadeehaRoom(badeehaSettings, readBadeehaState(CATS).history);
        }
        const room = await launcher.current.launch(game, sendGameInvite, settings ? { settings } : {});
        if (!alive.current) return;
        notify(tr("وصلت الدعوة، ننتظركم في الغرفة")); onClose(); onLaunched(room.code);
      } else {
        await sendGameInvite({ ...target, roomCode: normalizeCode(code) });
        if (alive.current) { notify(tr("وصلت دعوة اللعب")); onClose(); }
      }
    } catch (err) {
      if (!alive.current) return;
      setCreated(launcher.current.room);
      if (err.code === 'PLUS_REQUIRED') setError(roomErrorText('UPDATE_REQUIRED'));
      else setError(/[\u0600-\u06ff]/.test(err.message || '') ? err.message : roomErrorText(err.code));
    } finally { if (alive.current) setBusy(false); }
  };
  return <Modal data-design-screen="social.invite" title={tr("يلا نلعب")} className="lamma-dialog lamma-game-dialog" onClose={busy ? null : onClose} footer={<><Button data-design-id="cancel" variant="ghost" disabled={busy} onClick={onClose}>{tr("إلغاء")}</Button><Button data-design-id="submit" data-sound="none" variant="primary" disabled={busy || (mode === 'existing' && !validCode(normalizeCode(code))) || (mode === 'create' && game === 'badeeha' && !created && !badeehaOk)} loading={busy} onClick={submit}>{mode === 'existing' || created ? tr("إرسال الدعوة") : tr("ابدأ وادعُ أصحابك")}</Button></>}>
    {mode === 'create' ? <>
      <p className="lamma-muted">{tr("اختر اللعبة. نجهّز الغرفة ونرسل دعوتها هنا، وكل واحد يدخل من جواله. ")}{game === 'mafia' ? tr("عند البداية ينتقل المشاركون إلى صوت المجلس الآمن، وبقية الشلة تبقى في مكالمتها.") : tr("مكالمتكم تبقى معكم.")}</p>
      <div data-design-id="options-list" className="lamma-game-options" role="group" aria-label={tr("اختيار لعبة للّمة")}>{[['badeeha', tr("بَديهة"), tr("من فريقين إلى ٤"), tr("جوال لكل فريق — ست فئات وأسئلة بالنقاط")], ['mafia', tr("مافيا ميدان"), tr("من ٦ إلى ١٢"), tr("مجلس صوتي وأدوار سرية — يبدأ الأساسي من ٦")], ['ersomha', tr("ارسمها"), tr("من شخصين إلى ٨"), tr("رسم حي وتخمين متزامن — تعاون لشخصين")], ['fabraka', tr("فبركة"), tr("من شخصين إلى ٨"), tr("حقيقة بين إجابات مضحكة — ٣ جولات")], ['meenfina', tr("مين فينا"), tr("من ٣ إلى ١٢"), tr("تصويت سري وأسئلة تعرفكم على بعض")]].map(([id, name, count, description]) => <button data-design-id="game-choice" type="button" key={id} aria-pressed={game === id} disabled={busy || !!created} onClick={() => setGame(id)}><LammaIcon name="game" size={27} /><strong>{name}</strong><span>{count}</span><small>{description}</small></button>)}</div>
      {game === 'mafia' && !created && <MafiaSettings value={mafiaSettings} onChange={setMafiaSettings} disabled={busy}/>}
      {game === 'badeeha' && !created && <BadeehaSettings value={badeehaSettings} disabled={busy} onChange={next => { setBadeehaSettings(next); save(resolveAccountServer(), 'badeehaSettings', next); }} />}
      {created && <p role="status" className="lamma-muted">{tr("الغرفة ")}<bdi>{created.code}</bdi>{tr(" جاهزة. أعد إرسال الدعوة؛ لن ننشئ غرفة ثانية.")}</p>}
      {!created && <button data-design-id="entry-join" type="button" className="lamma-text-button" disabled={busy} onClick={() => { setMode('existing'); setError(''); }}>{tr("عندي رمز غرفة")}</button>}
    </> : <>
      <p className="lamma-muted">{tr("أرسل دعوة لغرفة أنت موجود فيها.")}</p><label className="lamma-field">{tr("رمز الغرفة")}<input data-design-id="room-code" inputMode="numeric" autoComplete="off" maxLength={6} dir="ltr" disabled={busy} value={code} onChange={event => setCode(normalizeCode(event.target.value))} placeholder="000000" /></label>
      {canCreate && <button data-design-id="entry-create" type="button" className="lamma-text-button" disabled={busy} onClick={() => { setMode('create'); setError(''); }}>{tr("ابدأ غرفة جديدة بدلًا منها")}</button>}
    </>}
    {error && <p className="lamma-error" role="alert">{error}</p>}
  </Modal>;
}

export function GroupEditor({ group, detail, friends, accountId, lamma, onClose, onCreated, notify, onPlay, onCall, callDisabled = false }) {
  const [name, setName] = useState(group?.name || '');
  const [avatar, setAvatar] = useState(group?.avatarPreset || AVATAR_PRESETS[0].id);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [managing, setManaging] = useState(false);
  const members = detail?.members || group?.members || EMPTY;
  const invitations = detail?.invitations || EMPTY;
  const mine = members.find(member => (member.userId || member.id) === accountId);
  const owner = group?.ownerId === accountId || mine?.role === 'owner' || group?.role === 'owner';
  const admin = !group || owner || mine?.role === 'admin' || group?.role === 'admin';
  const existing = new Set([...members.map(member => member.userId || member.id), ...invitations.filter(item => !item.status || item.status === 'pending').map(item => item.userId || item.inviteeId)]);
  const available = friends.filter(friend => !existing.has(friend.id));
  const capacity = Math.max(0, 12 - (group ? Math.max(groupMemberCount(group), members.length) + invitations.filter(item => !item.status || item.status === 'pending').length : 1));
  const act = async (key, work, message) => {
    if (busy) return;
    setBusy(key); setError('');
    try { const result = await work(); if (message) notify(message); return result; }
    catch (err) { setError(mediaError(err)); return false; }
    finally { setBusy(''); }
  };
  const save = async () => {
    if (!name.trim()) { setError(tr("اكتب اسمًا للّمة.")); return; }
    if (!group) {
      const result = await act('save', () => lamma.createGroup({ name: name.trim(), memberIds: selected }));
      if (result) { const id = result.group?.id || result.id; await act('avatar', () => lamma.updateGroupAvatar(id, avatar)); if (result.failedInvites?.length) notify(tr("أُنشئت اللّمة، لكن بعض الدعوات لم تصل. أعد إرسالها من إدارة اللّمة."), true); onCreated(id); onClose(); }
    } else {
      const result = await act('save', async () => {
        if (name.trim() !== group.name) await lamma.renameGroup(group.id, name.trim());
        if (avatar !== group.avatarPreset) await lamma.updateGroupAvatar(group.id, avatar);
        if (selected.length) await lamma.inviteGroupMembers(group.id, selected);
        await lamma.loadGroup(group.id); return true;
      }, tr("حُفظت اللّمة وأُرسلت الدعوات"));
      if (result) onClose();
    }
  };
  if (group && !managing) return <Modal data-design-screen="social.group-editor" title={tr("تفاصيل الشلّة")} className="lamma-dialog lamma-group-details" onClose={onClose}>
    <div className="lamma-dialog-intro"><GroupAvatar group={group} size={52} /><div><strong>{group.name}</strong><p>{tr("محادثات وصوت ولعب معًا")}</p></div></div>
    <section data-design-id="members" className="lamma-group-members">
      <h3>{tr("الأعضاء (")}{groupMemberCount(group) || members.length})</h3>
      {members.length ? <ul>{members.map(member => {
        const user = member.user || member.profile || member;
        return <li key={member.userId || member.id}><ProfileAvatar user={user} size={38} /><PlayerName user={user} card compact /></li>;
      })}</ul> : <p className="lamma-muted">{tr("تفاصيل الأعضاء قيد التحميل.")}</p>}
    </section>
    {(onPlay || onCall) && <div className="lamma-group-actions">{onPlay && <Button variant="accent" icon={<LammaIcon name="game" />} onClick={onPlay}>{tr("العبوا سوا")}</Button>}{onCall && <Button variant="secondary" icon={<LammaIcon name="phone" />} disabled={callDisabled} onClick={onCall}>{tr("مكالمة")}</Button>}</div>}
    <Button data-design-id="group-manage" variant="secondary" full onClick={() => setManaging(true)}>{admin ? tr("إدارة الشلّة") : tr("خيارات العضوية")}</Button>
  </Modal>;
  return <><Modal data-design-screen="social.group-editor" title={group ? tr("إدارة الشلّة") : tr("تكوين شلّة جديدة")} className="lamma-dialog lamma-group-editor" onClose={busy ? null : onClose} footer={admin ? <><Button data-design-id="cancel" variant="ghost" disabled={!!busy} onClick={onClose}>{tr("إغلاق")}</Button><Button data-design-id="save" variant="primary" loading={busy === 'save'} disabled={!!busy || !name.trim()} onClick={save}>{group ? tr("حفظ وإرسال الدعوات") : tr("إنشاء الشلّة")}</Button></> : null}>
    {group && <div className="lamma-dialog-intro"><GroupAvatar group={group} size={52} /><div><strong>{group.name}</strong><p>{tr("محادثات وصوت ولعب معًا")}</p></div></div>}
    <label className="lamma-field">{tr("اسم اللّمة")}<input data-design-id="group-name" value={name} maxLength={50} disabled={!admin || !!busy} placeholder={tr("مثلًا: شلّة الخميس")} onChange={event => setName(event.target.value)} /></label>
    {admin && <div className="lamma-group-presets" role="group" aria-label={tr("صورة اللّمة")}>{AVATAR_PRESETS.map(preset => <button data-design-id="avatar-choice" type="button" key={preset.id} aria-label={tr(preset.label)} aria-pressed={avatar === preset.id} disabled={!!busy} onClick={() => setAvatar(preset.id)}><ProfileAvatar user={{ avatarPreset: preset.id }} size={37} /></button>)}</div>}
    {group && <div data-design-id="members" className="lamma-members"><h3>{tr("الأعضاء ")}<span>{members.length} / 12</span></h3>{members.map(member => {
      const id = member.userId || member.id; const user = member.user || member.profile || member; const isMe = id === accountId;
      return <div key={id} data-design-id="member" className="lamma-member"><ProfileAvatar user={user} size={36} /><div><strong><PlayerName user={user} name={nameOf(user) + (isMe ? tr(" (أنت)") : '')} card compact /></strong><small>{member.role === 'owner' ? tr("صاحب اللّمة") : member.role === 'admin' ? tr("مشرف") : tr("عضو")}</small></div>{owner && !isMe && <select data-design-id="member-role" aria-label={tr("صلاحية ") + nameOf(user)} value={member.role || 'member'} disabled={!!busy} onChange={event => act('role-' + id, () => lamma.setGroupRole(group.id, id, event.target.value), tr("حُدّثت الصلاحية"))}><option value="member">{tr("عضو")}</option><option value="admin">{tr("مشرف")}</option></select>}{admin && !isMe && member.role !== 'owner' && (owner || member.role !== 'admin') && <LammaButton label={tr("إزالة ") + nameOf(user)} icon="close" disabled={!!busy} onClick={() => setConfirm({ kind: 'remove', id, name: nameOf(user) })} />}{owner && !isMe && <button data-design-id="member-transfer" type="button" className="lamma-text-button" disabled={!!busy} onClick={() => setConfirm({ kind: 'transfer', id, name: nameOf(user) })}>{tr("نقل الملكية")}</button>}</div>;
    })}</div>}
    {admin && <section data-design-id="member-picker" className="lamma-member-picker"><h3>{group ? tr("ادعُ أصحابك") : tr("من يكون معك؟")} <small>{selected.length} / {capacity}</small></h3>{available.length ? available.map(friend => <label key={friend.id} className="lamma-pick-person"><ProfileAvatar user={friend} size={36} /><span><PlayerName user={friend} card compact /></span><input data-design-id="member-select" type="checkbox" checked={selected.includes(friend.id)} disabled={!!busy || (!selected.includes(friend.id) && selected.length >= capacity)} onChange={() => setSelected(list => list.includes(friend.id) ? list.filter(id => id !== friend.id) : [...list, friend.id])} /></label>) : <p className="lamma-muted">{group ? tr("كل أصحابك موجودون أو وصلتهم دعوة.") : tr("يمكنك إنشاء اللّمة الآن ودعوة أصحابك لاحقًا.")}</p>}</section>}
    {!group && selected.length > 0 && <div className="lamma-selected-members"><b>{tr("الأعضاء المختارون (")}{selected.length})</b><div>{available.filter(friend => selected.includes(friend.id)).map(friend => <ProfileAvatar key={friend.id} user={friend} size={32} />)}</div></div>}
    {!group && <p className="lamma-group-limit"><LammaIcon name="people" size={19} />{tr("يمكن أن تضم الشلّة حتى ١٢ عضوًا، بمن فيهم أنت.")}</p>}
    {invitations.length > 0 && <p className="lamma-muted">{invitations.length}{tr(" دعوة بانتظار الرد")}</p>}
    {group && <button type="button" data-design-id="leave-group" data-design-required="true" className="lamma-leave" disabled={!!busy || (owner && members.length > 1)} onClick={() => setConfirm({ kind: 'leave' })}>{tr("مغادرة اللّمة")}</button>}{group && owner && members.length > 1 && <p className="lamma-muted">{tr("انقل ملكية اللّمة لأحد أعضائها قبل المغادرة.")}</p>}
    {error && <p role="alert" className="lamma-error">{error}</p>}
  </Modal>{confirm && <Modal title={confirm.kind === 'leave' ? tr("تغادر اللّمة؟") : confirm.kind === 'transfer' ? tr("تنقل ملكية اللّمة؟") : tr("تزيل العضو؟")} className="lamma-dialog" onClose={busy ? null : () => setConfirm(null)} footer={<><Button data-design-id="cancel" variant="ghost" disabled={!!busy} onClick={() => setConfirm(null)}>{tr("إلغاء")}</Button><Button data-design-id="confirm" variant="danger" loading={!!busy} onClick={async () => { const done = await act('confirm', () => confirm.kind === 'leave' ? lamma.leaveGroup(group.id) : confirm.kind === 'transfer' ? lamma.transferGroupOwnership(group.id, confirm.id) : lamma.removeGroupMember(group.id, confirm.id)); if (done !== false) { setConfirm(null); if (confirm.kind === 'leave') onClose(); else await lamma.loadGroup(group.id); } }}>{tr("تأكيد")}</Button></>}><p>{confirm.kind === 'leave' ? tr("يمكن لأصحابك دعوتك مرة أخرى.") : confirm.kind === 'transfer' ? tr("{v0} سيصبح صاحب اللّمة، وتصبح عضوًا فيها.", {v0: confirm.name}) : tr("{v0} لن يتمكن من قراءة الرسائل الجديدة في هذه اللّمة.", {v0: confirm.name})}</p></Modal>}</>;
}

export { CallControls } from './CallDock.jsx';

export function Preferences({ lamma, social, onClose, notify }) {
  const [busy, setBusy] = useState(false);
  const preferences = lamma.notifications || {};
  const change = async patch => {
    setBusy(true);
    try { await lamma.setNotificationPreferences(patch); }
    catch (error) { notify(mediaError(error), true); }
    finally { setBusy(false); }
  };
  const requestPermission = async () => {
    setBusy(true);
    try {
      const result = await lamma.requestNotifications();
      notify(result?.authorized ? tr("فُعّلت التنبيهات على الجهاز") : tr("لم يُمنح إذن التنبيهات. يمكنك تفعيله من إعدادات الجهاز."), !result?.authorized);
    } catch (error) { notify(mediaError(error), true); }
    finally { setBusy(false); }
  };
  const options = [
    ['messages', tr("الرسائل"), tr("يشمل الرسائل ودعوات الألعاب داخل المحادثات.")],
    ['groupInvites', tr("دعوات الشِّلَل"), tr("عندما يدعوك أحد إلى شلّته.")],
    ['friendRequests', tr("طلبات الصداقة"), tr("عندما يصلك طلب صداقة جديد.")],
    ['calls', tr("المكالمات"), tr("تنبيه الجهاز للمكالمات الواردة.")],
    ['previews', tr("معاينة الرسالة"), tr("تظل المعاينات مخفية أثناء اللعب على جهاز مشترك.")],
    ['sound', tr("الصوت"), tr("تشغيل نغمة التنبيه عند وصول رسالة.")],
  ];
  const available = lamma.capabilities?.pushNotifications;
  return <Modal data-design-screen="social.preferences" title={tr("تفضيلات الإشعارات")} className="lamma-dialog lamma-preferences" onClose={onClose} footer={<Button data-design-id="continue" variant="accent" full onClick={onClose}>{tr("تم")}</Button>}>
    <p className="lamma-preference-status" role="status"><LammaIcon name="bell" size={19} />{available ? tr("تنبيهات الجهاز تخضع لإذن النظام.") : tr("تصل التنبيهات داخل ميدان أثناء استخدامه.")}</p>
    {options.map(([key, title, description]) => <label data-design-id="notification-setting" className="lamma-toggle" key={key}><span><strong>{title}</strong><small>{description}</small></span><input data-design-id="notification-toggle" type="checkbox" role="switch" checked={!!(preferences[key] ?? preferences.enabled)} disabled={busy} onChange={event => change({ [key]: event.target.checked })} /></label>)}
    {available && <Button data-design-id="notification-enable" variant="secondary" full disabled={busy} onClick={requestPermission}>{tr("تفعيل التنبيهات على هذا الجهاز")}</Button>}
    <p className="lamma-muted">{tr("تُحفظ اختيارات الإشعارات عند تغييرها.")}</p>
    {social.blocked?.length > 0 && <section data-design-id="members" className="lamma-members"><h3>{tr("الحسابات المحظورة")}</h3>{social.blocked.map(user => <div data-design-id="member" className="lamma-member" key={user.id}><ProfileAvatar user={user} size={36} /><div><strong><PlayerName user={user} card compact /></strong></div><Button data-design-id="unblock" variant="ghost" size="sm" disabled={busy} onClick={async () => { setBusy(true); try { await social.unblockUser(user.id); notify(tr("أُلغي حظر الحساب")); } catch (error) { notify(mediaError(error), true); } finally { setBusy(false); } }}>{tr("إلغاء الحظر")}</Button></div>)}</section>}
  </Modal>;
}

function GroupMessageAction({ action, lamma, social, onClose, notify }) {
  const [text, setText] = useState(action.kind === 'report' ? '' : action.message.text || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const editing = action.kind === 'edit';
  if (action.kind === 'report') return <Modal data-design-screen="social.action" title={tr("الإبلاغ عن الرسالة")} className="lamma-dialog" onClose={busy ? null : onClose} footer={<><Button data-design-id="cancel" variant="ghost" disabled={busy} onClick={onClose}>{tr("إلغاء")}</Button><Button data-design-id="confirm" variant="primary" loading={busy} disabled={!text.trim()} onClick={async () => { setBusy(true); try { await lamma.reportGroupMessage(action.groupId, action.message.seq, text.trim()); notify(tr("وصل بلاغك. لن يعرف المرسل من أبلغ.")); onClose(); } catch (err) { setError(mediaError(err)); } finally { setBusy(false); } }}>{tr("إرسال البلاغ")}</Button></>}><label className="lamma-field">{tr("سبب الإبلاغ")}<select data-design-id="report-reason" value={text} onChange={event => setText(event.target.value)}><option value="">{tr("اختر السبب")}</option>{[tr("رسائل مزعجة"), tr("إساءة أو تنمر"), tr("محتوى غير مناسب"), tr("سبب آخر")].map(reason => <option key={reason}>{reason}</option>)}</select></label>{error && <p className="lamma-error" role="alert">{error}</p>}</Modal>;
  return <Modal data-design-screen="social.action" title={editing ? tr("تعديل الرسالة") : tr("حذف الرسالة؟")} className="lamma-dialog" onClose={busy ? null : onClose} footer={<><Button data-design-id="cancel" variant="ghost" disabled={busy} onClick={onClose}>{tr("إلغاء")}</Button><Button data-design-id="confirm" variant={editing ? 'primary' : 'danger'} loading={busy} disabled={editing && !text.trim()} onClick={async () => { setBusy(true); try { await lamma.changeGroupMessage(action.groupId, action.message.seq, editing ? text.trim() : null); onClose(); } catch (err) { setError(mediaError(err)); } finally { setBusy(false); } }}>{editing ? tr("حفظ") : tr("حذف")}</Button></>}>{editing ? <textarea data-design-id="message-input" className="lamma-edit-message" value={text} maxLength={2000} rows={4} onChange={event => setText(event.target.value)} aria-label={tr("نص الرسالة")} /> : <p>{tr("ستظهر مكانها عبارة «حُذفت هذه الرسالة».")}</p>}{error && <p className="lamma-error" role="alert">{error}</p>}</Modal>;
}

export function SocialHost() {
  const account = useAccount(); const social = useSocial(); const ui = useSocialUI(); const lamma = useLamma();
  const { open: panelOpen, drawerOpen, close: closePanel, show: showPanel, openChat, openGroup } = ui;
  const { selectGroup, loadGroup, loadOlderGroup, sendGroupMessage, sendGroupSticker, retryGroupMessage, markGroupRead, offline: groupOffline } = lamma;
  const profiles = useProfiles(); const route = useRoute(); const { sound } = usePlatform();
  const interruption = useSyncExternalStore(socialInterruption.subscribe, socialInterruption.getSnapshot, socialInterruption.getSnapshot);
  // Server-reported account leases cover other devices before the provider effect runs.
  const communicationLocked = interruption.communicationLocked || social.mafiaCommunicationLocked === true;
  const [search, setSearch] = useState(false); const [signIn, setSignIn] = useState(false);
  const [preferences, setPreferences] = useState(false); const [groupEditor, setGroupEditor] = useState(null);
  const [inviteTarget, setInviteTarget] = useState(null);
  const [menu, setMenu] = useState(null); const [action, setAction] = useState(null);
  const [busy, setBusy] = useState(''); const [notice, setNotice] = useState(null);
  const [dialogOwner, setDialogOwner] = useState(account.user?.id);
  const dialogsOwned = dialogOwner === account.user?.id && !communicationLocked;
  const [host] = useState(() => typeof document === 'undefined' ? null : document.createElement('div'));
  const [callInlineHost, setCallInlineHost] = useState(null);
  const [pageHost, setPageHost] = useState(null);
  const [gameLauncherHost, setGameLauncherHost] = useState(null);
  const [mafiaControlsOwnCall, setMafiaControlsOwnCall] = useState(false);
  const listScroll = useRef(null);
  const panel = useRef(null); const trigger = useRef(null); const noticeTimer = useRef(null);
  const friends = social.friends || EMPTY; const groups = lamma.groups || EMPTY; const invites = lamma.groupInvites || EMPTY;
  const view = ui.view;
  const filter = ui.listState[view.tab]?.filter || '';
  const listScrollTop = ui.listState[view.tab]?.scrollTop || 0;
  const friendFilter = ui.listState.friends?.friendFilter || 'all';
  const setFilter = value => ui.updateListState(view.tab, { filter: value, scrollTop: 0 });
  const setFriendFilter = value => ui.updateListState('friends', { friendFilter: value, scrollTop: 0 });
  const friend = view.type === 'direct' ? friends.find(item => item.id === view.id) : null;
  const group = view.type === 'group' ? groups.find(item => item.id === view.id) : null;
  const groupChat = lamma.groupConversations?.[view.id];
  const currentCall = lamma.activeCall;
  const currentCallId = currentCall?.id, currentCallScope = currentCall?.scope;
  const callOwned = !!currentCall && account.signedIn && !!account.user?.id && (!currentCall._ownerId || currentCall._ownerId === account.user.id);
  const useFloatingCall = callOwned && !(currentCall.scope === 'mafia' && mafiaControlsOwnCall);
  useCallDockLayout(useFloatingCall);
  useLayoutEffect(() => {
    if (!callOwned || currentCallScope !== 'mafia') { setMafiaControlsOwnCall(false); return undefined; }
    const locate = () => setMafiaControlsOwnCall(hasVisibleMafiaCallControls(document, { id: currentCallId, scope: currentCallScope }));
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-mafia-call-controls', 'data-mafia-controls-ready', 'hidden', 'aria-hidden', 'inert', 'class', 'style'] });
    window.addEventListener('resize', locate);
    return () => { observer.disconnect(); window.removeEventListener('resize', locate); };
  }, [callOwned, currentCallId, currentCallScope, account.user?.id]);
  const callGroupId = currentCall?.scope === 'group' ? currentCall.conversationId : null;
  const callMembersStore = lamma.callMembers;
  const callMembers = callMembersStore?.[callGroupId];
  const callGroupAllowed = !!callGroupId && groups.some(item => item.id === callGroupId);
  const loadCallMembers = lamma.loadCallMembers;
  useEffect(() => {
    if (callOwned && callGroupAllowed && !callMembers && loadCallMembers) loadCallMembers(callGroupId).catch(() => {});
  }, [callOwned, currentCall?.id, callGroupId, callGroupAllowed, callMembers, callMembersStore, loadCallMembers]);
  const directId = friend?.conversationId || social.conversationList?.find(item => item.user?.id === friend?.id)?.id;
  const targetType = group ? 'group' : 'direct'; const targetId = group?.id || directId;
  const sendAudio=useSocialSendAudio(account.user?.id,'action',JSON.stringify([ui.open,view.type,view.id,view.tab]));
  const sendVoice=clip=>confirmSocialSend(sendAudio,{scope:targetType,id:targetId},()=>lamma.sendVoiceNote({targetType,targetId,...clip}));
  const groupUnread = groups.reduce((sum, item) => sum + (item.unreadCount || 0), 0);
  const unread = (social.unreadCount || 0) + groupUnread + social.incoming.length + invites.length;
  const notify = useCallback((text, error = false) => { clearTimeout(noticeTimer.current); setNotice({ text, error }); noticeTimer.current = setTimeout(() => setNotice(null), error ? 9000 : 5000); }, []);
  const run = useCallback(async (work, key, success, onError) => {
    setBusy(key);
    try { await work(); if (success) notify(success); return true; }
    catch (error) { if (onError) onError(mediaError(error)); else notify(mediaError(error), true); return false; }
    finally { setBusy(''); }
  }, [notify]);
  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  useEffect(() => { const locked = () => notify(tr("التواصل أثناء المباراة داخل مجلس مافيا. تعود محادثاتك بعد الإقصاء أو نهاية المباراة."));
    window.addEventListener('maydan-social-locked', locked); return () => window.removeEventListener('maydan-social-locked', locked); }, [notify]);
  useEffect(() => { if (!host) return undefined; host.className = 'lamma-host'; document.body.appendChild(host); return () => host.remove(); }, [host]);
  useVisualViewport(host, { heightProperty: '--lamma-height', topProperty: '--lamma-top' });
  useVisualViewport(pageHost, { heightProperty: '--lamma-page-height', topProperty: '--lamma-page-top', relativeToTarget: true });
  useLayoutEffect(() => {
    const locate = () => setGameLauncherHost(document.querySelector('[data-social-game-launcher]'));
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [route.path]);
  useLayoutEffect(() => {
    if (ui.presentation !== 'page') { setPageHost(null); return undefined; }
    // ScreenHost commits before this persistent host. Observe replacement too:
    // switching direct/group routes can replace the page slot in one commit.
    const locate = () => setPageHost(document.querySelector('[data-social-page-slot]'));
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [route.path, ui.presentation]);
  useLayoutEffect(() => {
    if (panelOpen && view.type === 'list' && listScroll.current) listScroll.current.scrollTop = listScrollTop;
  }, [panelOpen, ui.presentation, view.type, view.tab, pageHost, listScrollTop]);
  useEffect(() => {
    if (!drawerOpen || !host || communicationLocked) return undefined;
    return activateDialog({node:panel.current,host,close:closePanel,priority:10});
  }, [drawerOpen, closePanel, host, communicationLocked]);
  useEffect(() => { setMenu(null); }, [view.type, view.id, view.tab]);
  useEffect(() => { setSearch(false); setSignIn(false); setPreferences(false); setGroupEditor(null); setMenu(null); setAction(null); setInviteTarget(null); setNotice(null); setDialogOwner(account.user?.id); }, [account.user?.id]);
  useEffect(() => {
    const handler = event => {
      const { scope, conversationId, category, view: requestedView } = event.detail || {};
      if (!conversationId) { showPanel({ type: 'list', tab: requestedView === 'groups' ? 'groups' : requestedView === 'requests' || ['friendRequests', 'groupInvites'].includes(category) ? 'requests' : 'chats' }); return; }
      if (scope === 'group') openGroup(conversationId);
      else { const found = friends.find(item => item.conversationId === conversationId); if (found) openChat(found.id); else showPanel({ type: 'list', tab: 'chats' }); }
    };
    window.addEventListener('maydan-social-open', handler);
    return () => window.removeEventListener('maydan-social-open', handler);
  }, [friends, openChat, openGroup, showPanel]);
  useEffect(() => { if (panelOpen && view.type === 'group' && account.signedIn) { selectGroup(view.id); return () => selectGroup(null); } return undefined; }, [panelOpen, view.type, view.id, account.signedIn, selectGroup]);
  const groupChatRef = useRef(groupChat); groupChatRef.current = groupChat;
  const groupSocial = useMemo(() => ({
    offline: groupOffline,
    openConversation: id => loadGroup(id),
    loadOlder: id => loadOlderGroup(id),
    sendMessage: (id, text) => sendGroupMessage(id, text),
    sendSticker: (id, stickerId) => sendGroupSticker(id, stickerId),
    markRead: id => markGroupRead(id, Math.max(0, ...(groupChatRef.current?.messages || []).map(message => message.seq || 0))),
    setTyping: () => {},
    retryMessage: (id, clientId) => retryGroupMessage(id, clientId),
  }), [groupOffline, loadGroup, loadOlderGroup, sendGroupMessage, sendGroupSticker, retryGroupMessage, markGroupRead]);
  const dismissNotification = social.clearNotification;
  const notification = social.notification;
  const notificationId = notification?.id;
  const groupNotificationId = lamma.notification?.id;
  const incomingAudio = useMemo(() => createSocialNotificationAudio(sound), [sound]);
  const audioOwner = account.ready && account.signedIn ? account.user?.id || null : null;
  useLayoutEffect(() => { incomingAudio.setIdentity(audioOwner); return () => incomingAudio.setIdentity(null); }, [incomingAudio, audioOwner]);
  const incomingContext = useRef(null);
  incomingContext.current = { preferences: lamma.notifications, callActive: !!(lamma.activeCall || lamma.media?.connected || lamma.media?.connecting || lamma.media?.ending), communicationLocked };
  const incomingAllowed = (scope, conversationId) => {
    const current = incomingContext.current, privacy = socialInterruption.getSnapshot();
    return !!current.preferences?.enabled && !!current.preferences?.sound && !current.callActive && !current.communicationLocked && !privacy.privateTurn && !privacy.communicationLocked && !isConversationMuted(current.preferences, scope, conversationId);
  };
  const dismissGroupNotification = useRef(lamma.clearNotification); dismissGroupNotification.current = lamma.clearNotification;
  useEffect(() => { if (!groupNotificationId) return undefined; const timer = setTimeout(() => dismissGroupNotification.current(), 6500); return () => clearTimeout(timer); }, [groupNotificationId]);
  useEffect(() => {
    if (!notificationId) return undefined;
    const timer = setTimeout(dismissNotification, 6500);
    return () => clearTimeout(timer);
  }, [notificationId, dismissNotification]);
  useEffect(() => {
    if (!notification) return;
    const allowed = () => liveNotificationAudio(notification,audioOwner)&&incomingAllowed('direct', notification.friend?.conversationId);
    incomingAudio.emit(notification, { owner: audioOwner, muted: !allowed(), guard: allowed,at:notification.audioReceipt?.receivedAt });
  }, [incomingAudio, audioOwner, notification, lamma.notifications, interruption.privateTurn, communicationLocked, lamma.activeCall]);
  useEffect(() => {
    const groupNotification = lamma.notification;
    if (!groupNotification) return;
    const allowed = () => liveNotificationAudio(groupNotification,audioOwner)&&incomingAllowed('group', groupNotification.conversationId || groupNotification.groupId);
    incomingAudio.emit(groupNotification, { owner: audioOwner, scope: 'group', muted: !allowed(), guard: allowed,at:groupNotification.audioReceipt?.receivedAt });
  }, [incomingAudio, audioOwner, lamma.notification, lamma.notifications, interruption.privateTurn, communicationLocked, lamma.activeCall]);
  const privateSurface = interruption.privateTurn || communicationLocked || (route.name === 'play');
  const directNotificationEnabled = notification?.type === 'request' ? lamma.notifications?.friendRequests !== false : lamma.notifications?.enabled !== false;
  const notificationMuted = notification?.friend && isConversationMuted(lamma.notifications, 'direct', notification.friend.conversationId);
  const join = id => run(async () => { await lamma.acceptGameInvite(id); ui.close(); }, 'join-invite');
  const content = message => message.kind === 'voice' ? <VoiceMessage attachment={message.attachment} getVoiceUrl={lamma.getVoiceUrl} /> : ['game_invite', 'room_invite', 'invite'].includes(message.kind) ? <GameInviteCard invite={message.roomInvitation || message.invite || message.gameInvite || message} onJoin={join} /> : null;
  const ongoingGroupCall = group && lamma.calls?.find(call => call.scope === 'group' && call.conversationId === group.id && !['ended', 'rejected', 'cancelled', 'missed', 'expired'].includes(call.status));
  const startCall = () => { if (targetId) run(() => ongoingGroupCall ? lamma.acceptCall(ongoingGroupCall.id) : lamma.startCall({ targetType, targetId }), 'call'); };
  const sendInvite = (scope, id) => run(() => confirmSocialSend(sendAudio,{scope,id},()=>lamma.sendGameInvite({ targetType: scope, targetId: id, ...ui.invite })), 'invite-' + id, tr("وصلت دعوة اللعب"));
  const favoriteIds = ui.favorites || EMPTY;
  const activeFriendFilter = view.tab === 'friends' ? friendFilter : 'all';
  const displayedFriends = [...friends].filter(item => nameOf(item).toLocaleLowerCase('ar').includes(filter.trim().toLocaleLowerCase('ar'))).filter(item => activeFriendFilter === 'online' ? item.online : activeFriendFilter === 'favorites' ? favoriteIds.includes(item.id) : true).filter(item => view.tab !== 'chats' || item.lastMessage || item.unreadCount).sort((a, b) => view.tab === 'chats' ? (Number(b.lastMessage?.createdAt) || 0) - (Number(a.lastMessage?.createdAt) || 0) : Number(!!b.online) - Number(!!a.online));
  const totalRequests = social.incoming.length + invites.length;
  const openCall = call => { if (call.scope === 'group') ui.openGroup(call.conversationId); else { const peer = friends.find(item => item.conversationId === call.conversationId); if (peer) ui.openChat(peer.id); else ui.show(); } };
  const knownMembers = [profiles.mine || account.user, ...(callMembers || EMPTY), ...friends, ...Object.values(lamma.groupConversations || {}).flatMap(chat => chat.members || [])].filter(Boolean);
  const callMedia = { ...lamma.media, participants: (lamma.media?.participants || []).map(participant => {
    const known = knownMembers.find(person => (person.userId || person.id) === (participant.userId || participant.id));
    return { ...known, ...participant, name: known?.name || participant.name };
  }) };
  const title = view.type === 'profile' ? tr("أهل الميدان") : friend ? nameOf(friend) : group ? group.name : tr("الأصدقاء");
  const hasConversation = account.ready && account.signedIn && ['direct', 'group'].includes(view.type) && !!(friend || group);
  const panelContent = ui.open && !communicationLocked && <section data-design-screen={view.type === 'list' || view.type === 'profile' ? 'social.list' : 'social.conversation'} ref={panel} className={'lamma-panel lamma-host' + (ui.presentation === 'page' ? ' lamma-page-panel' : '') + (['direct', 'group'].includes(view.type) ? ' is-chat' : '')} role={drawerOpen ? 'dialog' : 'region'} aria-modal={drawerOpen ? true : undefined} aria-label={tr("الأصدقاء واللّمة")} tabIndex={-1} dir={localeDirection(getUiLocale())}>{!hasConversation && <header data-design-id="header" className="lamma-panel-head"><div className="lamma-panel-title">{view.type !== 'list' ? <LammaButton label={tr("العودة للّمة")} icon="back" onClick={ui.back} /> : null}<div><h2><bdi>{title}</bdi></h2></div></div><div className="lamma-header-actions"><LammaButton label={tr("إعدادات التنبيهات")} icon="bell" onClick={() => setPreferences(true)} />{drawerOpen && <LammaButton label={tr("إغلاق اللّمة والعودة للعبة")} icon="close" onClick={ui.close} />}</div></header>}
      <div ref={setCallInlineHost} className="lamma-call-inline-host" />
      {drawerOpen && interruption.online && interruption.turnDeadline && <div className="lamma-game-status"><LammaIcon name="game" size={17} />{tr("الجولة مستمرة. ارجع لدورك متى ما احتجت.")}<button type="button" onClick={ui.close}>{tr("العودة للعب")}</button></div>}
      {ui.invite && <div className="lamma-invite-banner"><LammaIcon name="game" /><span>{tr("ادعُ أصحابك للغرفة ")}<bdi>{ui.invite.roomCode}</bdi></span><LammaButton label={tr("إنهاء إرسال الدعوات")} icon="close" onClick={ui.clearInvite} /></div>}
      {notice && <div className={'lamma-notice' + (notice.error ? ' is-error' : '')} role={notice.error ? 'alert' : 'status'}>{notice.text}<LammaButton label={tr("إخفاء")} icon="close" onClick={() => setNotice(null)} /></div>}
      {!account.ready ? <Empty title={tr("نجهّز لمّتك…")}>{tr("لحظات ونكون معك.")}</Empty> : !account.signedIn ? <Empty illustration title={tr("الجمعة تبدأ بأصحابك")} action={<Button data-design-id="account-signin" variant="primary" onClick={() => setSignIn(true)}>{tr("سجّل الدخول وخلّك قريب")}</Button>}>{tr("أضف أصحابك، اسأل عنهم، واجمعهم على لعبة أو مكالمة. اللّمة مجانية للجميع.")}</Empty> : <>
        {(social.error || lamma.error) && <div className="lamma-connection" role="status">{social.error || lamma.error}<button data-design-id="retry" type="button" className="lamma-text-button" onClick={() => run(() => Promise.allSettled([social.refresh(), lamma.refreshGroups()]), 'refresh')}>{tr("إعادة المحاولة")}</button></div>}{(social.offline || lamma.offline) && <p className="lamma-connection" role="status">{tr("انقطع الاتصال · رسائلك المحمّلة ما زالت هنا")}</p>}
        {view.type === 'profile' ? <ProfilePreview id={view.id} onBack={ui.back} onInvite={setInviteTarget} run={run} /> : view.type === 'direct' || view.type === 'group' ? friend || group ? <Conversation compactHeader onClose={drawerOpen ? ui.close : undefined} designScreen={null} key={view.type + view.id} friend={friend || { ...group, online: false }} conversation={friend ? social.conversations?.[friend.id] : groupChat} account={account} social={friend ? social : groupSocial} onBack={ui.back} onProfile={() => friend ? ui.openProfile(friend.id) : setGroupEditor(group)} onMenu={() => setMenu(friend || group)} onAction={next => setAction(group ? { ...next, groupId: group.id, user: groupChat?.members?.find(member => (member.userId || member.id) === next.message?.senderId) || { id: next.message?.senderId, name: tr("عضو اللّمة") } } : next)} notify={notify} subtitle={busy === 'call' ? <span role="status">{tr("جارٍ الاتصال…")}</span> : group ? tr("{v0} من الأصحاب{v1}", {v0: groupMemberCount(group), v1: ongoingGroupCall ? tr(" · مكالمة جارية") : ''}) : undefined} draftValue={ui.drafts[conversationDraftKey(view.type, view.id)] || ''} onDraftChange={text => ui.setDraft(conversationDraftKey(view.type, view.id), text)} renderContent={content} headerActions={<><LammaButton label={tr("يلا نلعب")} icon="game" disabled={!targetId || social.offline || lamma.offline} onClick={() => setInviteTarget({ targetType, targetId })} /><LammaButton label={lamma.capabilities?.liveCalls ? ongoingGroupCall ? tr("انضم للمكالمة الجارية") : tr("مكالمة صوتية") : tr("المكالمات غير متاحة في هذه النسخة")} icon="phone" disabled={!lamma.capabilities?.liveCalls || !!lamma.activeCall || busy === 'call' || !targetId || social.offline} onClick={startCall} /></>} composerExtras={<VoiceRecorder key={view.type + view.id} disabled={social.offline || lamma.offline || !!lamma.activeCall} unavailableReason={!lamma.capabilities?.voiceMessages ? tr("الرسائل الصوتية غير متاحة في هذه النسخة.") : lamma.activeCall ? tr("أنهِ المكالمة قبل تسجيل رسالة صوتية.") : ''} onError={text => notify(text, true)} onSend={sendVoice} />} /> : <Empty title={tr("هذه المحادثة غير متاحة")} action={<Button data-design-id="back" variant="secondary" onClick={ui.back}>{tr("العودة للأصدقاء")}</Button>}>{tr("قد تكون الصداقة أو عضويتك في اللّمة تغيّرت.")}</Empty> : <div ref={listScroll} className="lamma-list-content lamma-list-scroll" onScroll={event => ui.updateListState(view.tab, { scrollTop: event.currentTarget.scrollTop })}>

          <nav data-design-id="tabs" className="lamma-tabs" aria-label={tr("أقسام اللّمة")}>{[['friends', tr("الأصدقاء"), 0], ['chats', tr("المحادثات"), social.unreadCount || 0], ['groups', tr("الشِّلل"), groupUnread], ['requests', tr("الطلبات"), totalRequests]].map(([tab, label, count]) => <button data-design-id={`tab.${tab}`} type="button" key={tab} aria-current={view.tab === tab ? 'page' : undefined} className={view.tab === tab ? 'is-active' : ''} onClick={() => ui.show({ type: 'list', tab })}>{label}{count > 0 && <b>{count > 99 ? '99+' : count}</b>}</button>)}</nav>
          {view.tab !== 'requests' && <label data-design-id="search" className="lamma-search"><LammaIcon name="search" size={18} /><input data-design-id="search-input" value={filter} placeholder={view.tab === 'groups' ? tr("ابحث في لمّاتك") : tr("دوّر على صاحبك")} aria-label={tr("البحث في اللّمة")} onChange={event => setFilter(event.target.value)} /></label>}
          {view.tab === 'friends' && <><div className="lamma-friend-filters" role="group" aria-label={tr("تصفية الأصدقاء")}>{[['all', tr("الكل")], ['online', tr("المتصلون")], ['favorites', tr("المفضّلون")]].map(([value, label]) => <button data-design-id="friend-filter" type="button" key={value} aria-pressed={friendFilter === value} onClick={() => setFriendFilter(value)}>{value === 'favorites' && <LammaIcon name="star" size={14} />}{label}</button>)}</div>{friendFilter === 'favorites' && <p className="lamma-favorites-note">{tr("مفضّلوك محفوظون لحسابك على هذا الجهاز.")}</p>}</>}
          <div data-design-id="list" className="lamma-list-items">{view.tab === 'groups' ? <>{groups.filter(item => item.name?.includes(filter.trim())).map(item => <div data-design-id="friend-row" className="lamma-friend-row" key={item.id}><button type="button" data-design-id="group-row" className="lamma-group-open" onClick={() => ui.openGroup(item.id)}><GroupAvatar group={item} /><span className="lamma-person-copy"><strong>{item.name}{item.unreadCount > 0 && <b className="lamma-unread">{item.unreadCount}</b>}</strong><small>{groupPreview(item)}</small></span></button>{ui.invite && <button type="button" data-design-id="friend-invite" data-sound="none" className="lamma-small-primary" disabled={!!busy} onClick={() => sendInvite('group', item.id)}>{tr("دعوة")}</button>}</div>)}{!groups.length && <Empty illustration title={tr("لمّتكم لها مكان")} icon="chat">{tr("اجمع أصحابك في محادثة واحدة. خططوا للّعب، وأرسلوا صوتيات، وسولفوا براحتكم.")}</Empty>}</> : view.tab === 'requests' ? <>{social.incoming.map(request => <div className="lamma-request" key={request.id}><button data-design-id="profile" type="button" className="lamma-request-person" onClick={() => ui.openProfile(request.user.id)}><ProfileAvatar user={request.user} /><span><strong><PlayerName user={request.user} card compact /></strong><small>{tr("يريد إضافتك إلى أصدقائه")}</small></span></button><div><Button data-design-id="friend-accept" variant="primary" size="sm" disabled={!!busy} onClick={() => run(() => social.acceptRequest(request.id), request.id, tr("صار من أصحابك"))}>{tr("قبول")}</Button><Button data-design-id="friend-reject" variant="ghost" size="sm" disabled={!!busy} onClick={() => run(() => social.rejectRequest(request.id), request.id)}>{tr("رفض")}</Button></div></div>)}{invites.map(invitation => <div className="lamma-request" key={invitation.id}><div className="lamma-request-person"><GroupAvatar group={invitation.group || invitation} /><span><strong>{invitation.group?.name || invitation.groupName || tr("دعوة إلى لمّة")}</strong><small>{tr("أصحابك ينتظرونك")}</small></span></div><div><Button data-design-id="group-accept" variant="primary" size="sm" disabled={!!busy} onClick={() => run(() => lamma.acceptGroupInvite(invitation.groupId || invitation.group?.id, invitation.id), invitation.id, tr("دخلت اللّمة"))}>{tr("انضمام")}</Button><Button data-design-id="group-reject" variant="ghost" size="sm" disabled={!!busy} onClick={() => run(() => lamma.rejectGroupInvite(invitation.groupId || invitation.group?.id, invitation.id), invitation.id)}>{tr("اعتذار")}</Button></div></div>)}{social.outgoing.map(request => <div className="lamma-request" key={request.id}><div className="lamma-request-person"><ProfileAvatar user={request.user} /><span><strong><PlayerName user={request.user} card compact /></strong><small>{tr("بانتظار الموافقة")}</small></span></div><Button data-design-id="friend-cancel" variant="ghost" size="sm" disabled={!!busy} onClick={() => run(() => social.cancelRequest(request.id), request.id)}>{tr("إلغاء الطلب")}</Button></div>)}{!totalRequests && !social.outgoing.length && <Empty title={tr("كل شيء هادئ")} icon="bell">{tr("طلبات الصداقة ودعوات اللّمات تظهر هنا.")}</Empty>}</> : <><div className="lamma-list-heading"><strong>{view.tab === 'chats' ? tr("آخر سوالفكم") : tr("أصحاب الميدان")}</strong><small>{friends.filter(item => item.online).length}{tr(" متصل الآن")}</small></div>{displayedFriends.map(item => <FriendListItem friend={item} key={item.id} favorite={favoriteIds.includes(item.id)} onFavorite={() => ui.toggleFavorite(item.id)} onChat={() => ui.openChat(item.id)} onProfile={() => ui.openProfile(item.id)} inviting={!!busy} onInvite={ui.invite ? () => sendInvite('direct', item.conversationId || social.conversationList.find(conversation => conversation.user.id === item.id)?.id) : null} />)}{!displayedFriends.length && <Empty illustration={!filter && activeFriendFilter === 'all'} title={filter ? tr("ما لقينا هذا الاسم") : activeFriendFilter === 'favorites' ? tr("أصحابك الأقرب، بنجمة") : activeFriendFilter === 'online' ? tr("أصحابك غير متصلين الآن") : view.tab === 'chats' ? tr("ابدأ السالفة") : tr("أصحابك يكملون اللّمة")} action={!filter && activeFriendFilter === 'all' && <Button data-design-id="add-friend" variant="secondary" onClick={() => setSearch(true)}>{tr("أضف صديقًا")}</Button>}>{filter ? tr("جرّب جزءًا آخر من الاسم أو اختر الكل.") : activeFriendFilter === 'favorites' ? tr("اضغط النجمة بجانب صاحبك ليظهر هنا.") : activeFriendFilter === 'online' ? tr("تقدر ترسل لهم رسالة الآن، ويشوفونها لما يرجعون.") : tr("ابحث عن صاحبك باسمه أو شاركه رمز ميدان.")}</Empty>}</>}</div>
          <div className="lamma-list-actions"><Button data-design-id="new-group" type="button" variant="accent" icon={<LammaIcon name="people" />} onClick={() => setGroupEditor({ create: true })}>{tr("تكوين شلّة")}</Button><Button data-design-id="add-friend" type="button" variant="secondary" icon={<LammaIcon name="search" />} onClick={() => setSearch(true)}>{tr("البحث")}</Button></div><footer className="lamma-footer"><button data-design-id="profile" type="button" className="lamma-me-profile" onClick={() => ui.openProfile(account.user.id)}><ProfileAvatar user={profiles.mine || account.user} size={26} /><span>{tr("ملفك في الميدان")}</span></button><button data-design-id="code" type="button" onClick={async () => { try { await navigator.clipboard.writeText(social.profile?.code || ''); notify(tr("نُسخ رمزك. أرسله لأصحابك")); } catch { notify(tr("رمزك: {v0}", {v0: social.profile?.code || tr("غير متاح")})); } }}>{tr("رمزك ")}<bdi>{social.profile?.code || '…'}</bdi></button></footer>
        </div>}
      </>}
    </section>;
  const launcher = !ui.open && !communicationLocked && <button ref={trigger} type="button" className={'lamma-launcher' + (unread ? ' has-unread' : '')} aria-label={unread ? tr("الأصدقاء، {v0} تنبيه", {v0: unread}) : tr("افتح الأصدقاء واللّمة")} aria-expanded={false} onClick={() => ui.show()}><span className="lamma-launcher-faces">{account.signedIn && friends.some(item => item.online) ? friends.filter(item => item.online).slice(0, 2).map(item => <ProfileAvatar key={item.id} user={item} size={30} />) : <LammaIcon name="people" />}</span><strong>{tr("اللّمة")}</strong>{unread > 0 && <b className="lamma-unread">{unread > 99 ? '99+' : unread}</b>}</button>;
  const tree = <><style>{socialCss}</style><PresentationStyles sheet={lammaCss} />
    {gameLauncherHost ? createPortal(launcher, gameLauncherHost) : launcher}
    {useFloatingCall && <CallControls call={lamma.activeCall} media={callMedia} currentUserId={account.user.id} privateTurn={interruption.privateTurn} panelOpen={ui.open && !communicationLocked} inlineHost={communicationLocked ? null : callInlineHost} onMute={value => lamma.setCallMuted(value)} onEnd={() => lamma.endCall()} onOpen={() => openCall(lamma.activeCall)} onOutput={id => lamma.setAudioOutput(id)} onResume={() => lamma.resumeCallAudio()} />}
    {!communicationLocked && !ui.open && notification && directNotificationEnabled && !notificationMuted && <div className="lamma-notification" role="status"><button type="button" onClick={() => { dismissNotification(); if (notification.friend) ui.openChat(notification.friend.id); else ui.show({ type: 'list', tab: 'requests' }); }}><span><LammaIcon name={notification.type === 'request' ? 'people' : 'chat'} /></span><div><strong>{notification.type === 'request' ? tr("وصلك طلب صداقة") : privateSurface ? tr("رسالة جديدة في ميدان") : tr("رسالة من {v0}", {v0: nameOf(notification.friend)})}</strong><small>{lamma.notifications?.previews && !privateSurface ? notification.friend?.lastMessage?.text || tr("افتح اللّمة لتشوف الجديد") : tr("اضغط لفتح اللّمة")}</small></div></button><LammaButton label={tr("إخفاء التنبيه")} icon="close" onClick={dismissNotification} /></div>}
    {!communicationLocked && !ui.open && !notification && lamma.notification && lamma.notifications?.enabled !== false && <div className="lamma-notification" role="status"><button type="button" onClick={() => { const id = lamma.notification.groupId || lamma.notification.conversationId; lamma.clearNotification(); ui.openGroup(id); }}><span><LammaIcon name="people" /></span><div><strong>{privateSurface ? tr("رسالة جديدة في ميدان") : lamma.notification.title}</strong><small>{tr("اضغط لفتح اللّمة")}</small></div></button><LammaButton label={tr("إخفاء التنبيه")} icon="close" onClick={lamma.clearNotification} /></div>}
    {drawerOpen && !communicationLocked && <div className="lamma-layer" onPointerDown={event => { if (event.target === event.currentTarget) ui.close(); }}>{panelContent}</div>}
    {ui.presentation === 'page' && pageHost && createPortal(communicationLocked ? <div className="lamma-host" role="status"><p>{tr("التواصل متوقف أثناء نشاط مافيا في حسابك. أكمل المجلس أو غادر الطابور للعودة إلى اللّمة.")}</p><Button onClick={()=>navigate('/online/mafia')}>{tr("العودة إلى مافيا")}</Button></div> : panelContent, pageHost)}
    <SignInSheet open={signIn} onClose={() => setSignIn(false)} note={tr("سجّل الدخول للّمة، أصحابك ينتظرونك.")} />
    {dialogsOwned && search && <SearchDialog social={social} onClose={() => setSearch(false)} run={run} busy={busy} onOpen={ui.openChat} onProfile={ui.openProfile} />}
    {dialogsOwned && inviteTarget && <GameInviteDialog key={`${account.user?.id}:${inviteTarget.targetType}:${inviteTarget.targetId}`} target={inviteTarget} lamma={lamma} initialCode={ui.invite?.roomCode || (route.name === 'room' ? route.params.id : '')} canCreate={!['play', 'room'].includes(route.name)} memberCount={inviteTarget.targetType === 'group' ? groupMemberCount(groups.find(item => item.id === inviteTarget.targetId)) : 2} onClose={() => setInviteTarget(null)} onLaunched={code => { ui.close(); navigate(`/room/${code}`); }} notify={notify} />}{dialogsOwned && preferences && <Preferences lamma={lamma} social={social} onClose={() => setPreferences(false)} notify={notify} />}
    {dialogsOwned && groupEditor && <GroupEditor key={groupEditor.id || 'new'} group={groupEditor.create ? null : groupEditor} detail={lamma.groupConversations?.[groupEditor.id]} friends={friends} accountId={account.user?.id} lamma={lamma} onClose={() => setGroupEditor(null)} onCreated={ui.openGroup} notify={notify} onPlay={groupEditor.id === group?.id && targetId && !social.offline && !lamma.offline ? () => { setGroupEditor(null); setInviteTarget({ targetType, targetId }); } : undefined} onCall={groupEditor.id === group?.id && lamma.capabilities?.liveCalls && targetId ? () => { setGroupEditor(null); startCall(); } : undefined} callDisabled={!!lamma.activeCall || busy === 'call' || social.offline} />}
    {dialogsOwned && menu && <Sheet open title={group ? tr("خيارات الشلّة") : tr("خيارات المحادثة")} data-design-screen="social.conversation-options" onClose={() => setMenu(null)}><div className="lamma-menu">{!group && <button type="button" onClick={() => { ui.toggleFavorite(menu.id); setMenu(null); }}><LammaIcon name="star" />{favoriteIds.includes(menu.id) ? tr("إزالة من المفضّلة") : tr("إضافة للمفضّلة")}</button>}<button data-design-id="preferences" type="button" onClick={() => { setMenu(null); setPreferences(true); }}><LammaIcon name="settings" />{tr("إعدادات التنبيهات")}</button><button type="button" onClick={() => { setInviteTarget({ targetType, targetId }); setMenu(null); }}><LammaIcon name="game" />{tr("دعوة للعبة")}</button>{group ? <button data-design-id="group-manage" type="button" onClick={() => { setGroupEditor(group); setMenu(null); }}><LammaIcon name="people" />{tr("الأعضاء وإدارة اللّمة")}</button> : <button type="button" onClick={() => { ui.openProfile(menu.id); setMenu(null); }}><LammaIcon name="people" />{tr("عرض البروفايل")}</button>}<button type="button" onClick={async () => { const muted = isConversationMuted(lamma.notifications, targetType, targetId); if (await run(() => lamma.setConversationMuted({ targetType, targetId, muted: !muted }), 'mute-chat', muted ? tr("شُغّلت تنبيهات المحادثة") : tr("كُتمت تنبيهات المحادثة"))) setMenu(null); }}><LammaIcon name="bell" />{isConversationMuted(lamma.notifications, targetType, targetId) ? tr("تشغيل التنبيهات") : tr("كتم تنبيهات المحادثة")}</button>{!group && <><button type="button" onClick={() => { setAction({ kind: 'remove', user: menu }); setMenu(null); }}>{tr("إزالة من الأصدقاء")}</button><button type="button" className="is-danger" onClick={() => { setAction({ kind: 'block', user: menu }); setMenu(null); }}>{tr("حظر الحساب")}</button><button type="button" onClick={() => { setAction({ kind: 'report', user: menu }); setMenu(null); }}>{tr("إبلاغ عن الحساب")}</button></>}<Button variant="secondary" full onClick={() => setMenu(null)}>{tr("إلغاء")}</Button></div></Sheet>}
    {dialogsOwned && action && (action.groupId ? <GroupMessageAction action={action} lamma={lamma} social={social} onClose={() => setAction(null)} notify={notify} /> : <ActionDialog action={action} social={social} onClose={() => setAction(null)} onComplete={kind => { notify(kind === 'report' ? tr("وصل بلاغك") : tr("تمّ")); if (kind === 'block' || kind === 'remove') ui.show(); }} />)}
    {!communicationLocked && lamma.incomingCall && !lamma.activeCall && <div className="lamma-incoming-call" role="alertdialog" aria-label={tr("مكالمة واردة")} aria-modal="false"><span className="lamma-ringing-avatar"><LammaIcon name="phone" size={29} /></span><div><small>{tr("مكالمة صوتية واردة")}</small><strong>{privateSurface ? tr("أحد أصحابك يتصل") : lamma.incomingCall.name || nameOf(friends.find(item => item.id === lamma.incomingCall.initiatorId))}</strong></div><LammaButton label={tr("رفض المكالمة")} icon="end" className="lamma-call-end" disabled={!!busy} onClick={() => run(() => lamma.declineCall(lamma.incomingCall.id), 'decline')} /><LammaButton label={tr("قبول المكالمة")} icon="phone" className="lamma-call-accept" disabled={!!busy || !lamma.capabilities?.liveCalls} onClick={() => run(() => lamma.acceptCall(lamma.incomingCall.id), 'accept')} /></div>}
  </>;
  return host ? createPortal(tree, host) : tree;
}
