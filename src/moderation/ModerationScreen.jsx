import { getUiLocale, tr } from '../shared/i18n/core.js';
import { useAccount } from '../shared/account/context.js';
import React, { useEffect, useRef, useState } from 'react';
import { Screen, TopBar, IconButton, Button, Card, Modal, Segment } from '../shared/ui/components.jsx';
import { IconBack, IconFlag, IconRotate } from '../shared/ui/icons.jsx';
import { back, getDirection, navigate } from '../platform/router.js';
import { moderationError } from './client.js';
import { useModeration } from './useModeration.js';
import { ReviewImage } from './ReviewImage.jsx';
import { ReviewAudio } from './ReviewAudio.jsx';
import { ReviewDrawing } from './ReviewDrawing.jsx';
import { ReviewMafia } from './ReviewMafia.jsx';
import { mafiaReportCategoryLabel,MAFIA_REPORT_STATUS_LABELS } from '../online/mafia-report-shared.js';
import css from './moderation.css?sheet';
import { PresentationStyles } from '../shared/ui/PresentationStyles.jsx';
import { profileAssetUrl } from '../profiles/identity.js';
import { resolveAccountServer } from '../shared/account/api.js';

export const ACTION_LABELS = { resolve_report: 'إغلاق البلاغ', review_mafia_report: 'بدء مراجعة بلاغ مافيا', remove_message: 'إزالة الرسالة', clear_profile_text: 'إزالة نص الملف',
  remove_image: 'إزالة الصورة المنشورة', suspend_user: 'تعليق الحساب', restore_user: 'إعادة تفعيل الحساب', approve_image: 'اعتماد الصورة', reject_image: 'رفض الصورة' };
