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
import { Button, Modal } from '../shared/ui/components.jsx';
import { useVisualViewport } from '../shared/ui/useVisualViewport.js';
import { activateDialog } from '../shared/ui/dialog-interaction.js';
import { usePlatform } from '../platform/context.js';
import { navigate, useRoute } from '../platform/router.js';
import { useProfiles } from '../profiles/ProfileProvider.jsx';
import { ProfileView } from '../profiles/ProfileScreen.jsx';
import { ProfileAvatar } from '../profiles/ProfileAvatar.jsx';
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
import { createSocialGameLauncher } from './game-launch.js';
import { errorText as roomErrorText } from '../online/shared.js';
import socialCss from './social.css';
import lammaCss from './lamma.css';

const EMPTY = [];
const nameOf = user => user?.name?.trim() || 'لاعب ميدان';
export const groupMemberCount = group => group?.memberCount ?? group?.members?.length ?? 0;
export const groupPreview = group => group?.lastMessage?.deletedAt ? 'حُذفت رسالة' : group?.lastMessage?.kind === 'voice' ? 'رسالة صوتية' : ['game_invite', 'room_invite'].includes(group?.lastMessage?.kind) ? 'دعوة للّعب' : group?.lastMessage?.text || `${groupMemberCount(group).toLocaleString('ar')} من الأصحاب`;
export const isConversationMuted = (preferences, scope, conversationId) => (preferences?.mutedConversations || []).some(item => item.scope === scope && item.conversationId === conversationId);

function Empty({ title, children, icon = 'people', action }) {
  return <div className="lamma-empty"><span><LammaIcon name={icon} size={36} /></span><h3>{title}</h3><p>{children}</p>{action}</div>;
}
function GroupAvatar({ group, size = 44 }) {
  return <span className="lamma-group-avatar" style={{ width: size, height: size }} aria-hidden="true">{group?.avatarPreset ? <ProfileAvatar user={{ avatarPreset: group.avatarPreset, theme: 'teal' }} size={size} /> : <LammaIcon name="people" size={Math.round(size * .55)} />}</span>;
}
export function FriendListItem({ friend, onChat, onProfile, onInvite, inviting, favorite = false, onFavorite }) {
  const message = friend.lastMessage;
  const preview = message?.deletedAt ? 'حُذفت رسالة' : message?.kind === 'voice' ? 'رسالة صوتية' : ['game_invite', 'room_invite'].includes(message?.kind) ? 'دعوة للّعب' : message?.text;
  return <div data-design-id="friend-row" className="lamma-friend-row"><button type="button" data-design-id="friend-avatar" className="lamma-avatar-link" aria-label={'عرض بروفايل ' + nameOf(friend)} onClick={onProfile}><PersonAvatar user={friend} presence /></button><button type="button" data-design-id="friend-chat" className="lamma-person-copy" onClick={onChat}><strong><bdi>{nameOf(friend)}</bdi>{friend.unreadCount > 0 && <b className="lamma-unread">{friend.unreadCount > 99 ? '99+' : friend.unreadCount}</b>}</strong><small>{preview || presenceLabel(friend)}</small></button>{onFavorite && <LammaButton data-design-id="favorite" className={'lamma-favorite' + (favorite ? ' is-favorite' : '')} label={(favorite ? 'إزالة ' : 'إضافة ') + nameOf(friend) + (favorite ? ' من المفضّلين' : ' إلى المفضّلين')} icon="star" aria-pressed={favorite} onClick={onFavorite} />}{onInvite ? <button type="button" data-design-id="friend-invite" className="lamma-small-primary" onClick={onInvite} disabled={inviting}>دعوة</button> : <LammaButton label={'محادثة مع ' + nameOf(friend)} icon="chat" onClick={onChat} />}</div>;
}

function ProfilePreview({ id, onBack, onInvite, run }) {
  const account = useAccount(); const profiles = useProfiles(); const social = useSocial(); const ui = useSocialUI(); const lamma = useLamma();
  const friend = social.friends.find(item => item.id === id);
  const conversationId = friend?.conversationId || social.conversationList.find(item => item.user?.id === id)?.id;
  const move = path => {
    if (path.startsWith('/friends/')) ui.openChat(decodeURIComponent(path.slice(9)));
    else onBack();
  };
  return <div className="lamma-profile-preview">{friend && <div className="lamma-profile-actions"><button data-design-id="call" type="button" disabled={!lamma.capabilities?.liveCalls || !!lamma.activeCall || !conversationId} onClick={() => run(() => lamma.startCall({ targetType: 'direct', targetId: conversationId }), 'profile-call')}><LammaIcon name="phone" size={18} />مكالمة صوتية</button><button data-design-id="game-invite" type="button" disabled={!conversationId} onClick={() => onInvite({ targetType: 'direct', targetId: conversationId })}><LammaIcon name="game" size={18} />دعوة للعبة</button></div>}<ProfileView account={account} profiles={profiles} social={social} profileId={id} onNavigate={move} /></div>;
}

