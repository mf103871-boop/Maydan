import { tr, getUiLocale, localeDirection } from '../shared/i18n/core.js';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Modal } from '../shared/ui/components.jsx';
import { useVisualViewport } from '../shared/ui/useVisualViewport.js';
import { useAccount } from '../shared/account/context.js';
import { SignInSheet } from '../shared/account/SignInSheet.jsx';
import { navigate } from '../platform/router.js';
import { useSocial } from './SocialProvider.jsx';
import socialCss from './social.css';
import { ProfileAvatar } from '../profiles/ProfileAvatar.jsx';
import { PlayerName } from '../profiles/PlayerIdentity.jsx';
import { useSubmitKey } from '../shared/ui/useSubmitKey.js';
import { StickerMessage } from './PlusStickers.jsx';
import { useSocialSendAudio } from './useSocialSendAudio.js';

const MAX_TEXT = 2000;
const EMPTY_CONVERSATION = { messages: [], loading: false };
const EMPTY_LIST = [];
const paths = {
  back: 'M9 5l7 7-7 7M16 12H4',
  chat: 'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H5l-4 3V11.5a8.5 8.5 0 0 1 17-0M7 9h7M7 13h4',
  people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  plus: 'M12 5v14M5 12h14',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  copy: 'M8 8h12v13H8zM16 8V3H3v13h5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  send: 'M21 3L3 10l7 4 4 7 7-18ZM10 14l11-11',
  check: 'M5 12l4 4L19 6',
  double: 'M2 12l4 4L16 6M10 16l4 4L24 10',
  clock: 'M12 8v4l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  lock: 'M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4',
  close: 'M6 6l12 12M6 18L18 6',
  down: 'M6 9l6 6 6-6',
  inbox: 'M3 4h18v16H3zM3 13h5l2 3h4l2-3h5',
  shield: 'M12 2l8 3v7c0 5-8 10-8 10S4 17 4 12V5l8-3ZM8 8l8 8M16 8l-8 8',
};
export function Icon({ name, size = 22 }) {
  return <svg data-directional={name === 'back' ? 'back' : undefined} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.chat} /></svg>;
}
export function IconAction({ label, icon, className = '', ...props }) {
  return <button type="button" data-design-id={props['data-design-id'] || ({ back:'back', chat:'friend-chat', people:'profile', plus:'add-friend', search:'search', more:'menu', send:'send', check:'confirm', double:'confirm', clock:'notice', lock:'privacy', close:'close', down:'new-messages', inbox:'messages', shield:'report' })[icon]} className={'social-icon-button ' + className} aria-label={label} title={label} {...props}><Icon name={icon} /></button>;
}
function displayName(user) { return user?.name?.trim() || tr("لاعب ميدان"); }
function timestamp(value) {
  const number = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
export function messageKey(message) { return message.seq != null ? 'message-' + message.seq : 'local-' + message.clientId; }
export function dayLabel(value, now = Date.now()) {
  const date = new Date(timestamp(value));
  const today = new Date(now);
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (!timestamp(value)) return '';
  if (date.toDateString() === today.toDateString()) return tr("اليوم");
  if (date.toDateString() === yesterday.toDateString()) return tr("أمس");
  return date.toLocaleDateString(getUiLocale(), { day: 'numeric', month: 'long', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
}
function timeLabel(value) {
  return timestamp(value) ? new Date(timestamp(value)).toLocaleTimeString(getUiLocale(), { hour: 'numeric', minute: '2-digit' }) : '';
}
export function presenceLabel(user, now = Date.now()) {
  if (user?.online) return tr("متصل الآن");
  const last = timestamp(user?.lastActiveAt);
  if (!last) return tr("غير متصل");
  const minutes = Math.max(0, Math.floor((now - last) / 60000));
  if (minutes < 1) return tr("آخر ظهور قبل قليل");
  if (minutes < 60) return tr("آخر ظهور قبل ") + minutes.toLocaleString(getUiLocale()) + tr(" دقيقة");
  if (minutes < 1440) return tr("آخر ظهور ") + timeLabel(last);
  return tr("آخر ظهور ") + dayLabel(last, now);
}
export function PersonAvatar({ user, large = false, presence = false }) {
  return <span className={'social-avatar' + (large ? ' is-large' : '')} aria-hidden="true"><ProfileAvatar user={user} size={large ? 66 : 44} />{presence && <i className={user?.online ? 'is-online' : ''} />}</span>;
}
function EmptyState({ icon = 'chat', title, children, action, compact = false }) {
  return <div className={'social-empty' + (compact ? ' is-compact' : '')}><span className="social-empty-art"><Icon name={icon} size={38} /></span><h2>{title}</h2>{children && <p>{children}</p>}{action}</div>;
}
function Notice({ children, error = false, onDismiss }) {
  return <div className={'social-notice' + (error ? ' is-error' : '')} role={error ? 'alert' : 'status'}><span>{children}</span>{onDismiss && <IconAction label={tr("إخفاء التنبيه")} icon="close" onClick={onDismiss} />}</div>;
}
function friendlyError(error) {
  const text = typeof error === 'string' ? error : error?.message;
  return text && /[\u0600-\u06ff]/.test(text) ? text : tr("تعذّر إكمال الخطوة. حاول مرة أخرى.");
}
function LoadingRows() {
  return <div className="social-loading" role="status" aria-label={tr("جارٍ تحميل الأصدقاء")}>{[1, 2, 3].map(i => <span key={i}><i /><b /></span>)}</div>;
}
function Badge({ count, label }) {
  if (!count) return null;
  return <span className="social-badge" aria-label={label || count + tr(" غير مقروءة")}>{count > 99 ? '99+' : count.toLocaleString(getUiLocale())}</span>;
}
export function FriendRow({ friend, active, onOpen, onMenu, onProfile = () => navigate(`/profile/${friend.id}`), conversation = false }) {
  const last = friend.lastMessage;
  const preview = last ? (last.deletedAt ? tr("حُذفت رسالة") : last.text) : presenceLabel(friend);
  return <div className={'social-person-row' + (active ? ' is-selected' : '')}>
    <button data-design-id="friend-avatar" type="button" className="social-person-main" onClick={conversation ? onOpen : onProfile} aria-label={(conversation ? tr("فتح محادثة ") : tr("عرض بروفايل ")) + displayName(friend)}>
      <PersonAvatar user={friend} presence />
      <span className="social-person-copy"><span className="social-person-title"><strong><PlayerName user={friend} card compact /></strong>{conversation && last && <time dateTime={new Date(timestamp(last.createdAt) || Date.now()).toISOString()}>{dayLabel(last.createdAt) === tr("اليوم") ? timeLabel(last.createdAt) : dayLabel(last.createdAt)}</time>}</span><span className={'social-person-sub' + (!conversation && friend.online ? ' is-online' : '')}>{conversation ? preview : presenceLabel(friend)}</span></span>
      <Badge count={friend.unreadCount} />
    </button>
    {!conversation && <button data-design-id="friend-chat" type="button" className="social-icon-button social-open-chat" aria-label={tr("فتح محادثة ") + displayName(friend)} aria-current={active ? 'page' : undefined} onClick={onOpen}><Icon name="chat" size={20} /></button>}
    <IconAction label={tr("خيارات ") + displayName(friend)} icon="more" onClick={onMenu} />
  </div>;
}
export function RequestRow({ request, outgoing, busy, onAccept, onReject, onCancel, onMenu, onProfile = () => navigate(`/profile/${request.user.id}`) }) {
  return <article className="social-request-row"><div className="social-request-identity"><PersonAvatar user={request.user} /><div><button data-design-id="profile" type="button" className="social-profile-link" aria-label={tr("عرض بروفايل ") + displayName(request.user)} onClick={onProfile}><strong><PlayerName user={request.user} card compact /></strong></button><small>{outgoing ? tr("بانتظار الموافقة") : tr("يريد إضافتك إلى أصدقائه")}</small></div><IconAction label={tr("خيارات ") + displayName(request.user)} icon="more" onClick={onMenu} /></div><div className="social-request-actions">{outgoing ? <Button data-design-id="friend-cancel" variant="ghost" disabled={busy} onClick={onCancel}>{tr("إلغاء الطلب")}</Button> : <><Button data-design-id="friend-accept" variant="primary" loading={busy} onClick={onAccept}>{tr("قبول الطلب")}</Button><Button data-design-id="friend-reject" variant="ghost" disabled={busy} onClick={onReject}>{tr("رفض")}</Button></>}</div></article>;
}
export function messageSender(message, conversation, account) {
  if (message.senderId === account?.user?.id) return { ...account.user, name: tr("أنت") };
  const member = conversation?.members?.find(value => (value.userId || value.id || value.user?.id || value.profile?.id) === message.senderId);
  return member ? { ...(member.user || member.profile || member), id: message.senderId } : { id: message.senderId, name: tr("عضو اللّمة") };
}
export function MessageBubble({ message, mine, sender, read = false, onEdit, onDelete, onReport, onRetry, content, retrySound, continues = false }) {
  const pending = message.status === 'pending';
  const failed = message.status === 'failed';
  const deleted = Boolean(message.deletedAt);
  const richContent = content || (message.kind === 'sticker' ? <StickerMessage message={message} /> : null);
  const [menu, setMenu] = useState(false);
  const sentLabel = failed ? tr("لم تُرسل") : pending ? tr("جارٍ الإرسال") : read || message.read ? tr("قُرئت") : tr("أُرسلت");
  return <article data-message-key={messageKey(message)} className={'social-message ' + (mine ? 'is-mine' : 'is-theirs') + (failed ? ' is-failed' : '') + (continues ? ' is-continuation' : '')} aria-label={mine ? tr("رسالتك") : sender ? tr("رسالة من ") + displayName(sender) : tr("رسالة صديقك")}>
    <div data-design-id="message" className={'social-bubble' + (deleted ? ' is-deleted' : '')}>{sender && !mine && !continues && <div className="social-message-sender"><ProfileAvatar user={sender} size={24} /><strong><PlayerName user={sender} name={mine ? tr("أنت") : displayName(sender)} card compact /></strong></div>}{!deleted && richContent ? richContent : <p dir="auto">{deleted ? tr("حُذفت هذه الرسالة") : message.text}</p>}<div className="social-message-meta">{message.editedAt && !deleted && <span>{tr("معدّلة")}</span>}<time dateTime={timestamp(message.createdAt) ? new Date(timestamp(message.createdAt)).toISOString() : undefined}>{timeLabel(message.createdAt)}</time>{mine && <span className={'social-delivery' + (read || message.read ? ' is-read' : '')} aria-label={sentLabel} title={sentLabel}><Icon name={pending ? 'clock' : read || message.read ? 'double' : 'check'} size={15} /><span>{sentLabel}</span></span>}</div></div>
    {!deleted && !pending && !failed && <div className="social-message-actions"><IconAction label={mine ? tr("خيارات رسالتك") : tr("خيارات الرسالة")} icon="more" aria-expanded={menu} onClick={() => setMenu(v => !v)} />{menu && <div className="social-message-menu">{mine ? <>{(!message.kind || message.kind === 'text') && <button data-design-id="message-edit" type="button" onClick={() => { setMenu(false); onEdit?.(); }}>{tr("تعديل")}</button>}<button data-design-id="message-delete" type="button" className="is-danger" onClick={() => { setMenu(false); onDelete?.(); }}>{tr("حذف")}</button></> : <button data-design-id="report" type="button" onClick={() => { setMenu(false); onReport?.(); }}>{tr("إبلاغ عن الرسالة")}</button>}</div>}</div>}
    {mine && failed && <button type="button" className="social-retry" data-design-id="message-retry" data-sound={retrySound} onClick={onRetry}>{tr("إعادة الإرسال")}</button>}
  </article>;
}
export function Conversation({ friend, conversation = EMPTY_CONVERSATION, account, social, onMenu, onBack, onAction, notify, onProfile = () => navigate(`/profile/${friend.id}`), headerActions, composerExtras, renderContent, draftValue, onDraftChange, subtitle, compactHeader = false, onClose, visible = true, designScreen = 'social.conversation' }) {
  const messages = conversation.messages || EMPTY_LIST;
  const messageScope=conversation.group||Array.isArray(conversation.members)?'group':'direct';
  const sendAudio=useSocialSendAudio(account?.user?.id,messageScope,conversation.id||friend.conversationId||(messageScope==='group'?friend.id:null));
  const [localText, setLocalText] = useState('');
  const text = draftValue === undefined ? localText : draftValue;
  const setText = onDraftChange || setLocalText;
  const [sending, setSending] = useState(false);
  const [newBelow, setNewBelow] = useState(false);
  const scroller = useRef(null);
  const composer = useRef(null);
  const nearBottom = useRef(true);
  const initialScroll = useRef(false);
  const olderAnchor = useRef(null);
  const readingAnchor = useRef(null);
  const lastKey = useRef('');
  const typingTimer = useRef(null);
  const typingActive = useRef(false);
  const typingSentAt = useRef(0);
  const rememberReading = () => {
    const el = scroller.current;
    if (!el || nearBottom.current) { readingAnchor.current = null; return; }
    const bounds = el.getBoundingClientRect();
    readingAnchor.current = [...el.querySelectorAll('[data-message-key]')].map(node => ({ key: node.dataset.messageKey, box: node.getBoundingClientRect() }))
      .filter(item => item.box.bottom > bounds.top && item.box.top < bounds.bottom)
      .map(item => ({ key: item.key, offset: item.box.top - bounds.top }));
  };
  const restoreReading = () => {
    const el = scroller.current;
    if (!el || !readingAnchor.current?.length) return false;
    const nodes = [...el.querySelectorAll('[data-message-key]')];
    for (const item of readingAnchor.current) {
      const node = nodes.find(value => value.dataset.messageKey === item.key);
      if (node) { el.scrollTop += node.getBoundingClientRect().top - el.getBoundingClientRect().top - item.offset; return true; }
    }
    return false;
  };
  useEffect(() => visible ? social.registerConversation?.(friend.id) : undefined, [friend.id, visible, social.registerConversation]);
  const stopped = () => {
    clearTimeout(typingTimer.current);
    if (typingActive.current) {
      typingActive.current = false;
      Promise.resolve(social.setTyping(friend.id, false)).catch(() => {});
    }
  };
  const goBottom = (smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth && !reduced ? 'smooth' : 'auto' });
    nearBottom.current = true; setNewBelow(false);
    Promise.resolve(social.markRead(friend.id)).catch(() => {});
  };
  useEffect(() => {
    Promise.resolve(social.openConversation(friend.id)).catch(error => notify(friendlyError(error), true));
    return () => { clearTimeout(typingTimer.current); Promise.resolve(social.setTyping(friend.id, false)).catch(() => {}); };
  }, [friend.id, social.openConversation, social.setTyping]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || conversation.loading) return;
    const key = messages.length ? messageKey(messages[messages.length - 1]) : '';
    if (olderAnchor.current && !conversation.loadingOlder) {
      if (!restoreReading()) el.scrollTop = olderAnchor.current.top + el.scrollHeight - olderAnchor.current.height;
      olderAnchor.current = null;
    } else if (!initialScroll.current || (key !== lastKey.current && nearBottom.current)) {
      el.scrollTop = el.scrollHeight;
      initialScroll.current = true;
    } else {
      if (!nearBottom.current) restoreReading();
      if (key !== lastKey.current) setNewBelow(true);
    }
    lastKey.current = key;
    rememberReading();
  }, [messages, conversation.loading, conversation.loadingOlder, friend.id, social.markRead]);
  // A cached conversation can render before the provider has selected its route.
  // Retry after its refreshed messages arrive, even when the last message is unchanged.
  useEffect(() => {
    if (!conversation.loading && messages.length && nearBottom.current) {
      Promise.resolve(social.markRead(friend.id)).catch(() => {});
    }
  }, [messages, conversation.loading, friend.id, social.markRead]);
  useEffect(() => {
    const onVisible = () => { if (!document.hidden && nearBottom.current) Promise.resolve(social.markRead(friend.id)).catch(() => {}); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [friend.id, social.markRead]);
  useEffect(() => {
    if (typeof ResizeObserver !== 'function' || !scroller.current) return;
    const observer = new ResizeObserver(() => {
      if (nearBottom.current && !olderAnchor.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
    });
    observer.observe(scroller.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const el = composer.current;
    if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 144) + 'px'; }
  }, [text]);
  const changeText = value => {
    setText(value);
    if (!value.trim()) { stopped(); return; }
    clearTimeout(typingTimer.current);
    if (!typingActive.current || Date.now() - typingSentAt.current > 2500) {
      typingActive.current = true; typingSentAt.current = Date.now();
      Promise.resolve(social.setTyping(friend.id, true)).catch(() => {});
    }
    typingTimer.current = setTimeout(stopped, 2400);
  };
  const send = async event => {
    event?.preventDefault();
    const value = text.trim();
    if (!value || sending || social.offline) return;
    setSending(true); setText(''); stopped(); nearBottom.current = true;
    const ticket=sendAudio.begin();
    try { const message=await social.sendMessage(friend.id, value);sendAudio.accepted(ticket,message); }
    catch (error) { notify(friendlyError(error), true); }
    finally { setSending(false); }
  };
  const submitKeys = useSubmitKey(send);
  const retry=async message=>{const ticket=sendAudio.begin();try{const result=await social.retryMessage(friend.id,message.clientId);sendAudio.accepted(ticket,result);}catch(error){notify(friendlyError(error),true);}};
  const loadOlder = async () => {
    const el = scroller.current;
    if (!el || conversation.loadingOlder) return;
    nearBottom.current = false; rememberReading();
    olderAnchor.current = { top: el.scrollTop, height: el.scrollHeight };
    try { await social.loadOlder(friend.id); }
    catch (error) { olderAnchor.current = null; notify(friendlyError(error), true); }
  };
  return <section data-design-screen={designScreen || undefined} className="social-chat" aria-label={tr("المحادثة مع ") + displayName(friend)}>
    <header data-design-id="header" className={'social-chat-head' + (compactHeader ? ' is-unified' : '')}>
      <IconAction label={tr("العودة للأصدقاء")} icon="back" className="social-mobile-back" onClick={onBack} />
      <button data-design-id="profile" type="button" className="social-icon-button social-chat-avatar" aria-label={tr("عرض بروفايل ") + displayName(friend)} onClick={onProfile}><PersonAvatar user={friend} presence /></button>
      <div className="social-chat-person"><h2><button data-design-id="profile" type="button" className="social-profile-link" onClick={onProfile}><PlayerName user={friend} card compact /></button></h2><p className={friend.online || conversation.typing ? 'is-online' : ''}>{subtitle || (conversation.typing ? tr("يكتب الآن…") : presenceLabel(friend))}</p></div>
      {compactHeader && headerActions ? <div className="social-chat-header-actions" role="group" aria-label={tr("أدوات المحادثة")}>{headerActions}</div> : headerActions}
      <IconAction label={tr("خيارات المحادثة")} icon="more" aria-haspopup="dialog" onClick={onMenu} />
      {onClose && <IconAction label={tr("إغلاق اللّمة والعودة للعبة")} icon="close" onClick={onClose} />}
    </header>
    <div data-design-id="messages" className="social-message-area">
      <div ref={scroller} className="social-message-scroll" role="log" aria-label={tr("الرسائل")} aria-live="polite" aria-relevant="additions text" onScroll={() => { const el = scroller.current; nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 72; rememberReading(); if (nearBottom.current) { setNewBelow(false); Promise.resolve(social.markRead(friend.id)).catch(() => {}); } }}>
        {conversation.hasMore && <button type="button" data-design-id="older-messages" className="social-load-older" onClick={loadOlder} disabled={conversation.loadingOlder}>{conversation.loadingOlder ? tr("جارٍ التحميل…") : tr("تحميل الرسائل الأقدم")}</button>}
        {conversation.loading && messages.length === 0 ? <LoadingRows /> : messages.length === 0 && !conversation.error ? <EmptyState compact title={tr("هنا تبدأ السوالف")} icon="chat">{tr("أرسل أول رسالة إلى ")}{displayName(friend)}.</EmptyState> : null}
        {conversation.error && <Notice error>{conversation.error}<button data-design-id="retry" type="button" className="social-inline-link" onClick={() => Promise.resolve(social.openConversation(friend.id)).catch(error => notify(friendlyError(error), true))}>{tr("حاول مجددًا")}</button></Notice>}
        {messages.map((message, index) => {
          const date = dayLabel(message.createdAt);
          const showDate = index === 0 || new Date(timestamp(message.createdAt)).toDateString() !== new Date(timestamp(messages[index - 1].createdAt)).toDateString();
          const mine = message.senderId === account.user.id;
          const previous = messages[index - 1];
          const continues = !showDate && previous?.senderId === message.senderId && !previous.deletedAt && !message.deletedAt && message.status !== 'failed' && timestamp(message.createdAt) - timestamp(previous.createdAt) >= 0 && timestamp(message.createdAt) - timestamp(previous.createdAt) < 180000;
          return <React.Fragment key={messageKey(message)}>{showDate && <div className="social-day"><span>{date}</span></div>}<MessageBubble message={message} mine={mine} continues={continues} sender={conversation.group || Array.isArray(conversation.members) ? messageSender(message, conversation, account) : undefined} content={renderContent?.(message)} read={mine && Number(message.seq) > 0 && Number(message.seq) <= Number(conversation.peerReadSeq || 0)} onEdit={() => onAction({ kind: 'edit', user: friend, message })} onDelete={() => onAction({ kind: 'delete', user: friend, message })} onReport={() => onAction({ kind: 'report', user: friend, message })} retrySound="none" onRetry={() => retry(message)} /></React.Fragment>;
        })}
        {conversation.typing && <div className="social-typing" role="status" aria-label={displayName(friend) + tr(" يكتب الآن")}><span /><span /><span /><small>{tr("يكتب الآن")}</small></div>}
      </div>
      {newBelow && <button type="button" data-design-id="new-messages" className="social-jump" onClick={() => goBottom(true)}><Icon name="down" size={16} />{tr("رسائل جديدة")}</button>}
    </div>
    <form data-design-id="composer" className="social-composer" onSubmit={send}>{composerExtras}
      {social.offline && <p className="social-composer-note" role="status">{tr("أنت غير متصل. ستتمكن من الإرسال عند عودة الاتصال.")}</p>}
      <div className="social-composer-row"><textarea dir="auto" data-design-id="message-input" ref={composer} rows={1} maxLength={MAX_TEXT} value={text} aria-label={tr("اكتب رسالة")} placeholder={tr("اكتب رسالة…")} enterKeyHint="send" onChange={event => changeText(event.target.value)} onBlur={stopped} {...submitKeys} /><button type="submit" data-design-id="send" data-sound="none" className="social-send" aria-label={tr("إرسال الرسالة")} disabled={!text.trim() || sending || social.offline}><Icon name="send" /></button></div>
      {text.length > MAX_TEXT - 200 && <small className="social-character-count" role="status">{text.length.toLocaleString(getUiLocale())} / {MAX_TEXT.toLocaleString(getUiLocale())}</small>}
    </form>
  </section>;
}
export function SearchDialog({ social, onClose, run, busy, onOpen, onProfile = id => navigate(`/profile/${id}`) }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [requested, setRequested] = useState(new Set());
  const generation = useRef(0);
  useEffect(() => {
    const gen = ++generation.current;
    if (query.trim().length < 2) { setResults([]); setLoading(false); setSearched(false); setError(''); return; }
    setLoading(true); setError(''); setResults([]); setSearched(false);
    const timer = setTimeout(async () => {
      try { const users = await social.searchUsers(query.trim()); if (gen === generation.current) { setResults(users || []); setSearched(true); } }
      catch (err) { if (gen === generation.current) setError(friendlyError(err)); }
      finally { if (gen === generation.current) setLoading(false); }
    }, 350);
    return () => { clearTimeout(timer); generation.current += 1; };
  }, [query, social.searchUsers]);
  return <Modal data-design-screen="social.search" title={tr("البحث عن أصدقاء")} onClose={onClose} className="social-dialog social-friend-search"><p className="social-dialog-intro">{tr("ابحث باسم صديقك أو أدخل رمز ميدان الخاص به.")}</p><label className="social-search"><Icon name="search" size={20} /><input data-design-id="search-input" autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={tr("الاسم أو رمز الصديق")} aria-label={tr("ابحث بالاسم أو رمز الصديق")} maxLength={100} autoComplete="off" /></label><div className="social-search-results" aria-live="polite">{searched && results.length > 0 && <h3>{tr("نتائج البحث")}</h3>}{error && <Notice error>{error}</Notice>}{loading ? <LoadingRows /> : !searched ? !error && <p className="social-search-hint">{tr("اكتب حرفين على الأقل لبدء البحث.")}</p> : results.length === 0 ? <EmptyState compact title={tr("لم نجد هذا الاسم")} icon="search">{tr("جرّب رمز صديقك أو تأكد من كتابة الاسم.")}</EmptyState> : results.map(user => {
    const isFriend = user.relationship === 'friend';
    const pending = requested.has(user.id) || user.relationship === 'pending_outgoing';
    return <div key={user.id} className="social-search-result"><PersonAvatar user={user} /><div><button data-design-id="profile" type="button" className="social-profile-link" aria-label={tr("عرض بروفايل ") + displayName(user)} onClick={() => { onClose(); onProfile(user.id); }}><strong><PlayerName user={user} card compact /></strong></button><small>{presenceLabel(user)}{user.code && <> · <bdi>{user.code}</bdi></>}</small></div>{isFriend ? <Button data-design-id="friend-chat" variant="secondary" onClick={() => { onClose(); onOpen(user.id); }}>{tr("محادثة")}</Button> : pending ? <span className="social-status-pill">{tr("تم إرسال الطلب")}</span> : user.relationship === 'pending_incoming' ? <span className="social-status-pill">{tr("طلب وارد")}</span> : <Button data-design-id="add-friend" variant="primary" loading={busy === 'invite-' + user.id} disabled={social.offline || Boolean(busy)} onClick={async () => { setError(''); const ok = await run(() => social.sendRequest(user.id), 'invite-' + user.id, tr("أُرسل طلب الصداقة"), setError); if (ok) setRequested(prev => new Set([...prev, user.id])); }}>{tr("إضافة")}</Button>}</div>;
  })}</div></Modal>;
}
export function ActionDialog({ action, social, onClose, onComplete }) {
  const { kind, user, message } = action;
  const [text, setText] = useState(message?.text || '');
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const config = {
    remove: [tr("إزالة الصديق؟"), tr("ستتوقف المراسلة بينكما حتى تقبلا طلب صداقة جديدًا."), tr("إزالة الصديق")],
    block: [tr("حظر ") + displayName(user) + '؟', tr("لن يستطيع إرسال طلبات صداقة أو رسائل إليك، وسيُزال من أصدقائك."), tr("حظر")],
    unblock: [tr("إلغاء الحظر؟"), tr("سيتمكن هذا الشخص من العثور عليك وإرسال طلب صداقة جديد."), tr("إلغاء الحظر")],
    delete: [tr("حذف الرسالة؟"), tr("ستُحذف من المحادثة لديك ولدى صديقك. لا يمكنك التراجع عن الحذف."), tr("حذف الرسالة")],
    edit: [tr("تعديل الرسالة"), tr("سيظهر لصديقك أن الرسالة عُدّلت."), tr("حفظ التعديل")],
    report: [message ? tr("الإبلاغ عن رسالة") : tr("الإبلاغ عن حساب"), tr("اختر سبب الإبلاغ. لن نعرض بلاغك لهذا الشخص."), tr("إرسال البلاغ")],
  }[kind];
  const confirm = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (kind === 'remove') await social.removeFriend(user.id);
      if (kind === 'block') await social.blockUser(user.id);
      if (kind === 'unblock') await social.unblockUser(user.id);
      if (kind === 'delete') await social.deleteMessage(user.id, message.seq);
      if (kind === 'edit') await social.editMessage(user.id, message.seq, text.trim());
      if (kind === 'report') await social.reportUser(user.id, { reason: [reason, details.trim()].filter(Boolean).join(': '), ...(message?.seq != null ? { messageSeq: message.seq } : {}) });
      onComplete(kind); onClose();
    } catch (err) { setError(friendlyError(err)); setBusy(false); }
  };
  return <Modal data-design-screen="social.action" title={config[0]} onClose={busy ? null : onClose} className="social-dialog" footer={<><Button data-design-id="cancel" variant="ghost" disabled={busy} onClick={onClose}>{tr("إلغاء")}</Button><Button data-design-id="confirm" variant={['remove', 'block', 'delete'].includes(kind) ? 'danger' : 'primary'} loading={busy} disabled={social.offline || (kind === 'edit' && (!text.trim() || text.trim() === message.text)) || (kind === 'report' && !reason)} onClick={confirm}>{config[2]}</Button></>}><p className="social-dialog-intro">{config[1]}</p>{kind === 'edit' && <label className="social-field">{tr("نص الرسالة")}<textarea data-design-id="message-input" autoFocus value={text} maxLength={MAX_TEXT} rows={4} onChange={event => setText(event.target.value)} /></label>}{kind === 'report' && <><label className="social-field">{tr("سبب الإبلاغ")}<select data-design-id="report-reason" value={reason} onChange={event => setReason(event.target.value)}><option value="">{tr("اختر السبب")}</option>{["رسائل مزعجة", "إساءة أو تنمر", "محتوى غير مناسب", "انتحال شخصية", "سبب آخر"].map(value => <option key={value} value={value}>{tr(value)}</option>)}</select></label><label className="social-field">{tr("تفاصيل إضافية ")}<small>{tr("(اختياري)")}</small><textarea data-design-id="report-details" value={details} maxLength={800} rows={3} placeholder={tr("أخبرنا بما حدث…")} onChange={event => setDetails(event.target.value)} /></label></>}{error && <Notice error>{error}</Notice>}</Modal>;
}
export function SocialView({ account, social, friendId, onNavigate = navigate }) {
  const [tab, setTab] = useState('friends');
  const [filter, setFilter] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [menu, setMenu] = useState(null);
  const [action, setAction] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [copied, setCopied] = useState(false);
  const screen = useRef(null);
  const noticeTimer = useRef(null);
  const friends = social.friends || EMPTY_LIST;
  const incoming = social.incoming || EMPTY_LIST;
  const outgoing = social.outgoing || EMPTY_LIST;
  const blocked = social.blocked || EMPTY_LIST;
  const friend = friends.find(user => user.id === friendId);
  const notify = (text, error = false) => { clearTimeout(noticeTimer.current); setNotice({ text, error }); if (!error) noticeTimer.current = setTimeout(() => setNotice(null), 4500); };
  useEffect(() => () => clearTimeout(noticeTimer.current), []);
  useEffect(() => {
    setMenu(null); setAction(null); setSearchOpen(false); setBlockedOpen(false); setNotice(null); setCopied(false); setFilter('');
  }, [account.user?.id]);
  useEffect(() => { if (account.signedIn) Promise.resolve(social.refresh()).catch(error => notify(friendlyError(error), true)); }, [account.signedIn, social.refresh]);
  useVisualViewport(screen, { heightProperty: '--social-height', topProperty: '--social-top' });
  const run = async (fn, key, success, onError) => {
    if (busy) return false;
    setBusy(key);
    try { await fn(); if (success) notify(success); return true; }
    catch (error) { if (onError) onError(friendlyError(error)); else notify(friendlyError(error), true); return false; }
    finally { setBusy(''); }
  };
  const openFriend = id => onNavigate('/friends/' + encodeURIComponent(id));
  const code = social.profile?.code;
  const copyCode = async () => {
    try {
      if (!code || !navigator.clipboard?.writeText) throw new Error(tr("يمكنك تحديد رمزك ونسخه يدويًا."));
      await navigator.clipboard.writeText(code); setCopied(true); notify(tr("نُسخ رمزك. أرسله لصديقك ليضيفك."));
    } catch (error) { notify(friendlyError(error), true); }
  };
  const visibleFriends = friends.filter(user => displayName(user).toLocaleLowerCase('ar').includes(filter.trim().toLocaleLowerCase('ar'))).filter(user => tab !== 'chats' || user.lastMessage || user.unreadCount).sort((a, b) => tab === 'chats' ? timestamp(b.lastMessage?.createdAt) - timestamp(a.lastMessage?.createdAt) : Number(Boolean(b.online)) - Number(Boolean(a.online)));
  const unread = friends.reduce((sum, user) => sum + (user.unreadCount || 0), 0);
  const chooseAction = kind => { setAction({ kind, user: menu }); setMenu(null); };
  return <main data-design-screen="social.list" ref={screen} className={'social-screen' + (account.signedIn && friendId ? ' is-conversation' : '')} dir={localeDirection(getUiLocale())} aria-label={tr("أصدقاء ميدان")}>
    <style>{socialCss}</style>
    <header className="social-page-head"><div className="social-page-title"><IconAction label={tr("الرئيسية")} icon="back" onClick={() => onNavigate('/')} /><div><span className="social-eyebrow">{tr("ميدان يجمعكم")}</span><h1>{tr("الأصدقاء ")}<span>{tr("والمحادثات")}</span></h1></div></div>{account.signedIn && <button type="button" className="social-add-button" onClick={() => setSearchOpen(true)}><Icon name="plus" size={20} /><span>{tr("إضافة صديق")}</span></button>}</header>
    {notice && <Notice error={notice.error} onDismiss={() => setNotice(null)}>{notice.text}</Notice>}
    {!account.ready ? <LoadingRows /> : !account.signedIn ? <div className="social-signin"><EmptyState icon="people" title={tr("جمعتكم تبدأ هنا")} action={<Button variant="primary" size="lg" onClick={() => setSignInOpen(true)}>{tr("تسجيل الدخول")}</Button>}>{tr("أضف أصحابك، راسلهم، ورتّبوا جمعتكم القادمة في ميدان.")}</EmptyState><div className="social-signin-perks"><span><Icon name="people" />{tr("أصحابك في مكان واحد")}</span><span><Icon name="chat" />{tr("سوالف بينكم")}</span></div></div> : <>
      {social.offline && <Notice>{tr("انقطع الاتصال. ما زالت محادثاتك المحمّلة أمامك.")}</Notice>}
      {social.error && <Notice error>{social.error}<button data-design-id="retry" type="button" className="social-inline-link" onClick={() => run(social.refresh, 'refresh')}>{tr("إعادة المحاولة")}</button></Notice>}
      <div className="social-workspace"><aside className="social-sidebar" aria-label={tr("قائمة الأصدقاء")}>
        <div className="social-code-card"><div><span>{tr("رمزك في ميدان")}</span><strong><bdi>{code || '••••••'}</bdi></strong></div><button data-design-id="code" type="button" onClick={copyCode} disabled={!code} className="social-copy" aria-label={tr("نسخ رمز الصديق")}><Icon name={copied ? 'check' : 'copy'} size={19} /><span>{copied ? tr("نُسخ") : tr("نسخ")}</span></button></div>
        <div className="social-tabs" role="tablist" aria-label={tr("الأصدقاء والمحادثات")}>{[['friends', tr("الأصدقاء"), friends.length], ['chats', tr("المحادثات"), unread], ['requests', tr("الطلبات"), incoming.length]].map(([id, label, count]) => <button type="button" role="tab" id={'social-tab-' + id} aria-controls="social-list-panel" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onKeyDown={event => { const tabs = ['friends', 'chats', 'requests']; const rtl = localeDirection(getUiLocale()) === 'rtl'; const offset = event.key === 'ArrowLeft' ? (rtl ? 1 : -1) : event.key === 'ArrowRight' ? (rtl ? -1 : 1) : 0; if (offset || ['Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (tabs.indexOf(id) + offset + 3) % 3; setTab(tabs[next]); event.currentTarget.parentNode.querySelectorAll('[role="tab"]')[next].focus(); } }} className={tab === id ? 'is-active' : ''} key={id} onClick={() => setTab(id)}>{label}{count > 0 && <Badge count={count} label={label + ': ' + count} />}</button>)}</div>
        {tab !== 'requests' && friends.length > 0 && <label className="social-search social-list-search"><Icon name="search" size={18} /><input value={filter} onChange={event => setFilter(event.target.value)} placeholder={tr("ابحث بين أصدقائك")} aria-label={tr("ابحث بين أصدقائك")} /></label>}
        <div id="social-list-panel" className="social-list-panel" role="tabpanel" aria-labelledby={'social-tab-' + tab}>
          {social.loading && friends.length === 0 && incoming.length === 0 ? <LoadingRows /> : tab === 'requests' ? <>
            {incoming.length > 0 && <h2 className="social-list-heading">{tr("طلبات واردة ")}<span>{incoming.length.toLocaleString(getUiLocale())}</span></h2>}
            {incoming.map(request => <RequestRow key={request.id} request={request} busy={busy === request.id} onAccept={() => run(() => social.acceptRequest(request.id), request.id, tr("أُضيف إلى أصدقائك"))} onReject={() => run(() => social.rejectRequest(request.id), request.id, tr("رُفض الطلب"))} onMenu={() => setMenu(request.user)} onProfile={() => onNavigate(`/profile/${request.user.id}`)} />)}
            {outgoing.length > 0 && <h2 className="social-list-heading">{tr("طلبات أرسلتها ")}<span>{outgoing.length.toLocaleString(getUiLocale())}</span></h2>}
            {outgoing.map(request => <RequestRow key={request.id} request={request} outgoing busy={busy === request.id} onCancel={() => run(() => social.cancelRequest(request.id), request.id, tr("أُلغي الطلب"))} onMenu={() => setMenu(request.user)} onProfile={() => onNavigate(`/profile/${request.user.id}`)} />)}
            {!incoming.length && !outgoing.length && <EmptyState compact icon="inbox" title={tr("ما عندك طلبات الآن")}>{tr("طلبات الصداقة الجديدة ستظهر هنا.")}</EmptyState>}
          </> : visibleFriends.length ? visibleFriends.map(user => <FriendRow key={user.id} friend={user} active={user.id === friendId} conversation={tab === 'chats'} onOpen={() => openFriend(user.id)} onMenu={() => setMenu(user)} onProfile={() => onNavigate(`/profile/${user.id}`)} />) : <EmptyState compact icon={filter ? 'search' : tab === 'chats' ? 'chat' : 'people'} title={filter ? tr("لا يوجد اسم مطابق") : tab === 'chats' ? tr("لسّه السوالف ما بدأت") : tr("أصحابك يكملون الجمعة")} action={!filter && tab === 'friends' ? <Button variant="primary" onClick={() => setSearchOpen(true)}>{tr("أضف أول صديق")}</Button> : null}>{filter ? tr("جرّب كتابة جزء آخر من الاسم.") : tab === 'chats' ? tr("افتح محادثة من قائمة الأصدقاء وقل مرحبًا.") : tr("شارك رمزك أو ابحث عن صديق لتبدؤوا المحادثة.")}</EmptyState>}
        </div>
        <footer className="social-sidebar-footer"><button type="button" onClick={() => setBlockedOpen(true)}><Icon name="shield" size={17} />{tr("المحظورون")}{blocked.length > 0 && <span>{blocked.length.toLocaleString(getUiLocale())}</span>}</button><span>{friends.filter(user => user.online).length > 0 ? friends.filter(user => user.online).length.toLocaleString(getUiLocale()) + tr(" متصل الآن") : tr("لجمعة أقرب")}</span></footer>
      </aside>
      <div className="social-chat-panel">{friend ? <Conversation key={friend.id} friend={friend} conversation={social.conversations?.[friend.id]} account={account} social={social} onMenu={() => setMenu(friend)} onBack={() => onNavigate('/friends')} onAction={setAction} notify={notify} onProfile={() => onNavigate(`/profile/${friend.id}`)} /> : friendId ? <div className="social-unavailable"><EmptyState icon="people" title={social.loading ? tr("جارٍ فتح المحادثة…") : tr("هذه المحادثة غير متاحة")} action={<Button variant="secondary" onClick={() => onNavigate('/friends')}>{tr("العودة إلى الأصدقاء")}</Button>}>{!social.loading && tr("اختر صديقًا من قائمتك، أو أرسل طلب صداقة جديدًا.")}</EmptyState></div> : <div className="social-welcome"><span className="social-welcome-chip"><i />{tr("مساحة لسوالفكم")}</span><div className="social-welcome-art"><span><Icon name="chat" size={58} /></span><i><Icon name="people" size={34} /></i></div><h2>{tr("كل جمعة تبدأ برسالة")}</h2><p>{tr("اختَر صديقًا من القائمة،")}<br />{tr("وخَلّ التخطيط للجمعة يبدأ.")}</p><div className="social-welcome-line" /></div>}</div></div>
    </>}
    <SignInSheet open={signInOpen} onClose={() => setSignInOpen(false)} note={tr("سجّل الدخول لإضافة أصحابك ومتابعة محادثاتك من أجهزتك.")} />
    {searchOpen && <SearchDialog social={social} onClose={() => setSearchOpen(false)} run={run} busy={busy} onOpen={openFriend} onProfile={id => onNavigate(`/profile/${id}`)} />}
    {menu && <Modal title={displayName(menu)} onClose={() => setMenu(null)} className="social-dialog social-person-menu"><div className="social-menu-identity"><PersonAvatar user={menu} large /><p>{presenceLabel(menu)}</p></div><div className="social-menu-options"><button type="button" onClick={() => { onNavigate(`/profile/${menu.id}`); setMenu(null); }}><Icon name="people" />{tr("عرض البروفايل")}</button>{friends.some(user => user.id === menu.id) && <><button type="button" onClick={() => { openFriend(menu.id); setMenu(null); }}><Icon name="chat" />{tr("فتح المحادثة")}</button><button type="button" onClick={() => chooseAction('remove')}>{tr("إزالة من الأصدقاء")}</button></>}<button type="button" className="is-danger" onClick={() => chooseAction('block')}><Icon name="shield" />{tr("حظر")}</button><button type="button" onClick={() => chooseAction('report')}>{tr("إبلاغ عن الحساب")}</button></div></Modal>}
    {blockedOpen && <Modal title={tr("المحظورون")} onClose={() => setBlockedOpen(false)} className="social-dialog"><p className="social-dialog-intro">{tr("هؤلاء الأشخاص لا يمكنهم مراسلتك أو إرسال طلب صداقة إليك.")}</p>{blocked.length ? <div className="social-blocked-list">{blocked.map(user => <div key={user.id} className="social-search-result"><PersonAvatar user={user} /><strong><PlayerName user={user} card compact /></strong><Button variant="ghost" onClick={() => { setBlockedOpen(false); setAction({ kind: 'unblock', user }); }}>{tr("إلغاء الحظر")}</Button></div>)}</div> : <EmptyState compact icon="shield" title={tr("قائمتك فارغة")}>{tr("لم تحظر أي شخص.")}</EmptyState>}</Modal>}
    {action && <ActionDialog key={action.kind + '-' + action.user.id + '-' + (action.message?.seq || '')} action={action} social={social} onClose={() => setAction(null)} onComplete={kind => { notify(kind === 'report' ? tr("وصل بلاغك. شكرًا لمساعدتنا.") : kind === 'edit' ? tr("حُفظ التعديل") : kind === 'delete' ? tr("حُذفت الرسالة") : kind === 'block' ? tr("حُظر الحساب") : kind === 'unblock' ? tr("أُلغي الحظر") : tr("أُزيل من أصدقائك")); if (['remove', 'block'].includes(kind) && action.user.id === friendId) onNavigate('/friends'); }} />}
  </main>;
}
export function SocialScreen({ friendId }) {
  const account = useAccount();
  const social = useSocial();
  return <SocialView key={account.user?.id || 'guest'} account={account} social={social} friendId={friendId} />;
}
