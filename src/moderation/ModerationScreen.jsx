import React, { useEffect, useRef, useState } from 'react';
import { Screen, TopBar, IconButton, Button, Card, Modal, Segment } from '../shared/ui/components.jsx';
import { IconBack, IconFlag } from '../shared/ui/icons.jsx';
import { back, getDirection, navigate } from '../platform/router.js';
import { moderationError } from './client.js';
import { useModeration } from './useModeration.js';
import { ReviewImage } from './ReviewImage.jsx';
import css from './moderation.css';
import { profileAssetUrl } from '../profiles/identity.js';
import { resolveAccountServer } from '../shared/account/api.js';

export const ACTION_LABELS = { resolve_report: 'إغلاق البلاغ', remove_message: 'إزالة الرسالة', clear_profile_text: 'إزالة نص الملف',
  remove_image: 'إزالة الصورة المنشورة', suspend_user: 'تعليق الحساب', restore_user: 'إعادة تفعيل الحساب', approve_image: 'اعتماد الصورة', reject_image: 'رفض الصورة' };
const kindName = kind => kind === 'cover' ? 'الغلاف' : 'الصورة الشخصية';
const date = value => value ? new Date(value).toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

function DecisionDialog({ decision, client, onClose, onDone }) {
  const [reason, setReason] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const submitted = useRef(null);
  const submit = async () => {
    if (busy) return;
    if ([...reason.trim()].length < 3 || [...reason.trim()].length > 500) { setError('اكتب سبب القرار من 3 إلى 500 حرف.'); return; }
    if (!submitted.current) submitted.current = { ...decision.body, clientId: crypto.randomUUID(), reason: reason.trim() };
    setBusy(true); setError('');
    try { await client.act(submitted.current); onDone(); }
    catch (err) { setError(moderationError(err)); }
    finally { setBusy(false); }
  };
  const title = ACTION_LABELS[decision.body.action];
  return <Modal title={title + '؟'} className="moderation-dialog" onClose={busy ? null : onClose} footer={<div className="moderation-actions"><Button variant="ghost" disabled={busy} onClick={onClose}>إلغاء</Button><Button variant={['approve_image', 'restore_user', 'resolve_report'].includes(decision.body.action) ? 'primary' : 'danger'} loading={busy} onClick={submit}>{submitted.current ? 'إعادة محاولة القرار' : title}</Button></div>}>
    <p className="card-muted">{decision.summary}</p>
    <label className="moderation-field">سبب القرار<textarea rows={3} autoFocus maxLength={500} value={reason} disabled={busy || !!submitted.current} onChange={event => setReason(event.target.value)} placeholder="سبب واضح للمراجعة، دون بيانات اتصال أو أسرار" /></label>
    <p className="moderation-note">يُحفظ القرار وسببه في سجل المراجعة. يظهر سبب رفض الصورة أو تعليق الحساب لصاحبه.</p>
    {submitted.current && error && <p className="moderation-note">إعادة المحاولة ترسل القرار نفسه. لا تُنشئ قرارًا جديدًا قبل تحديث القائمة.</p>}
    {error && <p role="alert" className="online-notice error">{error}</p>}
  </Modal>;
}

