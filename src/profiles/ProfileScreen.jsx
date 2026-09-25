import React, { useEffect, useRef, useState } from 'react';
import { Button, Modal } from '../shared/ui/components.jsx';
import { useAccount } from '../shared/account/context.js';
import { SignInSheet } from '../shared/account/SignInSheet.jsx';
import { useSocial } from '../social/SocialProvider.jsx';
import { navigate } from '../platform/router.js';
import { useProfiles } from './ProfileProvider.jsx';
import { PROFILE_THEMES, AVATAR_PRESETS, TITLES, ACHIEVEMENTS, profileTheme, avatarPreset, titleLabel } from './catalog.js';
import { decodeProfileImage, cropProfileImage, cropRect } from './client-images.js';
import profileCss from './profile.css';

const SHARE_ORIGIN = 'https://maydan-game.mf103871.workers.dev';
const EMPTY = [];
const paths = {
  back: 'M9 5l7 7-7 7M16 12H4', close: 'M6 6l12 12M6 18L18 6',
  share: 'M12 16V3M7 8l5-5 5 5M5 12v9h14v-9', copy: 'M8 8h12v13H8zM16 8V3H3v13h5',
  edit: 'M15 4l5 5M3 21l5-1L21 7a2 2 0 0 0-5-5L3 16v5Z', more: 'M5 12h.01M12 12h.01M19 12h.01',
  check: 'M5 12l4 4L19 6', lock: 'M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4',
  spark: 'M12 2l2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8L12 2Z',
  person: 'M4 21v-2a8 8 0 0 1 16 0v2M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  home: 'M3 10l9-8 9 8v11H3V10ZM9 21v-8h6v8',
  compass: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM16 8l-3 5-5 3 3-5 5-3Z',
  globe: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM2 12h20M12 2c5 5 5 15 0 20-5-5-5-15 0-20Z',
  trophy: 'M7 3h10v7a5 5 0 0 1-10 0V3ZM7 5H3v4a4 4 0 0 0 4 4M17 5h4v4a4 4 0 0 1-4 4M12 15v6M8 21h8',
  crown: 'M3 6l4 4 5-7 5 7 4-4-2 13H5L3 6ZM5 22h14',
  chat: 'M21 11a9 9 0 0 1-9 9H5l-3 3V11a9 9 0 0 1 19 0ZM7 9h9M7 13h6',
  plus: 'M12 5v14M5 12h14', shield: 'M12 2l8 3v7c0 5-8 10-8 10S4 17 4 12V5l8-3ZM8 8l8 8M16 8l-8 8',
  camera: 'M3 7h4l2-4h6l2 4h4v14H3V7ZM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
};
function Icon({ name, size = 22, className = '' }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.spark} /></svg>;
}
function IconButton({ label, icon, ...props }) { return <button type="button" className="profile-icon-button" aria-label={label} title={label} {...props}><Icon name={icon} /></button>; }
const nameOf = profile => profile?.name?.trim() || 'لاعب ميدان';
const count = value => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value).toLocaleString('ar') : '—';
const codepoints = text => [...String(text || '')];
const clamp = value => Math.max(-1, Math.min(1, value));
function errorText(error) { const text = typeof error === 'string' ? error : error?.message; return text && /[\u0600-\u06ff]/.test(text) ? text : 'تعذّر إكمال الخطوة. حاول مرة أخرى.'; }
export function themeStyle(id) { const theme = profileTheme(id); return { '--profile-accent': theme.color, '--profile-soft': theme.accent, '--profile-deep': theme.color, '--profile-gradient': theme.gradient }; }
export function profileShareUrl(id) { return SHARE_ORIGIN + '/#/profile/' + encodeURIComponent(id); }
export function profileEditPatch(draft, { avatarChosen = false, revision }) {
  const { avatarPreset: selectedAvatar, ...fields } = draft;
  return { ...fields, ...(avatarChosen ? { avatarPreset: selectedAvatar } : {}),
    name: draft.name.trim(), bio: draft.bio.trim(), selectedTitle: draft.selectedTitle || null, revision };
}
export function profilePresence(profile, now = Date.now()) {
  if (profile.online) return 'متصل الآن';
  const last = typeof profile.lastActiveAt === 'number' ? profile.lastActiveAt : Date.parse(profile.lastActiveAt);
  if (!Number.isFinite(last) || last <= 0) return null;
  const minutes = Math.max(0, Math.floor((now - last) / 60000));
  if (minutes < 1) return 'آخر ظهور قبل قليل';
  if (minutes < 60) return 'آخر ظهور قبل ' + minutes.toLocaleString('ar') + ' دقيقة';
  return 'آخر ظهور ' + new Date(last).toLocaleDateString('ar', { day: 'numeric', month: 'long' });
}
function Notice({ children, error = false, onClose }) { return <div className={'profile-notice' + (error ? ' is-error' : '')} role={error ? 'alert' : 'status'}><span>{children}</span>{onClose && <IconButton label="إخفاء التنبيه" icon="close" onClick={onClose} />}</div>; }
function EmptyState({ title, children, action, icon = 'person' }) { return <div className="profile-empty"><span className="profile-empty-art"><Icon name={icon} /></span><h2>{title}</h2><p>{children}</p>{action}</div>; }
function LoadingProfile() { return <div className="profile-loading" role="status" aria-label="جارٍ تحميل الملف الشخصي"><div className="profile-loading-cover" /><div className="profile-loading-lines"><span /><span /><span /></div></div>; }
export function ProfileAvatar({ profile, className = '' }) {
  const [failed, setFailed] = useState('');
  return <span className={'profile-avatar ' + className}>{profile.avatarUrl && failed !== profile.avatarUrl ? <img src={profile.avatarUrl} alt={'الصورة الشخصية لـ ' + nameOf(profile)} onError={() => setFailed(profile.avatarUrl)} /> : <span aria-label={avatarPreset(profile.avatarPreset).label}>{avatarPreset(profile.avatarPreset).emoji}</span>}</span>;
}
function Cover({ profile, label = true }) {
  const [failed, setFailed] = useState('');
  return <div className="profile-cover"><div className="profile-cover-art" /><span className="profile-cover-spark"><Icon name="spark" size={40} /></span>{profile.coverUrl && failed !== profile.coverUrl && <img src={profile.coverUrl} alt="" onError={() => setFailed(profile.coverUrl)} />}{label && !profile.coverUrl && <span className="profile-cover-label">لك مكان في الميدان</span>}</div>;
}
export function Achievements({ profile, owner }) {
  const earned = new Set(profile.earnedBadges || EMPTY);
  return <section className="profile-section" aria-label="الإنجازات"><header className="profile-section-heading"><div><h2>{owner ? 'إنجازاتك في الميدان' : 'إنجازات اللاعب'}</h2><p>كل جمعة تضيف شيئًا لرحلتك.</p></div><span className="profile-count-pill"><Icon name="trophy" size={15} /><bdi dir="ltr">{count(earned.size)} / {count(ACHIEVEMENTS.length)}</bdi></span></header><div className="profile-achievement-grid">{ACHIEVEMENTS.map(rule => {
    const state = profile.achievements?.find(item => item.id === rule.id);
    const unlocked = earned.has(rule.id);
    const current = Number.isFinite(state?.current) ? Math.max(0, state.current) : unlocked ? rule.target : null;
    const progress = current === null ? 0 : Math.min(1, current / rule.target);
    return <article key={rule.id} className={'profile-achievement' + (unlocked ? '' : ' is-locked')} aria-label={rule.label + (unlocked ? '، مكتمل' : '، لم يُفتح بعد')}><span className="profile-achievement-icon"><Icon name={rule.icon} /></span><h3>{rule.label}</h3><p>{rule.description}</p>{unlocked ? <span className="profile-achievement-state"><Icon name="check" />إنجاز مكتمل</span> : <>{current !== null && <><div className="profile-progress" role="progressbar" aria-label={rule.label} aria-valuemin={0} aria-valuemax={rule.target} aria-valuenow={Math.min(current, rule.target)}><span style={{ width: progress * 100 + '%' }} /></div><span className="profile-progress-text" dir="ltr">{count(Math.min(current, rule.target))} / {count(rule.target)}</span></>}<span className="profile-achievement-state"><Icon name="lock" />لم يُفتح بعد</span></>}</article>;
  })}</div></section>;
}
export function ProfileStats({ profile }) {
  const stats = profile.stats || {};
  return <section className="profile-section profile-stats" aria-label="إحصاءات اللعب"><h2>الرحلة بالأرقام</h2>{[['localSessions', 'جلسات مستضافة', 'home'], ['onlineMatches', 'مباريات أونلاين', 'globe'], ['onlineWins', 'انتصارات أونلاين', 'trophy'], ['distinctGames', 'ألعاب مختلفة', 'compass']].map(([key, label, icon]) => <div className="profile-stat-row" key={key}><span className="profile-stat-icon"><Icon name={icon} /></span><span className="profile-stat-copy">{label}</span><strong>{count(stats[key])}</strong></div>)}<p className="profile-stat-note">تُحتسب الجلسات والمباريات المكتملة منذ إطلاق الملفات الشخصية. الانتصارات لفبركة أونلاين.</p></section>;
}
function CropDialog({ crop, profiles, revision, onClose, onDone }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [width, setWidth] = useState(320);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stage = useRef(null);
  const drag = useRef(null);
  const { image, kind } = crop;
  useEffect(() => {
    const node = stage.current;
    const update = () => { if (node) setWidth(node.clientWidth); };
    update(); const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(node); return () => observer?.disconnect();
  }, []);
  const rectangle = cropRect(image, { kind, zoom, offsetX: offset.x, offsetY: offset.y });
  const scale = width / rectangle.width;
  const travelX = (image.width - rectangle.width) * scale / 2;
  const travelY = (image.height - rectangle.height) * scale / 2;
  const apply = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { const dataUrl = await cropProfileImage(image, { kind, zoom, offsetX: offset.x, offsetY: offset.y }); const updated = await profiles.uploadImage(kind, dataUrl, revision); onDone(updated); }
    catch (err) { setError(errorText(err)); setBusy(false); }
  };
  return <Modal title={kind === 'avatar' ? 'ضبط الصورة الشخصية' : 'ضبط صورة الغلاف'} className="profile-dialog profile-crop-dialog" onClose={busy ? null : onClose} footer={<div className="profile-edit-footer"><Button variant="ghost" onClick={onClose} disabled={busy}>إلغاء</Button><Button variant="primary" onClick={apply} loading={busy}>حفظ الصورة</Button></div>}><p className="profile-crop-hint">اسحب الصورة داخل الإطار، أو حرّكها بمفاتيح الأسهم. استخدم شريط التكبير لضبط القص.</p><div ref={stage} className={'profile-crop-stage' + (kind === 'cover' ? ' is-cover' : '')} tabIndex={busy ? -1 : 0} role="group" aria-label="إطار قص الصورة؛ استخدم الأسهم لتحريكها" onKeyDown={event => {
    const moves = { ArrowLeft: [.06, 0], ArrowRight: [-.06, 0], ArrowUp: [0, .06], ArrowDown: [0, -.06] }; const move = moves[event.key];
    if (move && !busy) { event.preventDefault(); setOffset(value => ({ x: clamp(value.x + move[0]), y: clamp(value.y + move[1]) })); }
  }} onPointerDown={event => { if (busy) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, offset }; }} onPointerMove={event => {
    if (!drag.current || busy) return;
    setOffset({ x: travelX ? clamp(drag.current.offset.x - (event.clientX - drag.current.x) / travelX) : 0, y: travelY ? clamp(drag.current.offset.y - (event.clientY - drag.current.y) / travelY) : 0 });
  }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}><img src={image.url} alt="معاينة موضع الصورة قبل الحفظ" draggable={false} style={{ width: image.width * scale, height: image.height * scale, left: -rectangle.x * scale, top: -rectangle.y * scale }} /></div><label className="profile-zoom">التكبير<input type="range" min="1" max="3" step="0.01" value={zoom} disabled={busy} onChange={event => setZoom(Number(event.target.value))} aria-label="تكبير الصورة" /><span>{zoom.toFixed(1)}×</span></label>{busy && <p role="status" className="profile-crop-hint">جارٍ حفظ الصورة…</p>}{error && <Notice error>{error}</Notice>}</Modal>;
}
export function ProfileEditor({ profile, profiles, onClose, onSaved }) {
  const [draft, setDraft] = useState(() => ({ name: profile.name || '', bio: profile.bio || '', theme: profile.theme, avatarPreset: profile.avatarPreset, selectedTitle: profile.earnedTitles?.includes(profile.selectedTitle) ? profile.selectedTitle : '', featuredBadges: (profile.featuredBadges || []).filter(id => profile.earnedBadges?.includes(id)).slice(0, 3) }));
  const [busy, setBusy] = useState('');
  const [avatarChosen, setAvatarChosen] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [crop, setCrop] = useState(null);
  const [discard, setDiscard] = useState(false);
  const file = useRef(null);
  const feedback = useRef(null);
  useEffect(() => { if (error || notice) feedback.current?.scrollIntoView({ block: 'nearest' }); }, [error, notice]);
  const kind = useRef('avatar');
  const alive = useRef(true);
  const initial = useRef(JSON.stringify(draft));
  const editRevision = useRef(profile.revision);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => () => crop?.image.dispose(), [crop]);
  const earnedBadges = new Set(profile.earnedBadges || EMPTY);
  const earnedTitles = new Set(profile.earnedTitles || EMPTY);
  const saving = Boolean(busy || profiles.saving);
  const patch = next => setDraft(value => ({ ...value, ...next }));
  const close = () => { if (saving || crop) return; if (avatarChosen || JSON.stringify(draft) !== initial.current) setDiscard(true); else onClose(); };
  const pickFile = target => { kind.current = target; file.current?.click(); };
  const readFile = async event => {
    const selected = event.target.files?.[0]; event.target.value = ''; if (!selected) return;
    setBusy('decode'); setError(''); setNotice('');
    try { const image = await decodeProfileImage(selected); if (alive.current) setCrop({ image, kind: kind.current }); else image.dispose(); }
    catch (err) { if (alive.current) setError(errorText(err)); }
    finally { if (alive.current) setBusy(''); }
  };
  const remove = async target => {
    setBusy(target); setError(''); setNotice('');
    try { const updated = await profiles.removeImage(target, editRevision.current); if (Number.isInteger(updated?.revision)) editRevision.current = updated.revision; setNotice(target === 'avatar' ? 'أُزيلت الصورة الشخصية.' : 'أُزيلت صورة الغلاف.'); return true; }
    catch (err) { setError(errorText(err)); return false; }
    finally { setBusy(''); }
  };
  const chooseAvatar = id => { if (saving) return; setAvatarChosen(true); patch({ avatarPreset: id }); };
  const save = async () => {
    if (saving) return;
    const name = draft.name.trim();
    if (codepoints(name).length < 2 || codepoints(name).length > 32) { setError('اكتب اسمًا من حرفين إلى 32 حرفًا.'); return; }
    setBusy('save'); setError('');
    try { await profiles.saveProfile(profileEditPatch(draft, { avatarChosen, revision: editRevision.current })); onSaved(); }
    catch (err) { setError(errorText(err)); setBusy(''); }
  };
  return <><Modal title="ملفك، على طريقتك" className="profile-dialog profile-editor" onClose={saving ? null : close} footer={<div className="profile-edit-footer"><Button variant="ghost" disabled={saving} onClick={close}>إلغاء</Button><Button variant="primary" loading={busy === 'save'} disabled={saving} onClick={save}>حفظ التغييرات</Button></div>}><div style={themeStyle(draft.theme)}><p className="profile-dialog-intro">عرّف أصحابك عليك، واختر اللمسة التي تشبهك.</p><div ref={feedback}>{error && <Notice error>{error}</Notice>}{notice && <Notice>{notice}</Notice>}</div><input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={readFile} />
    <section className="profile-edit-section"><label className="profile-field">الاسم<input aria-label="الاسم" autoFocus value={draft.name} maxLength={64} autoComplete="nickname" disabled={saving} onChange={event => patch({ name: codepoints(event.target.value).slice(0, 32).join('') })} /><small dir="ltr">{count(codepoints(draft.name).length)} / {count(32)}</small></label><label className="profile-field">نبذة عنك<textarea aria-label="نبذة عنك" rows={3} value={draft.bio} maxLength={320} disabled={saving} placeholder="الألعاب التي تحبها، أو كلمة تعرّف عنك…" onChange={event => patch({ bio: codepoints(event.target.value).slice(0, 160).join('') })} /><small dir="ltr">{count(codepoints(draft.bio).length)} / {count(160)}</small></label></section>
    <section className="profile-edit-section"><h3>الصورة الشخصية</h3><div className="profile-image-editor-row"><ProfileAvatar profile={{ ...profile, avatarUrl: avatarChosen ? null : profile.avatarUrl, avatarPreset: draft.avatarPreset }} /><div className="profile-image-actions"><Button variant="secondary" icon={<Icon name="camera" size={17} />} disabled={saving} onClick={() => pickFile('avatar')}>{profile.avatarUrl ? 'تغيير الصورة' : 'رفع صورة'}</Button>{profile.avatarUrl && <Button variant="ghost" className="is-danger" disabled={saving} onClick={() => remove('avatar')}>إزالة الصورة</Button>}</div></div><p>أو اختر شخصية من الميدان:</p><div className="profile-avatar-grid">{AVATAR_PRESETS.map(avatar => <button type="button" className="profile-avatar-choice" key={avatar.id} aria-label={avatar.label} aria-pressed={(!profile.avatarUrl || avatarChosen) && draft.avatarPreset === avatar.id} disabled={saving} onClick={() => chooseAvatar(avatar.id)}><span aria-hidden="true">{avatar.emoji}</span>{(!profile.avatarUrl || avatarChosen) && draft.avatarPreset === avatar.id && <Icon name="check" className="profile-avatar-check" />}</button>)}</div></section>
    <section className="profile-edit-section"><h3>الغلاف</h3><div className="profile-image-editor-row"><div className="profile-edit-cover">{profile.coverUrl ? <img src={profile.coverUrl} alt="الغلاف الحالي" /> : <div className="profile-cover-art" />}</div><div className="profile-image-actions"><Button variant="secondary" disabled={saving} onClick={() => pickFile('cover')}>{profile.coverUrl ? 'تغيير الغلاف' : 'رفع غلاف'}</Button>{profile.coverUrl && <Button variant="ghost" className="is-danger" disabled={saving} onClick={() => remove('cover')}>إزالة الغلاف</Button>}</div></div><p>تُحفظ الصور فور تطبيقها أو إزالتها. حفظ الاسم والنبذة من زر «حفظ التغييرات».</p>{busy === 'decode' && <p role="status">جارٍ تجهيز الصورة…</p>}</section>
    <section className="profile-edit-section"><h3>ألوان ملفك</h3><div className="profile-theme-grid">{PROFILE_THEMES.map(theme => <button type="button" key={theme.id} className="profile-theme-choice" aria-pressed={draft.theme === theme.id} disabled={saving} onClick={() => patch({ theme: theme.id })}><span className="profile-theme-swatch" style={{ background: theme.gradient }}>{draft.theme === theme.id && <Icon name="check" />}</span>{theme.label}</button>)}</div></section>
    <section className="profile-edit-section"><label className="profile-field">لقبك<select aria-label="لقبك" value={draft.selectedTitle} disabled={saving} onChange={event => patch({ selectedTitle: event.target.value })}><option value="">بدون لقب</option>{TITLES.map(title => <option key={title.id} value={title.id} disabled={!earnedTitles.has(title.id)}>{title.label}{earnedTitles.has(title.id) ? '' : ' — لم يُفتح بعد'}</option>)}</select></label><p>تفتح الألقاب بإكمال الإنجازات.</p></section>
    <section className="profile-edit-section"><h3>شاراتك البارزة · <bdi dir="ltr">{count(draft.featuredBadges.length)} / {count(3)}</bdi></h3><div className="profile-badge-picker">{ACHIEVEMENTS.map(badge => {
      const selected = draft.featuredBadges.includes(badge.id); const earned = earnedBadges.has(badge.id);
      return <button type="button" key={badge.id} className={'profile-badge-choice' + (!earned ? ' is-locked' : '')} aria-pressed={selected} aria-label={badge.label + (earned ? '' : '، لم تُفتح بعد')} disabled={saving || !earned || (!selected && draft.featuredBadges.length >= 3)} onClick={() => patch({ featuredBadges: selected ? draft.featuredBadges.filter(id => id !== badge.id) : [...draft.featuredBadges, badge.id] })}><Icon name={badge.icon} /><span>{badge.label}</span><Icon name={earned ? selected ? 'check' : 'plus' : 'lock'} size={14} /></button>;
    })}</div><p>اختر حتى ثلاث شارات مكتسبة لتظهر بجانب هويتك.</p></section></div></Modal>
    {crop && <CropDialog crop={crop} profiles={profiles} revision={editRevision.current} onClose={() => setCrop(null)} onDone={updated => { if (Number.isInteger(updated?.revision)) editRevision.current = updated.revision; if (crop.kind === 'avatar') setAvatarChosen(false); setCrop(null); setNotice('حُفظت الصورة الجديدة.'); }} />}
    {discard && <Modal title="تجاهل التغييرات؟" className="profile-dialog" onClose={() => setDiscard(false)} footer={<div className="profile-edit-footer"><Button variant="ghost" onClick={() => setDiscard(false)}>متابعة التعديل</Button><Button variant="danger" onClick={onClose}>تجاهل التغييرات</Button></div>}><p className="profile-dialog-intro">لن تُحفظ تعديلات الاسم والنبذة والاختيارات. الصور التي حفظتها تبقى كما هي.</p></Modal>}
  </>;
}
function SafetyDialog({ action, profile, social, onClose, onDone }) {
  const [reason, setReason] = useState(''); const [details, setDetails] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const report = action === 'report';
  const submit = async () => {
    setBusy(true); setError('');
    try { if (report) await social.reportUser(profile.id, { reason: [reason, details.trim()].filter(Boolean).join(': ') }); else await social.blockUser(profile.id); onDone(); }
    catch (err) { setError(errorText(err)); setBusy(false); }
  };
  return <Modal title={report ? 'الإبلاغ عن الحساب' : 'حظر ' + nameOf(profile) + '؟'} onClose={busy ? null : onClose} className="profile-dialog" footer={<div className="profile-edit-footer"><Button variant="ghost" disabled={busy} onClick={onClose}>إلغاء</Button><Button variant={report ? 'primary' : 'danger'} loading={busy} disabled={busy || social.offline || (report && !reason)} onClick={submit}>{report ? 'إرسال البلاغ' : 'حظر'}</Button></div>}><p className="profile-dialog-intro">{report ? 'لن نعرض بلاغك لهذا الشخص.' : 'لن يستطيع إرسال طلبات صداقة أو رسائل إليك، وسيُزال من أصدقائك.'}</p>{report && <><label className="profile-field">سبب الإبلاغ<select aria-label="سبب الإبلاغ" value={reason} onChange={event => setReason(event.target.value)} disabled={busy}><option value="">اختر السبب</option>{['محتوى غير مناسب', 'انتحال شخصية', 'إساءة أو تنمر', 'رسائل مزعجة', 'سبب آخر'].map(item => <option key={item}>{item}</option>)}</select></label><label className="profile-field">تفاصيل إضافية (اختياري)<textarea maxLength={800} rows={3} value={details} disabled={busy} onChange={event => setDetails(event.target.value)} /></label></>}{error && <Notice error>{error}</Notice>}</Modal>;
}
export function ProfileView({ account, profiles, social, profileId, onNavigate = navigate }) {
  const key = !profileId || profileId === account.user?.id ? 'me' : profileId;
  const profile = key === 'me' ? profiles.mine : profiles.profiles?.[key];
  const owner = Boolean(account.signedIn && profile && (profile.relationship === 'self' || profile.id === account.user?.id));
  const [editing, setEditing] = useState(false); const [signIn, setSignIn] = useState(false); const [menu, setMenu] = useState(false); const [action, setAction] = useState('');
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(null); const [loadError, setLoadError] = useState(''); const [shareLink, setShareLink] = useState('');
  const notify = (text, error = false) => setNotice({ text, error });
  const load = async () => { setLoadError(''); try { await profiles.loadProfile(key); } catch (err) { setLoadError(errorText(err)); } };
  useEffect(() => { if (account.ready && account.signedIn && profiles.ready) { let active = true; setLoadError(''); Promise.resolve(profiles.loadProfile(key)).catch(err => { if (active) setLoadError(errorText(err)); }); return () => { active = false; }; } }, [account.ready, account.signedIn, profiles.ready, key, profiles.loadProfile]);
  const error = Object.hasOwn(profiles.errors || {}, key) ? profiles.errors[key] : loadError;
  const copyCode = async () => { try { if (!navigator.clipboard?.writeText) throw new Error('يمكنك تحديد الرمز ونسخه يدويًا.'); await navigator.clipboard.writeText(profile.code); notify(owner ? 'نُسخ رمزك في ميدان.' : 'نُسخ رمز الصديق.'); } catch (err) { notify(errorText(err), true); } };
  const share = async () => {
    const url = profileShareUrl(profile.id);
    try { if (navigator.share) await navigator.share({ title: nameOf(profile) + ' في ميدان', url }); else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); notify('نُسخ رابط الملف الشخصي.'); } else setShareLink(url); }
    catch (err) { if (err?.name !== 'AbortError') setShareLink(url); }
  };
  const friendship = async type => {
    if (busy || social.offline) return;
    setBusy(true);
    try {
      if (type === 'send') await social.sendRequest(profile.id);
      else { if (!profile.requestId) throw new Error('تغيّر الطلب. أعد تحميل الملف وحاول مجددًا.'); if (type === 'accept') await social.acceptRequest(profile.requestId); else await social.cancelRequest(profile.requestId); }
      await profiles.loadProfile(key); notify(type === 'send' ? 'أُرسل طلب الصداقة.' : type === 'accept' ? 'أُضيف إلى أصدقائك.' : 'أُلغي الطلب.');
    } catch (err) { notify(errorText(err), true); } finally { setBusy(false); }
  };
  const presence = profile ? profilePresence(profile) : null;
  const featured = (profile?.featuredBadges || EMPTY).filter(id => profile?.earnedBadges?.includes(id)).slice(0, 3).map(id => ACHIEVEMENTS.find(item => item.id === id)).filter(Boolean);
  const selectedTitle = profile?.earnedTitles?.includes(profile.selectedTitle) ? titleLabel(profile.selectedTitle) : '';
  return <main className="profile-screen" dir="rtl" style={themeStyle(profile?.theme)} aria-label="ملف ميدان الشخصي"><style>{profileCss}</style><header className="profile-page-head"><div className="profile-page-heading"><IconButton label="العودة" icon="back" onClick={() => onNavigate(profileId && !owner ? '/friends' : '/')} /><div><span>{owner || !profileId ? 'هويتك في الميدان' : 'أهل الميدان'}</span><h1>{owner || !profileId ? 'ملفي الشخصي' : 'الملف الشخصي'}</h1></div></div>{account.signedIn && profile && !error && <button type="button" className="profile-share-button" onClick={share}><Icon name="share" size={18} />مشاركة الملف</button>}</header>
    {notice && <Notice error={notice.error} onClose={() => setNotice(null)}>{notice.text}</Notice>}
    {!account.ready ? <LoadingProfile /> : !account.signedIn ? <EmptyState title="لك هوية في الميدان" action={<Button variant="primary" onClick={() => setSignIn(true)}>تسجيل الدخول</Button>}>سجّل الدخول لتعرض ملفك، وتكتشف إنجازاتك، وتتعرّف على أصحابك.</EmptyState> : error ? <EmptyState title="تعذّر عرض الملف" action={<Button variant="secondary" onClick={load}>إعادة المحاولة</Button>}>{error}</EmptyState> : !profile ? <LoadingProfile /> : <>
      <article className="profile-card"><Cover profile={profile} /><div className="profile-identity"><div className="profile-identity-top"><ProfileAvatar profile={profile} />{owner ? <button type="button" className="profile-owner-edit" onClick={() => setEditing(true)}><Icon name="edit" size={18} />تعديل الملف</button> : <div className="profile-contact-actions">{profile.relationship === 'friend' ? <Button variant="primary" icon={<Icon name="chat" size={17} />} onClick={() => onNavigate('/friends/' + encodeURIComponent(profile.id))}>محادثة</Button> : profile.relationship === 'pending_incoming' ? <Button variant="primary" loading={busy} disabled={social.offline || busy} onClick={() => friendship('accept')}>قبول الصداقة</Button> : profile.relationship === 'pending_outgoing' ? <><span className="profile-request-status">بانتظار قبول الصداقة</span><Button variant="secondary" loading={busy} disabled={social.offline || busy} onClick={() => friendship('cancel')}>إلغاء الطلب</Button></> : <Button variant="primary" loading={busy} disabled={social.offline || busy} icon={<Icon name="plus" size={17} />} onClick={() => friendship('send')}>إضافة صديق</Button>}<IconButton label="خيارات الحساب" icon="more" onClick={() => setMenu(true)} /></div>}</div><div className="profile-name-row"><h2><bdi>{nameOf(profile)}</bdi></h2>{selectedTitle && <span className="profile-earned-title"><Icon name="crown" size={15} />{selectedTitle}</span>}</div><div className="profile-code-row"><button type="button" className="profile-code" onClick={copyCode} aria-label="نسخ رمز الصديق"><bdi>{profile.code}</bdi><Icon name="copy" size={15} /></button><span className="profile-meta-dot" /><span>{count(profile.friendCount)} أصدقاء</span>{presence && <><span className="profile-meta-dot" /><span className={'profile-presence' + (profile.online ? ' is-online' : '')}><i />{presence}</span></>}</div>{profile.bio ? <p className="profile-bio" dir="auto">{profile.bio}</p> : owner ? <p className="profile-bio is-empty">أضف نبذة صغيرة… وخَلّ أصحابك يتعرّفون عليك.</p> : null}<div className="profile-showcase"><span className="profile-showcase-label">شارات بارزة</span>{featured.length ? featured.map(badge => <span key={badge.id} className="profile-featured-badge" title={badge.description}><Icon name={badge.icon} />{badge.label}</span>) : <span className="profile-showcase-empty">{owner ? 'اختر شاراتك المكتسبة من تعديل الملف.' : 'لم يختر شارات بارزة بعد.'}</span>}</div></div></article>
      <div className="profile-content"><Achievements profile={profile} owner={owner} /><aside className="profile-side"><ProfileStats profile={profile} /><div className="profile-tip"><Icon name="spark" size={26} /><h3>بصمتك تكبر مع كل جمعة</h3><p>الإنجازات تحكي مشاركتك في ميدان. جرّب لعبة جديدة، أو اجمع أصحابك على جولة أخرى.</p></div></aside></div>
    </>}
    <SignInSheet open={signIn} onClose={() => setSignIn(false)} note="سجّل الدخول لملفك الشخصي وأصدقائك وإنجازاتك في ميدان." />
    {account.signedIn && owner && editing && profile && <ProfileEditor profile={profile} profiles={profiles} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); notify('حُفظ ملفك الشخصي.'); }} />}
    {account.signedIn && menu && profile && <Modal title={'خيارات ' + nameOf(profile)} className="profile-dialog" onClose={() => setMenu(false)}><div className="profile-menu"><button type="button" className="is-danger" onClick={() => { setMenu(false); setAction('block'); }}><Icon name="shield" />حظر الحساب</button><button type="button" onClick={() => { setMenu(false); setAction('report'); }}>الإبلاغ عن الحساب</button></div></Modal>}
    {account.signedIn && action && profile && <SafetyDialog action={action} profile={profile} social={social} onClose={() => setAction('')} onDone={() => { setAction(''); if (action === 'block') onNavigate('/friends'); else notify('وصل بلاغك. شكرًا لمساعدتنا.'); }} />}
    {shareLink && <Modal title="رابط الملف الشخصي" className="profile-dialog" onClose={() => setShareLink('')}><p className="profile-dialog-intro">انسخ الرابط وأرسله لأصحابك.</p><label className="profile-field">رابط المشاركة<input dir="ltr" readOnly value={shareLink} onFocus={event => event.target.select()} /></label></Modal>}
  </main>;
}
export function ProfileScreen({ profileId, id }) {
  const account = useAccount(); const profiles = useProfiles(); const social = useSocial();
  const selected = profileId || id || null;
  return <ProfileView key={(account.user?.id || 'guest') + ':' + (selected || 'me')} account={account} profiles={profiles} social={social} profileId={selected} />;
}