export function GameInviteDialog({ target, lamma, initialCode = '', canCreate = true, memberCount = 2, onClose, onLaunched, notify }) {
  const account = useAccount();
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
        const room = await launcher.current.launch(game, payload => lamma.sendGameInvite(payload), settings ? { settings } : {});
        if (!alive.current) return;
        notify('وصلت الدعوة، ننتظركم في الغرفة'); onClose(); onLaunched(room.code);
      } else {
        await lamma.sendGameInvite({ ...target, roomCode: normalizeCode(code) });
        if (alive.current) { notify('وصلت دعوة اللعب'); onClose(); }
      }
    } catch (err) {
      if (!alive.current) return;
      setCreated(launcher.current.room);
      if (err.code === 'PLUS_REQUIRED') setError(roomErrorText('UPDATE_REQUIRED'));
      else setError(/[\u0600-\u06ff]/.test(err.message || '') ? err.message : roomErrorText(err.code));
    } finally { if (alive.current) setBusy(false); }
  };
  return <Modal data-design-screen="social.invite" title="يلا نلعب" className="lamma-dialog lamma-game-dialog" onClose={busy ? null : onClose} footer={<><Button data-design-id="cancel" variant="ghost" disabled={busy} onClick={onClose}>إلغاء</Button><Button data-design-id="submit" variant="primary" disabled={busy || (mode === 'existing' && !validCode(normalizeCode(code))) || (mode === 'create' && game === 'badeeha' && !created && !badeehaOk)} loading={busy} onClick={submit}>{mode === 'existing' || created ? 'إرسال الدعوة' : 'ابدأ وادعُ أصحابك'}</Button></>}>
    {mode === 'create' ? <>
      <p className="lamma-muted">اختر اللعبة. نجهّز الغرفة ونرسل دعوتها هنا، وكل واحد يدخل من جواله. {game === 'mafia' ? 'عند البداية ينتقل المشاركون إلى صوت المجلس الآمن، وبقية الشلة تبقى في مكالمتها.' : 'مكالمتكم تبقى معكم.'}</p>
      <div data-design-id="options-list" className="lamma-game-options" role="group" aria-label="اختيار لعبة للّمة">{[['badeeha', 'بَديهة', 'من فريقين إلى ٤', 'جوال لكل فريق — ست فئات وأسئلة بالنقاط'], ['mafia', 'مافيا ميدان', 'من ٦ إلى ١٢', 'مجلس صوتي وأدوار سرية — يبدأ الأساسي من ٦'], ['ersomha', 'ارسمها', 'من شخصين إلى ٨', 'رسم حي وتخمين متزامن — تعاون لشخصين'], ['fabraka', 'فبركة', 'من شخصين إلى ٨', 'حقيقة بين إجابات مضحكة — ٣ جولات'], ['meenfina', 'مين فينا', 'من ٣ إلى ١٢', 'تصويت سري وأسئلة تعرفكم على بعض']].map(([id, name, count, description]) => <button data-design-id="game-choice" type="button" key={id} aria-pressed={game === id} disabled={busy || !!created} onClick={() => setGame(id)}><LammaIcon name="game" size={27} /><strong>{name}</strong><span>{count}</span><small>{description}</small></button>)}</div>
      {game === 'mafia' && !created && <MafiaSettings value={mafiaSettings} onChange={setMafiaSettings} disabled={busy}/>}
      {game === 'badeeha' && !created && <BadeehaSettings value={badeehaSettings} disabled={busy} onChange={next => { setBadeehaSettings(next); save(resolveAccountServer(), 'badeehaSettings', next); }} />}
      {created && <p role="status" className="lamma-muted">الغرفة <bdi>{created.code}</bdi> جاهزة. أعد إرسال الدعوة؛ لن ننشئ غرفة ثانية.</p>}
      {!created && <button data-design-id="entry-join" type="button" className="lamma-text-button" disabled={busy} onClick={() => { setMode('existing'); setError(''); }}>عندي رمز غرفة</button>}
    </> : <>
      <p className="lamma-muted">أرسل دعوة لغرفة أنت موجود فيها.</p><label className="lamma-field">رمز الغرفة<input data-design-id="room-code" inputMode="numeric" autoComplete="off" maxLength={6} dir="ltr" disabled={busy} value={code} onChange={event => setCode(normalizeCode(event.target.value))} placeholder="000000" /></label>
      {canCreate && <button data-design-id="entry-create" type="button" className="lamma-text-button" disabled={busy} onClick={() => { setMode('create'); setError(''); }}>ابدأ غرفة جديدة بدلًا منها</button>}
    </>}
    {error && <p className="lamma-error" role="alert">{error}</p>}
  </Modal>;
}