export function ReportCard({ report, disabled = false, onDecision }) {
  const user = report.reportedUser || {}; const name = user.name || 'حساب غير متاح';
  const choose = (action, extra = {}, summary) => onDecision({ body: { action, targetId: user.id, reportId: report.id, ...extra }, summary: summary || `${ACTION_LABELS[action]} للحساب «${name}».` });
  return <Card className="stack moderation-report">
    <header className="moderation-card-head"><div><h2><bdi>{name}</bdi></h2><span className="muted"><bdi>{user.code || ''}</bdi> · {date(report.createdAt)}</span></div><span className={'moderation-status' + (report.resolvedAt ? ' is-closed' : '')}>{report.resolvedAt ? 'مغلق' : 'بانتظار المراجعة'}</span></header>
    <div className="moderation-evidence"><h3>سبب البلاغ</h3><p dir="auto">{report.reason}</p>{report.messageSeq && <><h3>نسخة الرسالة وقت البلاغ</h3><blockquote dir="auto">{report.messageText || 'لا يتوفر نص.'}</blockquote></>}
      {user.bio && <><h3>النبذة الحالية</h3><p dir="auto">{user.bio}</p></>}
    </div>
    {(user.avatarUrl || user.coverUrl) && <div className="moderation-public-images">{[['avatar', user.avatarUrl], ['cover', user.coverUrl]].map(([kind, value]) => { const url = profileAssetUrl(value, resolveAccountServer()); return url && <figure key={kind}><img src={url} alt={kindName(kind) + ' المنشورة'} loading="lazy" /><figcaption>{kindName(kind)} المنشورة</figcaption></figure>; })}</div>}
    {user.suspended && <p className="online-notice">الحساب معلّق حاليًا.</p>}
    {report.resolvedAt && <p className="moderation-note">أُغلق في {date(report.resolvedAt)}{report.resolution ? ` · ${report.resolution}` : ''}</p>}
    <div className="moderation-actions">
      {!report.resolvedAt && <Button variant="primary" disabled={disabled} onClick={() => choose('resolve_report', { targetId: report.id }, 'إغلاق البلاغ بعد مراجعته. لا يحذف هذا الإجراء محتوى الحساب.')}>إغلاق البلاغ</Button>}
      {report.messageSeq && <Button variant="secondary" disabled={disabled} onClick={() => choose('remove_message', { targetId: String(report.messageSeq) }, 'إزالة نص الرسالة من المحادثة للطرفين. تبقى نسخة البلاغ ضمن سجل المراجعة.')}>إزالة الرسالة</Button>}
      {user.id && <>
        <Button variant="secondary" disabled={disabled} onClick={() => choose('clear_profile_text', { field: 'all', revision: user.revision }, `إعادة اسم «${name}» إلى الاسم الافتراضي ومسح نبذته. راجع النص الحالي قبل التأكيد.`)}>إزالة الاسم والنبذة</Button>
        {['avatar', 'cover'].map(kind => user[kind + 'Version'] && <Button key={kind} variant="secondary" disabled={disabled} onClick={() => choose('remove_image', { kind, version: user[kind + 'Version'] }, `إزالة ${kindName(kind)} المنشورة للحساب «${name}».`)}>إزالة {kindName(kind)}</Button>)}
        <Button variant={user.suspended ? 'secondary' : 'danger'} disabled={disabled} onClick={() => choose(user.suspended ? 'restore_user' : 'suspend_user', {}, user.suspended ? `إعادة الوصول للميزات الاجتماعية والملف والغرف للحساب «${name}».` : `تعليق وصول «${name}» للميزات الاجتماعية والملف والغرف. تبقى إدارة الحساب والاشتراك وحذف الحساب متاحة.`)}>{user.suspended ? 'إعادة تفعيل الحساب' : 'تعليق الحساب'}</Button>
      </>}
    </div>
  </Card>;
}

export function PendingImageCard({ image, disabled, onDecision }) {
  const choose = action => onDecision({ body: { action, targetId: image.id, version: image.version }, summary: action === 'approve_image'
    ? `نشر ${kindName(image.kind)} الجديدة للحساب «${image.user?.name || 'لاعب ميدان'}» بدل صورته الحالية.`
    : `رفض ${kindName(image.kind)} الجديدة. تبقى الصورة المعتمدة السابقة إن وُجدت، ويظهر سبب الرفض لصاحب الحساب.` });
  return <Card className="stack moderation-image-card"><header className="moderation-card-head"><div><h2>{kindName(image.kind)}</h2><p><bdi>{image.user?.name || 'لاعب ميدان'}</bdi> · <bdi>{image.user?.code || ''}</bdi></p></div><span className="moderation-status">لم تُنشر بعد</span></header><ReviewImage path={image.previewUrl} label={kindName(image.kind) + ' بانتظار المراجعة'} /><p className="moderation-note">أُرسلت في {date(image.createdAt)}</p><div className="moderation-actions"><Button variant="primary" disabled={disabled} onClick={() => choose('approve_image')}>اعتماد الصورة</Button><Button variant="danger" disabled={disabled} onClick={() => choose('reject_image')}>رفض الصورة</Button></div></Card>;
}