const kindName = kind => kind === 'cover' ? tr("الغلاف") : tr("الصورة الشخصية");
const date = value => value ? new Date(value).toLocaleString(getUiLocale() === 'en' ? 'en-GB' : 'ar-JO', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

function DecisionDialog({ decision, client, onClose, onDone }) {
  const [reason, setReason] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const submitted = useRef(null);
  const submit = async () => {
    if (busy) return;
    if ([...reason.trim()].length < 3 || [...reason.trim()].length > 500) { setError(tr("اكتب سبب القرار من 3 إلى 500 حرف.")); return; }
    if (!submitted.current) submitted.current = { ...decision.body, clientId: crypto.randomUUID(), reason: reason.trim() };
    setBusy(true); setError('');
    try { await client.act(submitted.current); onDone(); }
    catch (err) {
      if (err?.code === 'CONTENT_REJECTED' || err?.code === 'INVALID') submitted.current = null;
      setError(tr(moderationError(err)));
    }
    finally { setBusy(false); }
  };
  const action = decision.body.action;
  const photo = action === 'approve_image' || action === 'reject_image';
  const title = tr(ACTION_LABELS[action]);
  const cancel = <Button data-design-id="cancel-decision" variant="ghost" disabled={busy} onClick={onClose}>{tr("إلغاء")}</Button>;
  const confirm = <Button data-design-id="save-decision" variant={['approve_image', 'restore_user', 'resolve_report'].includes(action) ? 'primary' : 'danger'} loading={busy} onClick={submit}>{submitted.current ? tr("إعادة محاولة القرار") : title}</Button>;
  const actions = <div className="moderation-actions">{photo ? <>{confirm}{cancel}</> : <>{cancel}{confirm}</>}</div>;
  return <Modal title={title + (getUiLocale() === 'en' ? '?' : '؟')} className={'moderation-dialog' + (photo ? ' moderation-photo-dialog' : '')} onClose={busy ? null : onClose} footer={actions}>
    <p className="card-muted">{decision.summary}</p>
    <label className="moderation-field">{tr("سبب القرار")}<textarea data-design-id="decision-reason" dir="auto" rows={3} autoFocus={!photo} maxLength={500} value={reason} disabled={busy || !!submitted.current} onChange={event => {
      setReason(event.target.value);
      setError('');
    }} placeholder={tr("سبب واضح للمراجعة، دون بيانات اتصال أو أسرار")} /></label>
    <p className="moderation-note">{tr("يُحفظ القرار وسببه في سجل المراجعة. يظهر سبب رفض الصورة أو تعليق الحساب لصاحبه.")}</p>
    {submitted.current && error && <p className="moderation-note">{tr("إعادة المحاولة ترسل القرار نفسه. لا تُنشئ قرارًا جديدًا قبل تحديث القائمة.")}</p>}
    {error && <p role="alert" className="online-notice error">{error}</p>}
  </Modal>;
}

export function ReportCard({ report, disabled = false, onDecision }) {
  const user = report.reportedUser || {}; const name = user.name || tr("حساب غير متاح");
  const choose = (action, extra = {}, summary) => onDecision({ body: { action, targetId: user.id, reportId: report.id, ...extra }, summary: summary || tr("{v0} للحساب «{v1}».", {v0: ACTION_LABELS[action], v1: name}) });
  return <Card className="stack moderation-report">
    <header className="moderation-card-head"><div><h2><bdi>{name}</bdi></h2><span className="muted"><bdi>{user.code || ''}</bdi> · {date(report.createdAt)}</span></div><span className={'moderation-status' + (report.resolvedAt ? ' is-closed' : '')}>{report.resolvedAt ? tr("مغلق") : tr("بانتظار المراجعة")}</span></header>
    <div className="moderation-evidence"><h3>{tr("سبب البلاغ")}</h3><p dir="auto">{report.reason}</p>{report.messageSeq && <><h3>{tr("نسخة الرسالة وقت البلاغ")}{report.scope === 'group' ? tr(" · محادثة اللّمة") : ''}</h3>{report.messageText ? <blockquote dir="auto">{report.messageText}</blockquote> : !report.audioUrl && <p>{tr("لا يتوفر نص.")}</p>}{report.audioUrl && <ReviewAudio path={report.audioUrl} />}</>}
      {report.drawingUrl && <><h3>{tr("الرسمة المبلّغ عنها")}</h3><ReviewDrawing path={report.drawingUrl} /></>}
      {report.mafia&&<><h3>{tr("بلاغ مافيا · ")}{mafiaReportCategoryLabel(report.mafia.category)}</h3><p>{tr("المجلس ")}<bdi>{report.mafia.roomCode}</bdi>{tr(" · المباراة ")}{report.mafia.matchId??tr("قديمة")} · {MAFIA_REPORT_STATUS_LABELS[report.mafia.status]}</p><ReviewMafia path={report.mafiaEvidenceUrl}/></>}
      {user.bio && <><h3>{tr("النبذة الحالية")}</h3><p dir="auto">{user.bio}</p></>}
    </div>
    {(user.avatarUrl || user.coverUrl) && <div className="moderation-public-images">{[['avatar', user.avatarUrl], ['cover', user.coverUrl]].map(([kind, value]) => { const url = profileAssetUrl(value, resolveAccountServer()); return url && <figure key={kind}><img src={url} alt={kindName(kind) + tr(" المنشورة")} loading="lazy" /><figcaption>{kindName(kind)}{tr(" المنشورة")}</figcaption></figure>; })}</div>}
    {user.suspended && <p className="online-notice">{tr("الحساب معلّق حاليًا.")}</p>}
    {report.resolvedAt && <p className="moderation-note">{tr("أُغلق في ")}{date(report.resolvedAt)}{report.resolution ? ` · ${report.resolution}` : ''}</p>}
    <div className="moderation-actions">
      {report.mafia?.status==='queued'&&!report.resolvedAt&&<Button disabled={disabled} onClick={()=>choose('review_mafia_report',{targetId:report.id},tr("بدء مراجعة هذا البلاغ فقط. لا يفرض هذا الإجراء عقوبة على الحساب."))}>{tr("بدء مراجعة بلاغ مافيا")}</Button>}
      {!report.resolvedAt && <Button variant="primary" disabled={disabled} onClick={() => choose('resolve_report', { targetId: report.id }, tr("إغلاق البلاغ بعد مراجعته. لا يحذف هذا الإجراء محتوى الحساب."))}>{tr("إغلاق البلاغ")}</Button>}
      {report.messageSeq && <Button variant="secondary" disabled={disabled} onClick={() => choose('remove_message', { targetId: String(report.messageSeq) }, tr("إزالة الرسالة ومرفقاتها من المحادثة لجميع المشاركين. تبقى أدلة البلاغ متاحة لفريق المراجعة."))}>{tr("إزالة الرسالة")}</Button>}
      {user.id && <>
        <Button variant="secondary" disabled={disabled} onClick={() => choose('clear_profile_text', { field: 'all', revision: user.revision }, tr("إعادة اسم «{v0}» إلى الاسم الافتراضي ومسح نبذته. راجع النص الحالي قبل التأكيد.", {v0: name}))}>{tr("إزالة الاسم والنبذة")}</Button>
        {['avatar', 'cover'].map(kind => user[kind + 'Version'] && <Button key={kind} variant="secondary" disabled={disabled} onClick={() => choose('remove_image', { kind, version: user[kind + 'Version'] }, tr("إزالة {v0} المنشورة للحساب «{v1}».", {v0: kindName(kind), v1: name}))}>{tr("إزالة ")}{kindName(kind)}</Button>)}
        <Button variant={user.suspended ? 'secondary' : 'danger'} disabled={disabled} onClick={() => choose(user.suspended ? 'restore_user' : 'suspend_user', {}, user.suspended ? tr("إعادة الوصول للميزات الاجتماعية والملف والغرف للحساب «{v0}».", {v0: name}) : tr("تعليق وصول «{v0}» للميزات الاجتماعية والملف والغرف. تبقى إدارة الحساب والاشتراك وحذف الحساب متاحة.", {v0: name}))}>{user.suspended ? tr("إعادة تفعيل الحساب") : tr("تعليق الحساب")}</Button>
      </>}
    </div>
  </Card>;
}

export function PendingImageCard({ image, disabled, onDecision }) {
  const [previewReady, setPreviewReady] = useState(false);
  const name = image.user?.name || tr("لاعب ميدان");
  const cover = image.kind === 'cover';
  const label = kindName(image.kind);
  const choose = action => onDecision({ body: { action, targetId: image.id, version: image.version }, summary: action === 'approve_image'
    ? cover ? tr("نشر الغلاف الجديد للحساب «{v0}» بدل غلافه الحالي.", { v0: name }) : tr("نشر الصورة الشخصية الجديدة للحساب «{v0}» بدل صورته الحالية.", { v0: name })
    : cover ? tr("رفض الغلاف الجديد. يبقى الغلاف المعتمد السابق إن وُجد، ويظهر سبب الرفض لصاحب الحساب.") : tr("رفض الصورة الشخصية الجديدة. تبقى الصورة المعتمدة السابقة إن وُجدت، ويظهر سبب الرفض لصاحب الحساب.") });
  return <Card className="moderation-image-card" data-kind={cover ? 'cover' : 'avatar'}>
    <h3 className="moderation-image-title">{label}</h3>
    <div className="moderation-image-preview"><ReviewImage path={image.previewUrl} label={label + tr(" بانتظار المراجعة")} onReady={setPreviewReady} /></div>
    <div className="moderation-image-account"><strong><bdi>{name}</bdi></strong>{image.user?.code && <bdi>{image.user.code}</bdi>}<span className="moderation-status">{tr("لم تُنشر بعد")}</span></div>
    {image.createdAt > 0 && <p className="moderation-image-date">{tr("أُرسلت في ")}<bdi>{date(image.createdAt)}</bdi></p>}
    <div className="moderation-actions">
      <Button data-design-id="approve-image" variant="primary" disabled={disabled || !previewReady || image.previewUrl !== `/api/moderation/images/${image.id}/${image.version}`} onClick={() => choose('approve_image')}>{tr("اعتماد الصورة")}</Button>
      <Button data-design-id="reject-image" variant="danger" disabled={disabled} onClick={() => choose('reject_image')}>{tr("رفض الصورة")}</Button>
    </div>
  </Card>;
}

function EmptyImageQueue() {
  return <Card className="moderation-photo-empty">
    <svg viewBox="0 0 120 84" width="120" height="84" fill="none" aria-hidden="true">
      <g stroke="#9561b7" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <rect x="25" y="15" width="63" height="52" rx="8" transform="rotate(-11 25 15)" fill="#f0deef" />
        <rect x="38" y="19" width="63" height="53" rx="8" fill="#fff8f0" />
        <path d="m40 61 15-16a5 5 0 0 1 7 0l11 12 8-8a5 5 0 0 1 7 0l11 11M13 35l-7-4m4 15H2m12 10-6 4m101-28 7-4m-5 15h7" />
        <circle cx="78" cy="34" r="5" fill="#ffdf8c" />
      </g>
    </svg>
    <h2>{tr("لا صور تنتظر المراجعة")}</h2>
    <p>{tr("يمكنك تحديث القائمة للتحقق من الطلبات الجديدة.")}</p>
  </Card>;
}

function ProfileImageQueue({ state, client, isCreator = false }) {
  const [decision, setDecision] = useState(null);
  const [notice, setNotice] = useState('');
  const loading = state.loading || state.section !== 'images';
  const busy = loading || state.saving;
  const refresh = () => { setNotice(''); client.load('images'); };
  return <section data-design-screen={isCreator ? 'creator.images' : 'moderation.images'} className={'moderation-photo-queue' + (isCreator ? ' is-creator-review' : '')} aria-label={tr("الصور الجديدة للمراجعة")}>
    {isCreator && <h2 className="moderation-photo-heading"><IconFlag />{tr("الصور الجديدة للمراجعة")}</h2>}
    <Button data-design-id="image-queue-refresh" className="moderation-photo-refresh" variant="primary" icon={<IconRotate />} disabled={busy} onClick={refresh}>{tr("تحديث القائمة")}</Button>
    {notice && <p role="status" className="online-notice">{notice}</p>}
    {state.error && <p role="alert" className="online-notice error">{tr(state.error)}</p>}
    <div className="moderation-photo-list" aria-busy={loading}>
      {state.images.map(image => <PendingImageCard key={`${image.id}:${image.version}`} image={image} disabled={busy} onDecision={setDecision} />)}
      {loading ? <p role="status">{tr("جارٍ تحميل القائمة…")}</p> : !state.images.length && !state.error ? <EmptyImageQueue /> : null}
    </div>
    {state.nextBefore && <Button variant="secondary" disabled={busy} onClick={() => client.load('images', state.status, true)}>{tr("عرض المزيد")}</Button>}
    {decision && <DecisionDialog decision={decision} client={client} onClose={() => setDecision(null)} onDone={() => {
      setDecision(null);
      setNotice(tr("حُفظ قرار المراجعة."));
      client.load('images');
    }} />}
  </section>;
}

function CreatorImageReviewSession({ userId }) {
  const { state, client } = useModeration();
  const authorized = state.userId === userId && state.moderator;
  useEffect(() => { if (authorized) client.load('images'); }, [authorized, client]);
  if (!authorized) return null;
  return <><PresentationStyles sheet={css} /><ProfileImageQueue state={state} client={client} isCreator /></>;
}

export function CreatorProfileImageReview() {
  const account = useAccount();
  const userId = account.ready && account.signedIn ? account.user?.id : null;
  return userId && account.me?.user?.id === userId && account.me.creator?.enabled === true
    ? <CreatorImageReviewSession key={userId} userId={userId} /> : null;
}

export function ModerationView({ state, client, account }) {
  const [decision, setDecision] = useState(null); const [notice, setNotice] = useState('');
  const listAlert = useRef(null);
  useEffect(() => {
    if (state.error) listAlert.current?.scrollIntoView({ block: 'nearest' });
  }, [state.error]);
  const allowed = account.signedIn && state.userId === account.user?.id && state.moderator;
  const images = allowed && state.section === 'images';
  const rows = state[state.section === 'audit' ? 'actions' : state.section] || [];
  const busy = state.loading || state.saving;
  return <Screen dir={getDirection()} className={'stack moderation-screen' + (images ? ' is-photo-review' : '')} aria-label={tr("مراجعة محتوى ميدان")}><PresentationStyles sheet={css} /><TopBar title={tr("مراجعة المحتوى")} eyebrow={tr("إدارة ميدان")} start={<IconButton label={tr("رجوع")} onClick={back}><IconBack /></IconButton>} />
    {!account.signedIn ? <Card className="stack"><h2>{tr("حساب المراجعة")}</h2><p className="card-muted">{tr("سجّل الدخول من الإعدادات بالحساب المصرّح له بالمراجعة.")}</p><Button onClick={() => navigate('/settings?section=account')}>{tr("فتح الإعدادات")}</Button></Card> : !state.ready ? <p role="status">{tr("جارٍ التحقق من صلاحية المراجعة…")}</p> : !allowed ? <Card className="stack">
      <h2>{state.accessUnconfirmed ? tr("صلاحية المراجعة") : tr("هذه الصفحة غير متاحة لحسابك")}</h2>
      {!state.accessUnconfirmed && <p className="card-muted">{tr("يحدد مالك ميدان الحسابات المخوّلة بالمراجعة.")}</p>}
      {state.error && <p role="alert">{tr(state.error)}</p>}
      <Button variant="secondary" onClick={() => client.start(account.user.id)}>{tr("إعادة التحقق")}</Button>
    </Card> : <>
      {images ? <p className="moderation-photo-heading">{tr("قرار واضح، ومحتوى مناسب")}</p> : <Card className="moderation-intro"><IconFlag /><div><h2>{tr("قرار واضح، ومحتوى مناسب")}</h2><p>{tr("راجع السياق قبل اتخاذ القرار. البلاغات والمعاينات خاصة بفريق المراجعة؛ لا تشاركها خارج غرض المعالجة.")}</p></div></Card>}
      <Segment label={tr("قائمة المراجعة")} value={state.section} onChange={value => { if (!busy) { setNotice(''); client.load(value, state.status); } }} options={[{ value: 'reports', label: tr("البلاغات") }, { value: 'images', label: tr("الصور الجديدة") }, { value: 'audit', label: tr("سجل القرارات") }]} />
      {images ? <ProfileImageQueue state={state} client={client} /> : <>
      <div className="moderation-toolbar">{state.section === 'reports' && <label>{tr("حالة البلاغ")}<select value={state.status} disabled={busy} onChange={event => client.load('reports', event.target.value)}><option value="open">{tr("بانتظار المراجعة")}</option><option value="resolved">{tr("المغلقة")}</option></select></label>}<Button variant="secondary" size="sm" disabled={busy} onClick={() => client.load()}>{tr("تحديث القائمة")}</Button></div>
      {notice && <p role="status" className="online-notice">{notice}</p>}{state.error && <p ref={listAlert} role="alert" className="online-notice error">{tr(state.error)}</p>}
      <div className="stack" aria-busy={state.loading}>{state.section === 'reports' ? rows.map(report => <ReportCard key={report.id} report={report} disabled={busy} onDecision={setDecision} />) : rows.map(item => <Card key={item.id} className="moderation-audit"><h2>{tr(ACTION_LABELS[item.action] || "قرار مراجعة")}</h2><p dir="auto">{item.reason}</p><small>{date(item.createdAt)}</small><details><summary>{tr("مرجع القرار")}</summary><p><bdi>{item.id}</bdi></p><p>{tr("الحساب: ")}<bdi>{item.subjectUserId || '—'}</bdi></p></details></Card>)}</div>
      {state.loading ? <p role="status">{tr("جارٍ تحميل القائمة…")}</p> : !rows.length && !state.error ? <Card className="moderation-empty"><h2>{state.section === 'reports' ? tr("لا بلاغات في هذه القائمة") : tr("لا قرارات مسجّلة بعد")}</h2><p className="card-muted">{tr("يمكنك تحديث القائمة للتحقق من الطلبات الجديدة.")}</p></Card> : null}
      {state.nextBefore && <Button variant="secondary" disabled={busy} onClick={() => client.load(state.section, state.status, true)}>{tr("عرض المزيد")}</Button>}
      {decision && <DecisionDialog decision={decision} client={client} onClose={() => setDecision(null)} onDone={() => { setDecision(null); setNotice(tr("حُفظ قرار المراجعة.")); client.load(); }} />}
      </>}
    </>}
  </Screen>;
}

export function ModerationScreen() {
  const { state, client, account } = useModeration();
  useEffect(() => { if (state.moderator) client.load(); }, [state.moderator, client]);
  return <ModerationView key={JSON.stringify([account.user?.id, state.moderator])} state={state} client={client} account={account} />;
}

export function ModerationSettingsLink() {
  const { state } = useModeration();
  return state.ready && state.moderator ? <Card className="stack"><span className="card-title">{tr("مراجعة المحتوى")}</span><p className="card-muted">{tr("بلاغات اللاعبين والصور الجديدة بانتظار مراجعتك.")}</p><Button variant="secondary" icon={<IconFlag />} onClick={() => navigate('/moderation')}>{tr("فتح لوحة المراجعة")}</Button></Card> : null;
}