export function GroupEditor({ group, detail, friends, accountId, lamma, onClose, onCreated, notify }) {
  const [name, setName] = useState(group?.name || '');
  const [avatar, setAvatar] = useState(group?.avatarPreset || AVATAR_PRESETS[0].id);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);
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
    if (!name.trim()) { setError('اكتب اسمًا للّمة.'); return; }
    if (!group) {
      const result = await act('save', () => lamma.createGroup({ name: name.trim(), memberIds: selected }));
      if (result) { const id = result.group?.id || result.id; await act('avatar', () => lamma.updateGroupAvatar(id, avatar)); if (result.failedInvites?.length) notify('أُنشئت اللّمة، لكن بعض الدعوات لم تصل. أعد إرسالها من إدارة اللّمة.', true); onCreated(id); onClose(); }
    } else {
      const result = await act('save', async () => {
        if (name.trim() !== group.name) await lamma.renameGroup(group.id, name.trim());
        if (avatar !== group.avatarPreset) await lamma.updateGroupAvatar(group.id, avatar);
        if (selected.length) await lamma.inviteGroupMembers(group.id, selected);
        await lamma.loadGroup(group.id); return true;
      }, 'حُفظت اللّمة وأُرسلت الدعوات');
      if (result) onClose();
    }
  };
  return <><Modal data-design-screen="social.group-editor" title={group ? 'أصحاب اللّمة' : 'لمّة جديدة'} className="lamma-dialog" onClose={busy ? null : onClose} footer={admin ? <><Button data-design-id="cancel" variant="ghost" disabled={!!busy} onClick={onClose}>إغلاق</Button><Button data-design-id="save" variant="primary" loading={busy === 'save'} disabled={!!busy || !name.trim()} onClick={save}>{group ? 'حفظ وإرسال الدعوات' : 'اجمع أصحابك'}</Button></> : null}>
    <div className="lamma-dialog-intro"><GroupAvatar group={group} size={58} /><div><strong>اللّمة أحلى معكم</strong><p>محادثات وصوت ولعب معًا · حتى ١٢ شخصًا مجانًا</p></div></div>
    <label className="lamma-field">اسم اللّمة<input data-design-id="group-name" value={name} maxLength={50} disabled={!admin || !!busy} placeholder="مثلًا: شلّة الخميس" onChange={event => setName(event.target.value)} /></label>
    {admin && <div className="lamma-group-presets" role="group" aria-label="صورة اللّمة">{AVATAR_PRESETS.map(preset => <button data-design-id="avatar-choice" type="button" key={preset.id} aria-label={preset.label} aria-pressed={avatar === preset.id} disabled={!!busy} onClick={() => setAvatar(preset.id)}><ProfileAvatar user={{ avatarPreset: preset.id }} size={37} /></button>)}</div>}
    {group && <div data-design-id="members" className="lamma-members"><h3>الأعضاء <span>{members.length} / 12</span></h3>{members.map(member => {
      const id = member.userId || member.id; const user = member.user || member.profile || member; const isMe = id === accountId;
      return <div key={id} data-design-id="member" className="lamma-member"><ProfileAvatar user={user} size={36} /><div><strong><bdi>{nameOf(user)}{isMe ? ' (أنت)' : ''}</bdi></strong><small>{member.role === 'owner' ? 'صاحب اللّمة' : member.role === 'admin' ? 'مشرف' : 'عضو'}</small></div>{owner && !isMe && <select data-design-id="member-role" aria-label={'صلاحية ' + nameOf(user)} value={member.role || 'member'} disabled={!!busy} onChange={event => act('role-' + id, () => lamma.setGroupRole(group.id, id, event.target.value), 'حُدّثت الصلاحية')}><option value="member">عضو</option><option value="admin">مشرف</option></select>}{admin && !isMe && member.role !== 'owner' && (owner || member.role !== 'admin') && <LammaButton label={'إزالة ' + nameOf(user)} icon="close" disabled={!!busy} onClick={() => setConfirm({ kind: 'remove', id, name: nameOf(user) })} />}{owner && !isMe && <button data-design-id="member-transfer" type="button" className="lamma-text-button" disabled={!!busy} onClick={() => setConfirm({ kind: 'transfer', id, name: nameOf(user) })}>نقل الملكية</button>}</div>;
    })}</div>}
    {admin && <section data-design-id="member-picker" className="lamma-member-picker"><h3>{group ? 'ادعُ أصحابك' : 'من يكون معك؟'} <small>{selected.length} / {capacity}</small></h3>{available.length ? available.map(friend => <label key={friend.id} className="lamma-pick-person"><ProfileAvatar user={friend} size={36} /><span><bdi>{nameOf(friend)}</bdi></span><input data-design-id="member-select" type="checkbox" checked={selected.includes(friend.id)} disabled={!!busy || (!selected.includes(friend.id) && selected.length >= capacity)} onChange={() => setSelected(list => list.includes(friend.id) ? list.filter(id => id !== friend.id) : [...list, friend.id])} /></label>) : <p className="lamma-muted">{group ? 'كل أصحابك موجودون أو وصلتهم دعوة.' : 'يمكنك إنشاء اللّمة الآن ودعوة أصحابك لاحقًا.'}</p>}</section>}
    {invitations.length > 0 && <p className="lamma-muted">{invitations.length} دعوة بانتظار الرد</p>}
    {group && <button type="button" data-design-id="leave-group" data-design-required="true" className="lamma-leave" disabled={!!busy || (owner && members.length > 1)} onClick={() => setConfirm({ kind: 'leave' })}>مغادرة اللّمة</button>}{group && owner && members.length > 1 && <p className="lamma-muted">انقل ملكية اللّمة لأحد أعضائها قبل المغادرة.</p>}
    {error && <p role="alert" className="lamma-error">{error}</p>}
  </Modal>{confirm && <Modal title={confirm.kind === 'leave' ? 'تغادر اللّمة؟' : confirm.kind === 'transfer' ? 'تنقل ملكية اللّمة؟' : 'تزيل العضو؟'} className="lamma-dialog" onClose={busy ? null : () => setConfirm(null)} footer={<><Button data-design-id="cancel" variant="ghost" disabled={!!busy} onClick={() => setConfirm(null)}>إلغاء</Button><Button data-design-id="confirm" variant="danger" loading={!!busy} onClick={async () => { const done = await act('confirm', () => confirm.kind === 'leave' ? lamma.leaveGroup(group.id) : confirm.kind === 'transfer' ? lamma.transferGroupOwnership(group.id, confirm.id) : lamma.removeGroupMember(group.id, confirm.id)); if (done !== false) { setConfirm(null); if (confirm.kind === 'leave') onClose(); else await lamma.loadGroup(group.id); } }}>تأكيد</Button></>}><p>{confirm.kind === 'leave' ? 'يمكن لأصحابك دعوتك مرة أخرى.' : confirm.kind === 'transfer' ? `${confirm.name} سيصبح صاحب اللّمة، وتصبح عضوًا فيها.` : `${confirm.name} لن يتمكن من قراءة الرسائل الجديدة في هذه اللّمة.`}</p></Modal>}</>;
}

export { CallControls } from './CallDock.jsx';