export function ModerationView({ state, client, account }) {
  const [decision, setDecision] = useState(null); const [notice, setNotice] = useState('');
  const allowed = account.signedIn && state.userId === account.user?.id && state.moderator;
  const rows = state[state.section === 'audit' ? 'actions' : state.section] || [];
  const busy = state.loading || state.saving;
  return <Screen dir={getDirection()} className="stack moderation-screen" aria-label="مراجعة محتوى ميدان"><style>{css}</style><TopBar title="مراجعة المحتوى" eyebrow="إدارة ميدان" start={<IconButton label="رجوع" onClick={back}><IconBack /></IconButton>} />
    {!account.signedIn ? <Card className="stack"><h2>حساب المراجعة</h2><p className="card-muted">سجّل الدخول من الإعدادات بالحساب المصرّح له بالمراجعة.</p><Button onClick={() => navigate('/settings')}>فتح الإعدادات</Button></Card> : !state.ready ? <p role="status">جارٍ التحقق من صلاحية المراجعة…</p> : !allowed ? <Card className="stack"><h2>هذه الصفحة غير متاحة لحسابك</h2><p className="card-muted">يحدد مالك ميدان الحسابات المخوّلة بالمراجعة.</p>{state.error && <p role="alert">{state.error}</p>}<Button variant="secondary" onClick={() => client.start(account.user.id)}>إعادة التحقق</Button></Card> : <>
      <Card className="moderation-intro"><IconFlag /><div><h2>قرار واضح، ومحتوى مناسب</h2><p>راجع السياق قبل اتخاذ القرار. البلاغات والمعاينات خاصة بفريق المراجعة؛ لا تشاركها خارج غرض المعالجة.</p></div></Card>
      <Segment label="قائمة المراجعة" value={state.section} onChange={value => { if (!busy) { setNotice(''); client.load(value, state.status); } }} options={[{ value: 'reports', label: 'البلاغات' }, { value: 'images', label: 'الصور الجديدة' }, { value: 'audit', label: 'سجل القرارات' }]} />
      <div className="moderation-toolbar">{state.section === 'reports' && <label>حالة البلاغ<select value={state.status} disabled={busy} onChange={event => client.load('reports', event.target.value)}><option value="open">بانتظار المراجعة</option><option value="resolved">المغلقة</option></select></label>}<Button variant="secondary" size="sm" disabled={busy} onClick={() => client.load()}>تحديث القائمة</Button></div>
      {notice && <p role="status" className="online-notice">{notice}</p>}{state.error && <p role="alert" className="online-notice error">{state.error}</p>}
      <div className="stack" aria-busy={state.loading}>{state.section === 'reports' ? rows.map(report => <ReportCard key={report.id} report={report} disabled={busy} onDecision={setDecision} />) : state.section === 'images' ? rows.map(image => <PendingImageCard key={image.id} image={image} disabled={busy} onDecision={setDecision} />) : rows.map(item => <Card key={item.id} className="moderation-audit"><h2>{ACTION_LABELS[item.action] || 'قرار مراجعة'}</h2><p dir="auto">{item.reason}</p><small>{date(item.createdAt)}</small><details><summary>مرجع القرار</summary><p><bdi>{item.id}</bdi></p><p>الحساب: <bdi>{item.subjectUserId || '—'}</bdi></p></details></Card>)}</div>
      {state.loading ? <p role="status">جارٍ تحميل القائمة…</p> : !rows.length && !state.error ? <Card className="moderation-empty"><h2>{state.section === 'images' ? 'لا صور تنتظر المراجعة' : state.section === 'reports' ? 'لا بلاغات في هذه القائمة' : 'لا قرارات مسجّلة بعد'}</h2><p className="card-muted">يمكنك تحديث القائمة للتحقق من الطلبات الجديدة.</p></Card> : null}
      {state.nextBefore && <Button variant="secondary" disabled={busy} onClick={() => client.load(state.section, state.status, true)}>عرض المزيد</Button>}
      {decision && <DecisionDialog decision={decision} client={client} onClose={() => setDecision(null)} onDone={() => { setDecision(null); setNotice('حُفظ قرار المراجعة.'); client.load(); }} />}
    </>}
  </Screen>;
}

export function ModerationScreen() {
  const { state, client, account } = useModeration();
  useEffect(() => { if (state.moderator) client.load(); }, [state.moderator, client]);
  return <ModerationView key={account.user?.id || 'guest'} state={state} client={client} account={account} />;
}

export function ModerationSettingsLink() {
  const { state } = useModeration();
  return state.ready && state.moderator ? <Card className="stack"><span className="card-title">مراجعة المحتوى</span><p className="card-muted">بلاغات اللاعبين والصور الجديدة بانتظار مراجعتك.</p><Button variant="secondary" icon={<IconFlag />} onClick={() => navigate('/moderation')}>فتح لوحة المراجعة</Button></Card> : null;
}
