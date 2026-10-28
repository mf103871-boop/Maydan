import React, { useEffect, useState } from 'react';
import { Button } from '../shared/ui/components.jsx';
import { navigate } from '../platform/router.js';
import { usePlusResource, plusError } from './usePlusAccount.js';
import { useAccount } from '../shared/account/context.js';
import { resolveAccountServer } from '../shared/account/api.js';
import { presetSettings } from './preset-settings.js';
import css from './plus.css';

export function SetupPresets(props) {
  const account = useAccount();
  return <PresetPanel key={`${resolveAccountServer()}:${account.user?.id || 'guest'}:${props.game}`} {...props} />;
}
function PresetPanel({ game, settings, onApply, disabled = false }) {
  const [open, setOpen] = useState(false);
  const resource = usePlusResource('/api/me/setup-presets', open);
  const { account, owner, data, loading, request, reload } = resource;
  const [name, setName] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { setName(''); setBusy(''); setNotice(''); setOpen(false); }, [owner, game]);
  const canUse = data?.plusActive ?? account.premium;
  const items = (data?.presets || []).filter(item => item.game === game);
  const perform = async (id, operation) => {
    if (busy || disabled) return;
    setBusy(id); setNotice('');
    try { await operation(); }
    catch (error) {
      if (error.code === 'STALE_ACCOUNT') return;
      setNotice(plusError(error));
      if (error.code === 'PLUS_REQUIRED') account.openPaywall({ reason: 'presets' });
      if (error.code === 'CONFLICT') await reload();
    } finally { setBusy(''); }
  };
  const save = () => {
    if (!canUse) { account.openPaywall({ reason: 'presets' }); return; }
    perform('save', async () => {
      await request('/api/me/setup-presets', { method: 'POST', body: { name: name.trim(), game, settings: presetSettings(game, settings) } });
      setName(''); if (await reload()) setNotice('حُفظت الجلسة. ستجدها على أجهزتك بهذا الحساب.');
    });
  };
  return <section className="plus-presets" aria-label="جلساتي الجاهزة">
    <style>{css}</style>
    <button className="plus-presets-toggle" type="button" aria-expanded={open} disabled={disabled} onClick={() => setOpen(value => !value)}><span>✦ جلساتي الجاهزة <small>بلس</small></span><span aria-hidden="true">{open ? '−' : '+'}</span></button>
    {open && <div className="plus-presets-body stack">
      <p>احفظ خيارات اللعب فقط. الأسئلة والكلمات تتجدد عند بدء المباراة.</p>
      {!owner ? <Button onClick={() => navigate('/settings')}>سجّل الدخول لحفظ جلساتك</Button> : <>
        {loading && <p role="status">جارٍ تحميل جلساتك…</p>}
        {resource.error && <div role="alert"><p>{plusError(resource.error)}</p><Button onClick={reload}>إعادة التحميل</Button></div>}
        {!loading && !resource.error && !items.length && <p>ما عندك جلسة محفوظة لهذه اللعبة بعد.</p>}
        {items.map(item => <div className="plus-preset-row" key={item.id}><span>{item.name}</span><Button size="sm" disabled={!!busy || disabled} onClick={() => {
          if (!canUse) { account.openPaywall({ reason: 'presets' }); return; }
          perform(item.id, async () => { const result = await request(`/api/me/setup-presets/${encodeURIComponent(item.id)}/apply`, { method: 'POST', body: {} }); onApply(result.settings || result.preset.settings); setNotice('طُبّقت الخيارات؛ راجعها ثم ابدأ اللعب.'); });
        }}>استخدام</Button><Button size="sm" variant="ghost" disabled={!!busy || disabled} aria-label={`حذف جلسة ${item.name}`} onClick={() => perform(item.id, async () => { await request(`/api/me/setup-presets/${encodeURIComponent(item.id)}`, { method: 'DELETE', body: { revision: item.revision } }); await reload(); })}>حذف</Button></div>)}
        {!canUse && <p>القوالب محفوظة لك. بلس يتيح حفظها واستخدامها السريع، والخيارات اليدوية مجانية.</p>}
        <label className="field">اسم الجلسة<input maxLength={40} value={name} placeholder="مثال: سهرة العيلة" disabled={!!busy || disabled} onChange={event => setName(event.target.value)} /></label>
        <Button disabled={!name.trim() || !!busy || disabled || Boolean(loading) || Boolean(resource.error) || (data?.presets?.length || 0) >= 10} loading={busy === 'save'} onClick={save}>{canUse ? 'احفظ الإعدادات الحالية' : 'احفظها مع ميدان بلس'}</Button>
        {(data?.presets?.length || 0) >= 10 && <p>لديك عشر جلسات محفوظة. احذف واحدة لإضافة جلسة أخرى.</p>}
      </>}
      {notice && <p role="status">{notice}</p>}
    </div>}
  </section>;
}
