import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Modal } from '../shared/ui/components.jsx';
import { useAccount } from '../shared/account/context.js';
import { SignInSheet } from '../shared/account/SignInSheet.jsx';
import { navigate } from '../platform/router.js';
import { useSocial } from './SocialProvider.jsx';
import socialCss from './social.css';

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
function Icon({ name, size = 22 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.chat} /></svg>;
}
function IconAction({ label, icon, className = '', ...props }) {
  return <button type="button" className={'social-icon-button ' + className} aria-label={label} title={label} {...props}><Icon name={icon} /></button>;
}
function displayName(user) { return user?.name?.trim() || 'لاعب ميدان'; }
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
  if (date.toDateString() === today.toDateString()) return 'اليوم';
  if (date.toDateString() === yesterday.toDateString()) return 'أمس';
  return date.toLocaleDateString('ar', { day: 'numeric', month: 'long', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
}
function timeLabel(value) {
  return timestamp(value) ? new Date(timestamp(value)).toLocaleTimeString('ar', { hour: 'numeric', minute: '2-digit' }) : '';
}
export function presenceLabel(user, now = Date.now()) {
  if (user?.online) return 'متصل الآن';
  const last = timestamp(user?.lastActiveAt);
  if (!last) return 'غير متصل';
  const minutes = Math.max(0, Math.floor((now - last) / 60000));
  if (minutes < 1) return 'آخر ظهور قبل قليل';
  if (minutes < 60) return 'آخر ظهور قبل ' + minutes.toLocaleString('ar') + ' دقيقة';
  if (minutes < 1440) return 'آخر ظهور ' + timeLabel(last);
  return 'آخر ظهور ' + dayLabel(last, now);
}
function PersonAvatar({ user, large = false, presence = false }) {
  const name = displayName(user);
  const hue = [...String(user?.id || name)].reduce((sum, c) => sum + c.codePointAt(0), 0) % 4;
  const letters = name.split(/\s+/).slice(0, 2).map(word => [...word][0]).join('');
  return <span className={'social-avatar social-avatar-' + hue + (large ? ' is-large' : '')} aria-hidden="true">{letters}{presence && <i className={user?.online ? 'is-online' : ''} />}</span>;
}
function EmptyState({ icon = 'chat', title, children, action, compact = false }) {
  return <div className={'social-empty' + (compact ? ' is-compact' : '')}><span className="social-empty-art"><Icon name={icon} size={38} /></span><h2>{title}</h2>{children && <p>{children}</p>}{action}</div>;
}
function Notice({ children, error = false, onDismiss }) {
  return <div className={'social-notice' + (error ? ' is-error' : '')} role={error ? 'alert' : 'status'}><span>{children}</span>{onDismiss && <IconAction label="إخفاء التنبيه" icon="close" onClick={onDismiss} />}</div>;
}
function friendlyError(error) {
  const text = typeof error === 'string' ? error : error?.message;
  return text && /[\u0600-\u06ff]/.test(text) ? text : 'تعذّر إكمال الخطوة. حاول مرة أخرى.';
}
function LoadingRows() {
  return <div className="social-loading" role="status" aria-label="جارٍ تحميل الأصدقاء">{[1, 2, 3].map(i => <span key={i}><i /><b /></span>)}</div>;
}
function Badge({ count, label }) {
  if (!count) return null;
  return <span className="social-badge" aria-label={label || count + ' غير مقروءة'}>{count > 99 ? '99+' : count.toLocaleString('ar')}</span>;
}
function FriendRow({ friend, active, onOpen, onMenu, conversation = false }) {
  const last = friend.lastMessage;
  const preview = last ? (last.deletedAt ? 'حُذفت رسالة' : last.text) : presenceLabel(friend);
  return <div className={'social-person-row' + (active ? ' is-selected' : '')}>
    <button type="button" className="social-person-main" onClick={onOpen} aria-label={'فتح محادثة ' + displayName(friend)} aria-current={active ? 'page' : undefined}>
      <PersonAvatar user={friend} presence />
      <span className="social-person-copy"><span className="social-person-title"><strong><bdi>{displayName(friend)}</bdi></strong>{conversation && last && <time dateTime={new Date(timestamp(last.createdAt) || Date.now()).toISOString()}>{dayLabel(last.createdAt) === 'اليوم' ? timeLabel(last.createdAt) : dayLabel(last.createdAt)}</time>}</span><span className={'social-person-sub' + (!conversation && friend.online ? ' is-online' : '')}>{conversation ? preview : presenceLabel(friend)}</span></span>
      <Badge count={friend.unreadCount} />
      {!conversation && <span className="social-row-chat"><Icon name="chat" size={18} /><span>محادثة</span></span>}
    </button>
    <IconAction label={'خيارات ' + displayName(friend)} icon="more" onClick={onMenu} />
  </div>;
}
function RequestRow({ request, outgoing, busy, onAccept, onReject, onCancel, onMenu }) {
  return <article className="social-request-row"><div className="social-request-identity"><PersonAvatar user={request.user} /><div><strong><bdi>{displayName(request.user)}</bdi></strong><small>{outgoing ? 'بانتظار الموافقة' : 'يريد إضافتك إلى أصدقائه'}</small></div><IconAction label={'خيارات ' + displayName(request.user)} icon="more" onClick={onMenu} /></div><div className="social-request-actions">{outgoing ? <Button variant="ghost" disabled={busy} onClick={onCancel}>إلغاء الطلب</Button> : <><Button variant="primary" loading={busy} onClick={onAccept}>قبول الطلب</Button><Button variant="ghost" disabled={busy} onClick={onReject}>رفض</Button></>}</div></article>;
}
export function MessageBubble({ message, mine, read = false, onEdit, onDelete, onReport, onRetry }) {
  const pending = message.status === 'pending';
  const failed = message.status === 'failed';
  const deleted = Boolean(message.deletedAt);
  const [menu, setMenu] = useState(false);
  const sentLabel = failed ? 'لم تُرسل' : pending ? 'جارٍ الإرسال' : read || message.read ? 'قُرئت' : 'أُرسلت';
  return <article className={'social-message ' + (mine ? 'is-mine' : 'is-theirs') + (failed ? ' is-failed' : '')} aria-label={mine ? 'رسالتك' : 'رسالة صديقك'}>
    <div className={'social-bubble' + (deleted ? ' is-deleted' : '')}><p dir="auto">{deleted ? 'حُذفت هذه الرسالة' : message.text}</p><div className="social-message-meta">{message.editedAt && !deleted && <span>معدّلة</span>}<time dateTime={timestamp(message.createdAt) ? new Date(timestamp(message.createdAt)).toISOString() : undefined}>{timeLabel(message.createdAt)}</time>{mine && <span className={'social-delivery' + (read || message.read ? ' is-read' : '')} aria-label={sentLabel} title={sentLabel}><Icon name={pending ? 'clock' : read || message.read ? 'double' : 'check'} size={15} /><span>{sentLabel}</span></span>}</div></div>
    {!deleted && !pending && !failed && <div className="social-message-actions"><IconAction label={mine ? 'خيارات رسالتك' : 'خيارات الرسالة'} icon="more" aria-expanded={menu} onClick={() => setMenu(v => !v)} />{menu && <div className="social-message-menu">{mine ? <><button type="button" onClick={() => { setMenu(false); onEdit(); }}>تعديل</button><button type="button" className="is-danger" onClick={() => { setMenu(false); onDelete(); }}>حذف</button></> : <button type="button" onClick={() => { setMenu(false); onReport(); }}>إبلاغ عن الرسالة</button>}</div>}</div>}
    {mine && failed && <button type="button" className="social-retry" onClick={onRetry}>إعادة الإرسال</button>}
  </article>;
}
function Conversation({ friend, conversation = EMPTY_CONVERSATION, account, social, onMenu, onBack, onAction, notify }) {
  const messages = conversation.messages || EMPTY_LIST;
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [newBelow, setNewBelow] = useState(false);
  const scroller = useRef(null);
  const composer = useRef(null);
  const nearBottom = useRef(true);
  const initialScroll = useRef(false);
  const olderAnchor = useRef(null);
  const lastKey = useRef('');
  const typingTimer = useRef(null);
  const typingActive = useRef(false);
  const typingSentAt = useRef(0);
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
      el.scrollTop = olderAnchor.current.top + el.scrollHeight - olderAnchor.current.height;
      olderAnchor.current = null;
    } else if (!initialScroll.current || (key !== lastKey.current && nearBottom.current)) {
      el.scrollTop = el.scrollHeight;
      initialScroll.current = true;
    } else if (key !== lastKey.current) setNewBelow(true);
    lastKey.current = key;
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
    try { await social.sendMessage(friend.id, value); }
    catch (error) { notify(friendlyError(error), true); }
    finally { setSending(false); }
  };
  const loadOlder = async () => {
    const el = scroller.current;
    if (!el || conversation.loadingOlder) return;
    olderAnchor.current = { top: el.scrollTop, height: el.scrollHeight };
    try { await social.loadOlder(friend.id); }
    catch (error) { olderAnchor.current = null; notify(friendlyError(error), true); }
  };
  return <section className="social-chat" aria-label={'المحادثة مع ' + displayName(friend)}>
    <header className="social-chat-head"><IconAction label="العودة للأصدقاء" icon="back" className="social-mobile-back" onClick={onBack} /><PersonAvatar user={friend} presence /><div className="social-chat-person"><h2><bdi>{displayName(friend)}</bdi></h2><p className={friend.online || conversation.typing ? 'is-online' : ''}>{conversation.typing ? 'يكتب الآن…' : presenceLabel(friend)}</p></div><IconAction label="خيارات المحادثة" icon="more" onClick={onMenu} /></header>
    <div className="social-message-area">
      <div ref={scroller} className="social-message-scroll" role="log" aria-label="الرسائل" aria-live="polite" aria-relevant="additions text" onScroll={() => { const el = scroller.current; nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 72; if (nearBottom.current) { setNewBelow(false); Promise.resolve(social.markRead(friend.id)).catch(() => {}); } }}>
        {conversation.hasMore && <button type="button" className="social-load-older" onClick={loadOlder} disabled={conversation.loadingOlder}>{conversation.loadingOlder ? 'جارٍ التحميل…' : 'تحميل الرسائل الأقدم'}</button>}
        {conversation.loading && messages.length === 0 ? <LoadingRows /> : messages.length === 0 && !conversation.error ? <EmptyState compact title="هنا تبدأ السوالف" icon="chat">أرسل أول رسالة إلى {displayName(friend)}.</EmptyState> : null}
        {conversation.error && <Notice error>{conversation.error}<button type="button" className="social-inline-link" onClick={() => Promise.resolve(social.openConversation(friend.id)).catch(error => notify(friendlyError(error), true))}>حاول مجددًا</button></Notice>}
        {messages.map((message, index) => {
          const date = dayLabel(message.createdAt);
          const showDate = index === 0 || new Date(timestamp(message.createdAt)).toDateString() !== new Date(timestamp(messages[index - 1].createdAt)).toDateString();
          const mine = message.senderId === account.user.id;
          return <React.Fragment key={messageKey(message)}>{showDate && <div className="social-day"><span>{date}</span></div>}<MessageBubble message={message} mine={mine} read={mine && Number(message.seq) > 0 && Number(message.seq) <= Number(conversation.peerReadSeq || 0)} onEdit={() => onAction({ kind: 'edit', user: friend, message })} onDelete={() => onAction({ kind: 'delete', user: friend, message })} onReport={() => onAction({ kind: 'report', user: friend, message })} onRetry={() => Promise.resolve(social.retryMessage(friend.id, message.clientId)).catch(error => notify(friendlyError(error), true))} /></React.Fragment>;
        })}
        {conversation.typing && <div className="social-typing" role="status" aria-label={displayName(friend) + ' يكتب الآن'}><span /><span /><span /><small>يكتب الآن</small></div>}
      </div>
      {newBelow && <button type="button" className="social-jump" onClick={() => goBottom(true)}><Icon name="down" size={16} />رسائل جديدة</button>}
    </div>
    <form className="social-composer" onSubmit={send}>
      {social.offline && <p className="social-composer-note" role="status">أنت غير متصل. ستتمكن من الإرسال عند عودة الاتصال.</p>}
      <div className="social-composer-row"><textarea ref={composer} rows={1} maxLength={MAX_TEXT} value={text} aria-label="اكتب رسالة" placeholder="اكتب رسالة…" enterKeyHint="send" onChange={event => changeText(event.target.value)} onBlur={stopped} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} /><button type="submit" className="social-send" aria-label="إرسال الرسالة" disabled={!text.trim() || sending || social.offline}><Icon name="send" /></button></div>
      {text.length > MAX_TEXT - 200 && <small className="social-character-count" role="status">{text.length.toLocaleString('ar')} / {MAX_TEXT.toLocaleString('ar')}</small>}
    </form>
  </section>;
}
function SearchDialog({ social, onClose, run, busy, onOpen }) {
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
  return <Modal title="أضف صديقًا" onClose={onClose} className="social-dialog"><p className="social-dialog-intro">ابحث باسم صديقك أو أدخل رمز ميدان الخاص به.</p><label className="social-search"><Icon name="search" size={20} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="الاسم أو رمز الصديق" aria-label="ابحث بالاسم أو رمز الصديق" maxLength={100} autoComplete="off" /></label><div className="social-search-results" aria-live="polite">{error && <Notice error>{error}</Notice>}{loading ? <LoadingRows /> : !searched ? !error && <p className="social-search-hint">اكتب حرفين على الأقل لبدء البحث.</p> : results.length === 0 ? <EmptyState compact title="لم نجد هذا الاسم" icon="search">جرّب رمز صديقك أو تأكد من كتابة الاسم.</EmptyState> : results.map(user => {
    const isFriend = user.relationship === 'friend';
    const pending = requested.has(user.id) || user.relationship === 'pending_outgoing';
    return <div key={user.id} className="social-search-result"><PersonAvatar user={user} /><div><strong><bdi>{displayName(user)}</bdi></strong>{user.code && <small><bdi>{user.code}</bdi></small>}</div>{isFriend ? <Button variant="secondary" onClick={() => { onClose(); onOpen(user.id); }}>محادثة</Button> : pending ? <span className="social-status-pill">تم إرسال الطلب</span> : user.relationship === 'pending_incoming' ? <span className="social-status-pill">طلب وارد</span> : <Button variant="primary" loading={busy === 'invite-' + user.id} disabled={social.offline || Boolean(busy)} onClick={async () => { setError(''); const ok = await run(() => social.sendRequest(user.id), 'invite-' + user.id, 'أُرسل طلب الصداقة', setError); if (ok) setRequested(prev => new Set([...prev, user.id])); }}>إضافة</Button>}</div>;
  })}</div></Modal>;
}
function ActionDialog({ action, social, onClose, onComplete }) {
  const { kind, user, message } = action;
  const [text, setText] = useState(message?.text || '');
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const config = {
    remove: ['إزالة الصديق؟', 'ستتوقف المراسلة بينكما حتى تقبلا طلب صداقة جديدًا.', 'إزالة الصديق'],
    block: ['حظر ' + displayName(user) + '؟', 'لن يستطيع إرسال طلبات صداقة أو رسائل إليك، وسيُزال من أصدقائك.', 'حظر'],
    unblock: ['إلغاء الحظر؟', 'سيتمكن هذا الشخص من العثور عليك وإرسال طلب صداقة جديد.', 'إلغاء الحظر'],
    delete: ['حذف الرسالة؟', 'ستُحذف من المحادثة لديك ولدى صديقك. لا يمكنك التراجع عن الحذف.', 'حذف الرسالة'],
    edit: ['تعديل الرسالة', 'سيظهر لصديقك أن الرسالة عُدّلت.', 'حفظ التعديل'],
    report: [message ? 'الإبلاغ عن رسالة' : 'الإبلاغ عن حساب', 'اختر سبب الإبلاغ. لن نعرض بلاغك لهذا الشخص.', 'إرسال البلاغ'],
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
  return <Modal title={config[0]} onClose={busy ? null : onClose} className="social-dialog" footer={<><Button variant="ghost" disabled={busy} onClick={onClose}>إلغاء</Button><Button variant={['remove', 'block', 'delete'].includes(kind) ? 'danger' : 'primary'} loading={busy} disabled={social.offline || (kind === 'edit' && (!text.trim() || text.trim() === message.text)) || (kind === 'report' && !reason)} onClick={confirm}>{config[2]}</Button></>}><p className="social-dialog-intro">{config[1]}</p>{kind === 'edit' && <label className="social-field">نص الرسالة<textarea autoFocus value={text} maxLength={MAX_TEXT} rows={4} onChange={event => setText(event.target.value)} /></label>}{kind === 'report' && <><label className="social-field">سبب الإبلاغ<select value={reason} onChange={event => setReason(event.target.value)}><option value="">اختر السبب</option>{['رسائل مزعجة', 'إساءة أو تنمر', 'محتوى غير مناسب', 'انتحال شخصية', 'سبب آخر'].map(value => <option key={value}>{value}</option>)}</select></label><label className="social-field">تفاصيل إضافية <small>(اختياري)</small><textarea value={details} maxLength={800} rows={3} placeholder="أخبرنا بما حدث…" onChange={event => setDetails(event.target.value)} /></label></>}{error && <Notice error>{error}</Notice>}</Modal>;
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
  useEffect(() => {
    if (!window.visualViewport) return;
    const update = () => { screen.current?.style.setProperty('--social-height', window.visualViewport.height + 'px'); };
    update(); window.visualViewport.addEventListener('resize', update);
    return () => window.visualViewport.removeEventListener('resize', update);
  }, []);
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
      if (!code || !navigator.clipboard?.writeText) throw new Error('يمكنك تحديد رمزك ونسخه يدويًا.');
      await navigator.clipboard.writeText(code); setCopied(true); notify('نُسخ رمزك. أرسله لصديقك ليضيفك.');
    } catch (error) { notify(friendlyError(error), true); }
  };
  const visibleFriends = friends.filter(user => displayName(user).toLocaleLowerCase('ar').includes(filter.trim().toLocaleLowerCase('ar'))).filter(user => tab !== 'chats' || user.lastMessage || user.unreadCount).sort((a, b) => tab === 'chats' ? timestamp(b.lastMessage?.createdAt) - timestamp(a.lastMessage?.createdAt) : Number(Boolean(b.online)) - Number(Boolean(a.online)));
  const unread = friends.reduce((sum, user) => sum + (user.unreadCount || 0), 0);
  const chooseAction = kind => { setAction({ kind, user: menu }); setMenu(null); };
  return <main ref={screen} className={'social-screen' + (account.signedIn && friendId ? ' is-conversation' : '')} dir="rtl" aria-label="أصدقاء ميدان">
    <style>{socialCss}</style>
    <header className="social-page-head"><div className="social-page-title"><IconAction label="الرئيسية" icon="back" onClick={() => onNavigate('/')} /><div><span className="social-eyebrow">ميدان يجمعكم</span><h1>الأصدقاء <span>والمحادثات</span></h1></div></div>{account.signedIn && <button type="button" className="social-add-button" onClick={() => setSearchOpen(true)}><Icon name="plus" size={20} /><span>إضافة صديق</span></button>}</header>
    {notice && <Notice error={notice.error} onDismiss={() => setNotice(null)}>{notice.text}</Notice>}
    {!account.ready ? <LoadingRows /> : !account.signedIn ? <div className="social-signin"><EmptyState icon="people" title="جمعتكم تبدأ هنا" action={<Button variant="primary" size="lg" onClick={() => setSignInOpen(true)}>تسجيل الدخول</Button>}>أضف أصحابك، راسلهم، ورتّبوا جمعتكم القادمة في ميدان.</EmptyState><div className="social-signin-perks"><span><Icon name="people" />أصحابك في مكان واحد</span><span><Icon name="chat" />سوالف بينكم</span></div></div> : <>
      {social.offline && <Notice>انقطع الاتصال. ما زالت محادثاتك المحمّلة أمامك.</Notice>}
      {social.error && <Notice error>{social.error}<button type="button" className="social-inline-link" onClick={() => run(social.refresh, 'refresh')}>إعادة المحاولة</button></Notice>}
      <div className="social-workspace"><aside className="social-sidebar" aria-label="قائمة الأصدقاء">
        <div className="social-code-card"><div><span>رمزك في ميدان</span><strong><bdi>{code || '••••••'}</bdi></strong></div><button type="button" onClick={copyCode} disabled={!code} className="social-copy" aria-label="نسخ رمز الصديق"><Icon name={copied ? 'check' : 'copy'} size={19} /><span>{copied ? 'نُسخ' : 'نسخ'}</span></button></div>
        <div className="social-tabs" role="tablist" aria-label="الأصدقاء والمحادثات">{[['friends', 'الأصدقاء', friends.length], ['chats', 'المحادثات', unread], ['requests', 'الطلبات', incoming.length]].map(([id, label, count]) => <button type="button" role="tab" id={'social-tab-' + id} aria-controls="social-list-panel" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onKeyDown={event => { const tabs = ['friends', 'chats', 'requests']; const offset = event.key === 'ArrowLeft' ? 1 : event.key === 'ArrowRight' ? -1 : 0; if (offset || ['Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (tabs.indexOf(id) + offset + 3) % 3; setTab(tabs[next]); event.currentTarget.parentNode.querySelectorAll('[role="tab"]')[next].focus(); } }} className={tab === id ? 'is-active' : ''} key={id} onClick={() => setTab(id)}>{label}{count > 0 && <Badge count={count} label={label + ': ' + count} />}</button>)}</div>
        {tab !== 'requests' && friends.length > 0 && <label className="social-search social-list-search"><Icon name="search" size={18} /><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="ابحث بين أصدقائك" aria-label="ابحث بين أصدقائك" /></label>}
        <div id="social-list-panel" className="social-list-panel" role="tabpanel" aria-labelledby={'social-tab-' + tab}>
          {social.loading && friends.length === 0 && incoming.length === 0 ? <LoadingRows /> : tab === 'requests' ? <>
            {incoming.length > 0 && <h2 className="social-list-heading">طلبات واردة <span>{incoming.length.toLocaleString('ar')}</span></h2>}
            {incoming.map(request => <RequestRow key={request.id} request={request} busy={busy === request.id} onAccept={() => run(() => social.acceptRequest(request.id), request.id, 'أُضيف إلى أصدقائك')} onReject={() => run(() => social.rejectRequest(request.id), request.id, 'رُفض الطلب')} onMenu={() => setMenu(request.user)} />)}
            {outgoing.length > 0 && <h2 className="social-list-heading">طلبات أرسلتها <span>{outgoing.length.toLocaleString('ar')}</span></h2>}
            {outgoing.map(request => <RequestRow key={request.id} request={request} outgoing busy={busy === request.id} onCancel={() => run(() => social.cancelRequest(request.id), request.id, 'أُلغي الطلب')} onMenu={() => setMenu(request.user)} />)}
            {!incoming.length && !outgoing.length && <EmptyState compact icon="inbox" title="ما عندك طلبات الآن">طلبات الصداقة الجديدة ستظهر هنا.</EmptyState>}
          </> : visibleFriends.length ? visibleFriends.map(user => <FriendRow key={user.id} friend={user} active={user.id === friendId} conversation={tab === 'chats'} onOpen={() => openFriend(user.id)} onMenu={() => setMenu(user)} />) : <EmptyState compact icon={filter ? 'search' : tab === 'chats' ? 'chat' : 'people'} title={filter ? 'لا يوجد اسم مطابق' : tab === 'chats' ? 'لسّه السوالف ما بدأت' : 'أصحابك يكملون الجمعة'} action={!filter && tab === 'friends' ? <Button variant="primary" onClick={() => setSearchOpen(true)}>أضف أول صديق</Button> : null}>{filter ? 'جرّب كتابة جزء آخر من الاسم.' : tab === 'chats' ? 'افتح محادثة من قائمة الأصدقاء وقل مرحبًا.' : 'شارك رمزك أو ابحث عن صديق لتبدؤوا المحادثة.'}</EmptyState>}
        </div>
        <footer className="social-sidebar-footer"><button type="button" onClick={() => setBlockedOpen(true)}><Icon name="shield" size={17} />المحظورون{blocked.length > 0 && <span>{blocked.length.toLocaleString('ar')}</span>}</button><span>{friends.filter(user => user.online).length > 0 ? friends.filter(user => user.online).length.toLocaleString('ar') + ' متصل الآن' : 'لجمعة أقرب'}</span></footer>
      </aside>
      <div className="social-chat-panel">{friend ? <Conversation key={friend.id} friend={friend} conversation={social.conversations?.[friend.id]} account={account} social={social} onMenu={() => setMenu(friend)} onBack={() => onNavigate('/friends')} onAction={setAction} notify={notify} /> : friendId ? <div className="social-unavailable"><EmptyState icon="people" title={social.loading ? 'جارٍ فتح المحادثة…' : 'هذه المحادثة غير متاحة'} action={<Button variant="secondary" onClick={() => onNavigate('/friends')}>العودة إلى الأصدقاء</Button>}>{!social.loading && 'اختر صديقًا من قائمتك، أو أرسل طلب صداقة جديدًا.'}</EmptyState></div> : <div className="social-welcome"><span className="social-welcome-chip"><i />مساحة لسوالفكم</span><div className="social-welcome-art"><span><Icon name="chat" size={58} /></span><i><Icon name="people" size={34} /></i></div><h2>كل جمعة تبدأ برسالة</h2><p>اختَر صديقًا من القائمة،<br />وخَلّ التخطيط للجمعة يبدأ.</p><div className="social-welcome-line" /></div>}</div></div>
    </>}
    <SignInSheet open={signInOpen} onClose={() => setSignInOpen(false)} note="سجّل الدخول لإضافة أصحابك ومتابعة محادثاتك من أجهزتك." />
    {searchOpen && <SearchDialog social={social} onClose={() => setSearchOpen(false)} run={run} busy={busy} onOpen={openFriend} />}
    {menu && <Modal title={displayName(menu)} onClose={() => setMenu(null)} className="social-dialog social-person-menu"><div className="social-menu-identity"><PersonAvatar user={menu} large /><p>{presenceLabel(menu)}</p></div><div className="social-menu-options">{friends.some(user => user.id === menu.id) && <><button type="button" onClick={() => { openFriend(menu.id); setMenu(null); }}><Icon name="chat" />فتح المحادثة</button><button type="button" onClick={() => chooseAction('remove')}>إزالة من الأصدقاء</button></>}<button type="button" className="is-danger" onClick={() => chooseAction('block')}><Icon name="shield" />حظر</button><button type="button" onClick={() => chooseAction('report')}>إبلاغ عن الحساب</button></div></Modal>}
    {blockedOpen && <Modal title="المحظورون" onClose={() => setBlockedOpen(false)} className="social-dialog"><p className="social-dialog-intro">هؤلاء الأشخاص لا يمكنهم مراسلتك أو إرسال طلب صداقة إليك.</p>{blocked.length ? <div className="social-blocked-list">{blocked.map(user => <div key={user.id} className="social-search-result"><PersonAvatar user={user} /><strong><bdi>{displayName(user)}</bdi></strong><Button variant="ghost" onClick={() => { setBlockedOpen(false); setAction({ kind: 'unblock', user }); }}>إلغاء الحظر</Button></div>)}</div> : <EmptyState compact icon="shield" title="قائمتك فارغة">لم تحظر أي شخص.</EmptyState>}</Modal>}
    {action && <ActionDialog key={action.kind + '-' + action.user.id + '-' + (action.message?.seq || '')} action={action} social={social} onClose={() => setAction(null)} onComplete={kind => { notify(kind === 'report' ? 'وصل بلاغك. شكرًا لمساعدتنا.' : kind === 'edit' ? 'حُفظ التعديل' : kind === 'delete' ? 'حُذفت الرسالة' : kind === 'block' ? 'حُظر الحساب' : kind === 'unblock' ? 'أُلغي الحظر' : 'أُزيل من أصدقائك'); if (['remove', 'block'].includes(kind) && action.user.id === friendId) onNavigate('/friends'); }} />}
  </main>;
}
export function SocialScreen({ friendId }) {
  const account = useAccount();
  const social = useSocial();
  return <SocialView key={account.user?.id || 'guest'} account={account} social={social} friendId={friendId} />;
}
