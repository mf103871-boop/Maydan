import React, { useId, useRef, useState } from 'react';
import { availableItems, getCosmetic } from '../plus/catalog.js';

export function StickerMessage({ message }) {
  const [failed, setFailed] = useState(false);
  const item = getCosmetic(message.stickerId, { kind: 'sticker', now: Number.MAX_SAFE_INTEGER });
  if (!item || item.version !== message.stickerVersion || failed) return <p dir="auto">{message.text}</p>;
  return <figure className="social-sticker-message"><img src={item.assetUrl} width="144" height="144" alt={item.label} loading="lazy" decoding="async" onError={() => setFailed(true)} /><figcaption>{item.label}</figcaption></figure>;
}

export function StickerPicker({ account, disabled = false, onSend, onError }) {
  const [open, setOpen] = useState(false), [sending, setSending] = useState(null);
  const owner = account.user?.id, ownerRef = useRef(owner); ownerRef.current = owner;
  const mounted = useRef(true), button = useRef(null), panelId = useId();
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const items = availableItems().filter(item => item.kind === 'sticker');
  const close = () => { setOpen(false); button.current?.focus({ preventScroll: true }); };
  const choose = async item => {
    if (!account.premium) { close(); account.openPaywall({ reason: 'cosmetics' }); return; }
    const expectedOwner = ownerRef.current; setSending(item.id);
    try {
      await onSend(item.id);
      if (mounted.current && ownerRef.current === expectedOwner) close();
    } catch (error) {
      if (error?.code === 'STALE') return;
      if (mounted.current && ownerRef.current === expectedOwner) {
        onError(error?.message || 'تعذّر إرسال الملصق. أعد المحاولة.');
        if (error?.code === 'PLUS_REQUIRED') account.openPaywall({ reason: 'cosmetics' });
      }
    } finally { if (mounted.current && ownerRef.current === expectedOwner) setSending(null); }
  };
  return <div className="social-sticker-picker">
    <button ref={button} type="button" className="social-sticker-toggle" aria-expanded={open} aria-controls={panelId} disabled={disabled} onClick={() => setOpen(value => !value)}><span aria-hidden="true">✦</span> ملصقات ميدان <small>بلس</small></button>
    {open && <section id={panelId} className="social-sticker-panel" aria-label="ملصقات ميدان بلس" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
      <div className="social-sticker-heading"><span>{account.premium ? 'عبّر بطريقتك' : 'معاينة ملصقات بلس · الرسائل العادية مجانية'}</span><button type="button" aria-label="إغلاق الملصقات" onClick={close}>×</button></div>
      <div className="social-sticker-grid">{items.map(item => <button key={item.id} type="button" disabled={disabled || !!sending} aria-label={(account.premium ? 'إرسال ملصق ' : 'عرض بلس لاستخدام ملصق ') + item.label} onClick={() => choose(item)}><img src={item.assetUrl} width="64" height="64" alt="" loading="lazy" decoding="async" /><span>{sending === item.id ? 'جارٍ الإرسال…' : item.label}</span></button>)}</div>
    </section>}
  </div>;
}