export function Preferences({ lamma, social, onClose, notify }) {
  const [busy, setBusy] = useState(false);
  const preferences = lamma.notifications || {};
  const change = async patch => { setBusy(true); try { await lamma.setNotificationPreferences(patch); } catch (error) { notify(mediaError(error), true); } finally { setBusy(false); } };
  return <Modal data-design-screen="social.preferences" title="تنبيهات اللّمة" className="lamma-dialog" onClose={onClose}><p className="lamma-muted">خلّيك قريب من أصحابك، على راحتك.</p>{[['enabled', 'تنبيهات الرسائل والمكالمات', 'يظهر تنبيه عندما يصلك جديد.'], ['previews', 'إظهار محتوى الرسائل', 'تظل المعاينات مخفية أثناء اللعب على جهاز مشترك.'], ['sound', 'صوت التنبيه', 'نغمة خفيفة للرسائل الجديدة.']].map(([key, title, description]) => <label data-design-id="notification-setting" className="lamma-toggle" key={key}><span><strong>{title}</strong><small>{description}</small></span><input data-design-id="notification-toggle" type="checkbox" checked={!!preferences[key]} disabled={busy} onChange={event => change({ [key]: event.target.checked })} /></label>)}<Button data-design-id="notification-enable" variant="secondary" full disabled={busy || !lamma.capabilities?.pushNotifications} onClick={async () => { setBusy(true); try { const result = await lamma.requestNotifications(); notify(result?.authorized ? 'فُعّلت التنبيهات على الجهاز' : 'لم يُمنح إذن التنبيهات. يمكنك تفعيله من إعدادات الجهاز.', !result?.authorized); } catch (error) { notify(mediaError(error), true); } finally { setBusy(false); } }}>تفعيل التنبيهات على هذا الجهاز</Button>{!lamma.capabilities?.pushNotifications && <p className="lamma-muted">تنبيهات الجهاز غير متاحة في هذه النسخة. تصلك التنبيهات هنا أثناء استخدام ميدان.</p>}{social.blocked?.length > 0 && <section data-design-id="members" className="lamma-members"><h3>الحسابات المحظورة</h3>{social.blocked.map(user => <div data-design-id="member" className="lamma-member" key={user.id}><ProfileAvatar user={user} size={36} /><div><strong>{nameOf(user)}</strong></div><Button data-design-id="unblock" variant="ghost" size="sm" disabled={busy} onClick={async () => { setBusy(true); try { await social.unblockUser(user.id); notify('أُلغي حظر الحساب'); } catch (error) { notify(mediaError(error), true); } finally { setBusy(false); } }}>إلغاء الحظر</Button></div>)}</section>}</Modal>;
}

function GroupMessageAction({ action, lamma, social, onClose, notify }) {
  const [text, setText] = useState(action.kind === 'report' ? '' : action.message.text || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const editing = action.kind === 'edit';
  if (action.kind === 'report') return <Modal data-design-screen="social.action" title="الإبلاغ عن الرسالة" className="lamma-dialog" onClose={busy ? null : onClose} footer={<><Button data-design-id="cancel" variant="ghost" disabled={busy} onClick={onClose}>إلغاء</Button><Button data-design-id="confirm" variant="primary" loading={busy} disabled={!text.trim()} onClick={async () => { setBusy(true); try { await lamma.reportGroupMessage(action.groupId, action.message.seq, text.trim()); notify('وصل بلاغك. لن يعرف المرسل من أبلغ.'); onClose(); } catch (err) { setError(mediaError(err)); } finally { setBusy(false); } }}>إرسال البلاغ</Button></>}><label className="lamma-field">سبب الإبلاغ<select data-design-id="report-reason" value={text} onChange={event => setText(event.target.value)}><option value="">اختر السبب</option>{['رسائل مزعجة', 'إساءة أو تنمر', 'محتوى غير مناسب', 'سبب آخر'].map(reason => <option key={reason}>{reason}</option>)}</select></label>{error && <p className="lamma-error" role="alert">{error}</p>}</Modal>;
  return <Modal data-design-screen="social.action" title={editing ? 'تعديل الرسالة' : 'حذف الرسالة؟'} className="lamma-dialog" onClose={busy ? null : onClose} footer={<><Button data-design-id="cancel" variant="ghost" disabled={busy} onClick={onClose}>إلغاء</Button><Button data-design-id="confirm" variant={editing ? 'primary' : 'danger'} loading={busy} disabled={editing && !text.trim()} onClick={async () => { setBusy(true); try { await lamma.changeGroupMessage(action.groupId, action.message.seq, editing ? text.trim() : null); onClose(); } catch (err) { setError(mediaError(err)); } finally { setBusy(false); } }}>{editing ? 'حفظ' : 'حذف'}</Button></>}>{editing ? <textarea data-design-id="message-input" className="lamma-edit-message" value={text} maxLength={2000} rows={4} onChange={event => setText(event.target.value)} aria-label="نص الرسالة" /> : <p>ستظهر مكانها عبارة «حُذفت هذه الرسالة».</p>}{error && <p className="lamma-error" role="alert">{error}</p>}</Modal>;
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
  useEffect(() => { const locked = () => notify('التواصل أثناء المباراة داخل مجلس مافيا. تعود محادثاتك بعد الإقصاء أو نهاية المباراة.');
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
    const allowed = () => incomingAllowed('direct', notification.friend?.conversationId);
    incomingAudio.emit(notification, { owner: audioOwner, muted: !allowed(), guard: allowed });
  }, [incomingAudio, audioOwner, notification, lamma.notifications, interruption.privateTurn, communicationLocked, lamma.activeCall]);
  useEffect(() => {
    const groupNotification = lamma.notification;
    if (!groupNotification) return;
    const allowed = () => incomingAllowed('group', groupNotification.conversationId || groupNotification.groupId);
    incomingAudio.emit(groupNotification, { owner: audioOwner, scope: 'group', muted: !allowed(), guard: allowed });
  }, [incomingAudio, audioOwner, lamma.notification, lamma.notifications, interruption.privateTurn, communicationLocked, lamma.activeCall]);
  const privateSurface = interruption.privateTurn || communicationLocked || (route.name === 'play');
  const notificationMuted = notification?.friend && isConversationMuted(lamma.notifications, 'direct', notification.friend.conversationId);
  const join = id => run(async () => { await lamma.acceptGameInvite(id); ui.close(); }, 'join-invite');
  const content = message => message.kind === 'voice' ? <VoiceMessage attachment={message.attachment} getVoiceUrl={lamma.getVoiceUrl} /> : ['game_invite', 'room_invite', 'invite'].includes(message.kind) ? <GameInviteCard invite={message.roomInvitation || message.invite || message.gameInvite || message} onJoin={join} /> : null;
  const ongoingGroupCall = group && lamma.calls?.find(call => call.scope === 'group' && call.conversationId === group.id && !['ended', 'rejected', 'cancelled', 'missed', 'expired'].includes(call.status));
  const startCall = () => { if (targetId) run(() => ongoingGroupCall ? lamma.acceptCall(ongoingGroupCall.id) : lamma.startCall({ targetType, targetId }), 'call'); };
  const sendInvite = (scope, id) => run(() => lamma.sendGameInvite({ targetType: scope, targetId: id, ...ui.invite }), 'invite-' + id, 'وصلت دعوة اللعب');
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
  const title = view.type === 'profile' ? 'أهل الميدان' : friend ? nameOf(friend) : group ? group.name : 'اللّمة';
  const panelContent = ui.open && !communicationLocked && <section data-design-screen={view.type === 'list' || view.type === 'profile' ? 'social.list' : 'social.conversation'} ref={panel} className={'lamma-panel lamma-host' + (ui.presentation === 'page' ? ' lamma-page-panel' : '') + (['direct', 'group'].includes(view.type) ? ' is-chat' : '')} role={drawerOpen ? 'dialog' : 'region'} aria-modal={drawerOpen ? true : undefined} aria-label="الأصدقاء واللّمة" tabIndex={-1} dir="rtl"><header data-design-id="header" className="lamma-panel-head"><div className="lamma-panel-title">{view.type !== 'list' ? <LammaButton label="العودة للّمة" icon="back" onClick={ui.back} /> : <span className="lamma-logo"><LammaIcon name="people" size={23} /></span>}<div><span>أصحابك أقرب</span><h2><bdi>{ui.presentation === 'page' && view.type === 'list' ? 'الأصدقاء' : title}</bdi></h2></div></div><div className="lamma-header-actions"><LammaButton label="إعدادات التنبيهات" icon="bell" onClick={() => setPreferences(true)} />{drawerOpen && <LammaButton label="إغلاق اللّمة والعودة للعبة" icon="close" onClick={ui.close} />}</div></header>
      <div ref={setCallInlineHost} className="lamma-call-inline-host" />
      {drawerOpen && interruption.online && interruption.turnDeadline && <div className="lamma-game-status"><LammaIcon name="game" size={17} />الجولة مستمرة. ارجع لدورك متى ما احتجت.<button type="button" onClick={ui.close}>العودة للعب</button></div>}
      {ui.invite && <div className="lamma-invite-banner"><LammaIcon name="game" /><span>ادعُ أصحابك للغرفة <bdi>{ui.invite.roomCode}</bdi></span><LammaButton label="إنهاء إرسال الدعوات" icon="close" onClick={ui.clearInvite} /></div>}
      {notice && <div className={'lamma-notice' + (notice.error ? ' is-error' : '')} role={notice.error ? 'alert' : 'status'}>{notice.text}<LammaButton label="إخفاء" icon="close" onClick={() => setNotice(null)} /></div>}
      {!account.ready ? <Empty title="نجهّز لمّتك…">لحظات ونكون معك.</Empty> : !account.signedIn ? <Empty title="الجمعة تبدأ بأصحابك" action={<Button data-design-id="account-signin" variant="primary" onClick={() => setSignIn(true)}>سجّل الدخول وخلّك قريب</Button>}>أضف أصحابك، اسأل عنهم، واجمعهم على لعبة أو مكالمة. اللّمة مجانية للجميع.</Empty> : <>
        {(social.error || lamma.error) && <div className="lamma-connection" role="status">{social.error || lamma.error}<button data-design-id="retry" type="button" className="lamma-text-button" onClick={() => run(() => Promise.allSettled([social.refresh(), lamma.refreshGroups()]), 'refresh')}>إعادة المحاولة</button></div>}{(social.offline || lamma.offline) && <p className="lamma-connection" role="status">انقطع الاتصال · رسائلك المحمّلة ما زالت هنا</p>}
        {view.type === 'profile' ? <ProfilePreview id={view.id} onBack={ui.back} onInvite={setInviteTarget} run={run} /> : view.type === 'direct' || view.type === 'group' ? friend || group ? <Conversation designScreen={null} key={view.type + view.id} friend={friend || { ...group, online: false }} conversation={friend ? social.conversations?.[friend.id] : groupChat} account={account} social={friend ? social : groupSocial} onBack={ui.back} onProfile={() => friend ? ui.openProfile(friend.id) : setGroupEditor(group)} onMenu={() => setMenu(friend || group)} onAction={next => setAction(group ? { ...next, groupId: group.id, user: groupChat?.members?.find(member => (member.userId || member.id) === next.message?.senderId) || { id: next.message?.senderId, name: 'عضو اللّمة' } } : next)} notify={notify} subtitle={busy === 'call' ? <span role="status">جارٍ الاتصال…</span> : group ? `${groupMemberCount(group)} من الأصحاب${ongoingGroupCall ? ' · مكالمة جارية' : ''}` : undefined} draftValue={ui.drafts[conversationDraftKey(view.type, view.id)] || ''} onDraftChange={text => ui.setDraft(conversationDraftKey(view.type, view.id), text)} renderContent={content} headerActions={<><LammaButton label="يلا نلعب" icon="game" disabled={!targetId || social.offline || lamma.offline} onClick={() => setInviteTarget({ targetType, targetId })} /><LammaButton label={lamma.capabilities?.liveCalls ? ongoingGroupCall ? 'انضم للمكالمة الجارية' : 'مكالمة صوتية' : 'المكالمات غير متاحة في هذه النسخة'} icon="phone" disabled={!lamma.capabilities?.liveCalls || !!lamma.activeCall || busy === 'call' || !targetId || social.offline} onClick={startCall} /></>} composerExtras={<VoiceRecorder key={view.type + view.id} disabled={social.offline || lamma.offline || !!lamma.activeCall} unavailableReason={!lamma.capabilities?.voiceMessages ? 'الرسائل الصوتية غير متاحة في هذه النسخة.' : lamma.activeCall ? 'أنهِ المكالمة قبل تسجيل رسالة صوتية.' : ''} onError={text => notify(text, true)} onSend={clip => lamma.sendVoiceNote({ targetType, targetId, ...clip })} />} /> : <Empty title="هذه المحادثة غير متاحة" action={<Button data-design-id="back" variant="secondary" onClick={ui.back}>العودة للأصدقاء</Button>}>قد تكون الصداقة أو عضويتك في اللّمة تغيّرت.</Empty> : <div ref={listScroll} className="lamma-list-content lamma-list-scroll" onScroll={event => ui.updateListState(view.tab, { scrollTop: event.currentTarget.scrollTop })}>
          <div className="lamma-me"><button data-design-id="profile" type="button" className="lamma-me-profile" onClick={() => ui.openProfile(account.user.id)}><ProfileAvatar user={profiles.mine || account.user} size={42} /><span><strong><bdi>{nameOf(profiles.mine || account.user)}</bdi></strong><small>ملفك في الميدان</small></span></button><button data-design-id="add-friend" type="button" className="lamma-add" onClick={() => setSearch(true)}><LammaIcon name="plus" size={18} />أضف صديقًا</button></div>
          <nav data-design-id="tabs" className="lamma-tabs" aria-label="أقسام اللّمة">{[['friends', 'الأصدقاء', 0], ['chats', 'السوالف', social.unreadCount || 0], ['groups', 'اللّمات', groupUnread], ['requests', 'الطلبات', totalRequests]].map(([tab, label, count]) => <button data-design-id={`tab.${tab}`} type="button" key={tab} aria-current={view.tab === tab ? 'page' : undefined} className={view.tab === tab ? 'is-active' : ''} onClick={() => ui.show({ type: 'list', tab })}>{label}{count > 0 && <b>{count > 99 ? '99+' : count}</b>}</button>)}</nav>
          {view.tab !== 'requests' && <label data-design-id="search" className="lamma-search"><LammaIcon name="search" size={18} /><input data-design-id="search-input" value={filter} placeholder={view.tab === 'groups' ? 'ابحث في لمّاتك' : 'دوّر على صاحبك'} aria-label="البحث في اللّمة" onChange={event => setFilter(event.target.value)} /></label>}
          {view.tab === 'friends' && <><div className="lamma-friend-filters" role="group" aria-label="تصفية الأصدقاء">{[['all', 'الكل'], ['online', 'المتصلون'], ['favorites', 'المفضّلون']].map(([value, label]) => <button data-design-id="friend-filter" type="button" key={value} aria-pressed={friendFilter === value} onClick={() => setFriendFilter(value)}>{value === 'favorites' && <LammaIcon name="star" size={14} />}{label}</button>)}</div>{friendFilter === 'favorites' && <p className="lamma-favorites-note">مفضّلوك محفوظون لحسابك على هذا الجهاز.</p>}</>}
          <div data-design-id="list" className="lamma-list-items">{view.tab === 'groups' ? <><button type="button" data-design-id="new-group" className="lamma-create-group" onClick={() => setGroupEditor({ create: true })}><span><LammaIcon name="plus" /></span><div><strong>لمّة جديدة</strong><small>حتى ١٢ من أصحابك · مجانًا</small></div></button>{groups.filter(item => item.name?.includes(filter.trim())).map(item => <div data-design-id="friend-row" className="lamma-friend-row" key={item.id}><button type="button" data-design-id="group-row" className="lamma-group-open" onClick={() => ui.openGroup(item.id)}><GroupAvatar group={item} /><span className="lamma-person-copy"><strong>{item.name}{item.unreadCount > 0 && <b className="lamma-unread">{item.unreadCount}</b>}</strong><small>{groupPreview(item)}</small></span></button>{ui.invite && <button type="button" data-design-id="friend-invite" className="lamma-small-primary" disabled={!!busy} onClick={() => sendInvite('group', item.id)}>دعوة</button>}</div>)}{!groups.length && <Empty title="لمّتكم لها مكان" icon="chat">اجمع أصحابك في محادثة واحدة. خططوا للّعب، وأرسلوا صوتيات، وسولفوا براحتكم.</Empty>}</> : view.tab === 'requests' ? <>{social.incoming.map(request => <div className="lamma-request" key={request.id}><button data-design-id="profile" type="button" className="lamma-request-person" onClick={() => ui.openProfile(request.user.id)}><ProfileAvatar user={request.user} /><span><strong>{nameOf(request.user)}</strong><small>يريد إضافتك إلى أصدقائه</small></span></button><div><Button data-design-id="friend-accept" variant="primary" size="sm" disabled={!!busy} onClick={() => run(() => social.acceptRequest(request.id), request.id, 'صار من أصحابك')}>قبول</Button><Button data-design-id="friend-reject" variant="ghost" size="sm" disabled={!!busy} onClick={() => run(() => social.rejectRequest(request.id), request.id)}>رفض</Button></div></div>)}{invites.map(invitation => <div className="lamma-request" key={invitation.id}><div className="lamma-request-person"><GroupAvatar group={invitation.group || invitation} /><span><strong>{invitation.group?.name || invitation.groupName || 'دعوة إلى لمّة'}</strong><small>أصحابك ينتظرونك</small></span></div><div><Button data-design-id="group-accept" variant="primary" size="sm" disabled={!!busy} onClick={() => run(() => lamma.acceptGroupInvite(invitation.groupId || invitation.group?.id, invitation.id), invitation.id, 'دخلت اللّمة')}>انضمام</Button><Button data-design-id="group-reject" variant="ghost" size="sm" disabled={!!busy} onClick={() => run(() => lamma.rejectGroupInvite(invitation.groupId || invitation.group?.id, invitation.id), invitation.id)}>اعتذار</Button></div></div>)}{social.outgoing.map(request => <div className="lamma-request" key={request.id}><div className="lamma-request-person"><ProfileAvatar user={request.user} /><span><strong>{nameOf(request.user)}</strong><small>بانتظار الموافقة</small></span></div><Button data-design-id="friend-cancel" variant="ghost" size="sm" disabled={!!busy} onClick={() => run(() => social.cancelRequest(request.id), request.id)}>إلغاء الطلب</Button></div>)}{!totalRequests && !social.outgoing.length && <Empty title="كل شيء هادئ" icon="bell">طلبات الصداقة ودعوات اللّمات تظهر هنا.</Empty>}</> : <><div className="lamma-list-heading"><strong>{view.tab === 'chats' ? 'آخر سوالفكم' : 'أصحاب الميدان'}</strong><small>{friends.filter(item => item.online).length} متصل الآن</small></div>{displayedFriends.map(item => <FriendListItem friend={item} key={item.id} favorite={favoriteIds.includes(item.id)} onFavorite={() => ui.toggleFavorite(item.id)} onChat={() => ui.openChat(item.id)} onProfile={() => ui.openProfile(item.id)} inviting={!!busy} onInvite={ui.invite ? () => sendInvite('direct', item.conversationId || social.conversationList.find(conversation => conversation.user.id === item.id)?.id) : null} />)}{!displayedFriends.length && <Empty title={filter ? 'ما لقينا هذا الاسم' : activeFriendFilter === 'favorites' ? 'أصحابك الأقرب، بنجمة' : activeFriendFilter === 'online' ? 'أصحابك غير متصلين الآن' : view.tab === 'chats' ? 'ابدأ السالفة' : 'أصحابك يكملون اللّمة'} action={!filter && activeFriendFilter === 'all' && <Button data-design-id="add-friend" variant="secondary" onClick={() => setSearch(true)}>أضف صديقًا</Button>}>{filter ? 'جرّب جزءًا آخر من الاسم أو اختر الكل.' : activeFriendFilter === 'favorites' ? 'اضغط النجمة بجانب صاحبك ليظهر هنا.' : activeFriendFilter === 'online' ? 'تقدر ترسل لهم رسالة الآن، ويشوفونها لما يرجعون.' : 'ابحث عن صاحبك باسمه أو شاركه رمز ميدان.'}</Empty>}</>}</div>
          <footer className="lamma-footer"><span><LammaIcon name="shield" size={15} />مساحتكم للسوالف واللعب</span><button data-design-id="code" type="button" onClick={async () => { try { await navigator.clipboard.writeText(social.profile?.code || ''); notify('نُسخ رمزك. أرسله لأصحابك'); } catch { notify(`رمزك: ${social.profile?.code || 'غير متاح'}`); } }}>رمزك <bdi>{social.profile?.code || '…'}</bdi></button></footer>
        </div>}
      </>}
    </section>;
  const launcher = !ui.open && !communicationLocked && <button ref={trigger} type="button" className={'lamma-launcher' + (unread ? ' has-unread' : '')} aria-label={unread ? `الأصدقاء، ${unread} تنبيه` : 'افتح الأصدقاء واللّمة'} aria-expanded={false} onClick={() => ui.show()}><span className="lamma-launcher-faces">{account.signedIn && friends.some(item => item.online) ? friends.filter(item => item.online).slice(0, 2).map(item => <ProfileAvatar key={item.id} user={item} size={30} />) : <LammaIcon name="people" />}</span><strong>اللّمة</strong>{unread > 0 && <b className="lamma-unread">{unread > 99 ? '99+' : unread}</b>}</button>;
  const tree = <><style>{socialCss}</style><style>{lammaCss}</style>
    {gameLauncherHost ? createPortal(launcher, gameLauncherHost) : launcher}
    {useFloatingCall && <CallControls call={lamma.activeCall} media={callMedia} currentUserId={account.user.id} privateTurn={interruption.privateTurn} panelOpen={ui.open && !communicationLocked} inlineHost={communicationLocked ? null : callInlineHost} onMute={value => lamma.setCallMuted(value)} onEnd={() => lamma.endCall()} onOpen={() => openCall(lamma.activeCall)} onOutput={id => lamma.setAudioOutput(id)} onResume={() => lamma.resumeCallAudio()} />}
    {!communicationLocked && !ui.open && notification && lamma.notifications?.enabled !== false && !notificationMuted && <div className="lamma-notification" role="status"><button type="button" onClick={() => { dismissNotification(); if (notification.friend) ui.openChat(notification.friend.id); else ui.show({ type: 'list', tab: 'requests' }); }}><span><LammaIcon name={notification.type === 'request' ? 'people' : 'chat'} /></span><div><strong>{notification.type === 'request' ? 'وصلك طلب صداقة' : privateSurface ? 'رسالة جديدة في ميدان' : `رسالة من ${nameOf(notification.friend)}`}</strong><small>{lamma.notifications?.previews && !privateSurface ? notification.friend?.lastMessage?.text || 'افتح اللّمة لتشوف الجديد' : 'اضغط لفتح اللّمة'}</small></div></button><LammaButton label="إخفاء التنبيه" icon="close" onClick={dismissNotification} /></div>}
    {!communicationLocked && !ui.open && !notification && lamma.notification && lamma.notifications?.enabled !== false && <div className="lamma-notification" role="status"><button type="button" onClick={() => { const id = lamma.notification.groupId || lamma.notification.conversationId; lamma.clearNotification(); ui.openGroup(id); }}><span><LammaIcon name="people" /></span><div><strong>{privateSurface ? 'رسالة جديدة في ميدان' : lamma.notification.title}</strong><small>اضغط لفتح اللّمة</small></div></button><LammaButton label="إخفاء التنبيه" icon="close" onClick={lamma.clearNotification} /></div>}
    {drawerOpen && !communicationLocked && <div className="lamma-layer" onPointerDown={event => { if (event.target === event.currentTarget) ui.close(); }}>{panelContent}</div>}
    {ui.presentation === 'page' && pageHost && createPortal(communicationLocked ? <div className="lamma-host" role="status"><p>التواصل متوقف أثناء نشاط مافيا في حسابك. أكمل المجلس أو غادر الطابور للعودة إلى اللّمة.</p><Button onClick={()=>navigate('/online/mafia')}>العودة إلى مافيا</Button></div> : panelContent, pageHost)}
    <SignInSheet open={signIn} onClose={() => setSignIn(false)} note="سجّل الدخول للّمة، أصحابك ينتظرونك." />
    {dialogsOwned && search && <SearchDialog social={social} onClose={() => setSearch(false)} run={run} busy={busy} onOpen={ui.openChat} onProfile={ui.openProfile} />}
    {dialogsOwned && inviteTarget && <GameInviteDialog key={`${account.user?.id}:${inviteTarget.targetType}:${inviteTarget.targetId}`} target={inviteTarget} lamma={lamma} initialCode={ui.invite?.roomCode || (route.name === 'room' ? route.params.id : '')} canCreate={!['play', 'room'].includes(route.name)} memberCount={inviteTarget.targetType === 'group' ? groupMemberCount(groups.find(item => item.id === inviteTarget.targetId)) : 2} onClose={() => setInviteTarget(null)} onLaunched={code => { ui.close(); navigate(`/room/${code}`); }} notify={notify} />}{dialogsOwned && preferences && <Preferences lamma={lamma} social={social} onClose={() => setPreferences(false)} notify={notify} />}
    {dialogsOwned && groupEditor && <GroupEditor key={groupEditor.id || 'new'} group={groupEditor.create ? null : groupEditor} detail={lamma.groupConversations?.[groupEditor.id]} friends={friends} accountId={account.user?.id} lamma={lamma} onClose={() => setGroupEditor(null)} onCreated={ui.openGroup} notify={notify} />}
    {dialogsOwned && menu && <Modal title={group ? 'خيارات اللّمة' : nameOf(menu)} className="lamma-dialog" onClose={() => setMenu(null)}><div className="lamma-menu"><button type="button" onClick={() => { setInviteTarget({ targetType, targetId }); setMenu(null); }}><LammaIcon name="game" />دعوة للعبة</button>{group ? <button data-design-id="group-manage" type="button" onClick={() => { setGroupEditor(group); setMenu(null); }}><LammaIcon name="people" />الأعضاء وإدارة اللّمة</button> : <button type="button" onClick={() => { ui.openProfile(menu.id); setMenu(null); }}><LammaIcon name="people" />عرض البروفايل</button>}<button type="button" onClick={async () => { const muted = isConversationMuted(lamma.notifications, targetType, targetId); if (await run(() => lamma.setConversationMuted({ targetType, targetId, muted: !muted }), 'mute-chat', muted ? 'شُغّلت تنبيهات المحادثة' : 'كُتمت تنبيهات المحادثة')) setMenu(null); }}><LammaIcon name="bell" />{isConversationMuted(lamma.notifications, targetType, targetId) ? 'تشغيل التنبيهات' : 'كتم تنبيهات المحادثة'}</button>{!group && <><button type="button" onClick={() => { setAction({ kind: 'remove', user: menu }); setMenu(null); }}>إزالة من الأصدقاء</button><button type="button" className="is-danger" onClick={() => { setAction({ kind: 'block', user: menu }); setMenu(null); }}>حظر الحساب</button><button type="button" onClick={() => { setAction({ kind: 'report', user: menu }); setMenu(null); }}>إبلاغ عن الحساب</button></>}</div></Modal>}
    {dialogsOwned && action && (action.groupId ? <GroupMessageAction action={action} lamma={lamma} social={social} onClose={() => setAction(null)} notify={notify} /> : <ActionDialog action={action} social={social} onClose={() => setAction(null)} onComplete={kind => { notify(kind === 'report' ? 'وصل بلاغك' : 'تمّ'); if (kind === 'block' || kind === 'remove') ui.show(); }} />)}
    {!communicationLocked && lamma.incomingCall && !lamma.activeCall && <div className="lamma-incoming-call" role="alertdialog" aria-label="مكالمة واردة" aria-modal="false"><span className="lamma-ringing-avatar"><LammaIcon name="phone" size={29} /></span><div><small>مكالمة صوتية واردة</small><strong>{privateSurface ? 'أحد أصحابك يتصل' : lamma.incomingCall.name || nameOf(friends.find(item => item.id === lamma.incomingCall.initiatorId))}</strong></div><LammaButton label="رفض المكالمة" icon="end" className="lamma-call-end" disabled={!!busy} onClick={() => run(() => lamma.declineCall(lamma.incomingCall.id), 'decline')} /><LammaButton label="قبول المكالمة" icon="phone" className="lamma-call-accept" disabled={!!busy || !lamma.capabilities?.liveCalls} onClick={() => run(() => lamma.acceptCall(lamma.incomingCall.id), 'accept')} /></div>}
  </>;
  return host ? createPortal(tree, host) : tree;
}
