import { tr, getUiLocale } from '../shared/i18n/core.js';
import { ProfileAvatar as SharedProfileAvatar, canPreviewLivingFrames } from './ProfileAvatar.jsx';
import { getCosmetic, PLUS_ITEMS } from '../plus/catalog.js';
import plusCss from '../plus/plus.css?sheet';
import identityCss from './identity.css?sheet';
import skinCss from './profile-skin.css?sheet';
import { useI18n } from '../shared/i18n/react.jsx';
import { PresentationStyles } from '../shared/ui/PresentationStyles.jsx';
import { profileSkin, profileSkinStyle } from './profile-skin.js';
import { PlayerName } from './PlayerIdentity.jsx';
import { cosmeticPosterSources } from './identity-assets.js';
import React, { useEffect, useRef, useState } from 'react';
import { Button, Modal } from '../shared/ui/components.jsx';
import { useAccount } from '../shared/account/context.js';
import { SignInSheet } from '../shared/account/SignInSheet.jsx';
import { useSocial } from '../social/SocialProvider.jsx';
import { navigate, back } from '../platform/router.js';
import { useProfiles } from './ProfileProvider.jsx';
import { PROFILE_THEMES, AVATAR_PRESETS, TITLES, ACHIEVEMENTS, profileTheme, avatarPreset, titleLabel } from './catalog.js';
import { decodeProfileImage, uploadCroppedProfileImage, cropRect } from './client-images.js';
import profileCss from './profile.css?sheet';
import { ImageReviewStatus } from './ImageReviewStatus.jsx';
import { MafiaProgressPanel } from './mafia-panel.jsx';
import { AccountProgressionProfile } from './progression/AccountProgressionProfile.jsx';
import { useAcceptedFeedback } from '../shared/fx/accepted-feedback.js';

const SHARE_ORIGIN = 'https://maydan-game.mf103871.workers.dev';
const EMPTY = [];
const paths = {
  settings: 'M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z',
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
  return <svg data-directional={name === 'back' ? 'back' : undefined} className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.spark} /></svg>;
}
function IconButton({ label, icon, ...props }) { return <button type="button" data-design-id={props['data-design-id'] || ({ back:'back', close:'close', more:'menu' })[icon]} className="profile-icon-button" aria-label={label} title={label} {...props}><Icon name={icon} /></button>; }
const nameOf = profile => profile?.name?.trim() || tr("لاعب ميدان");
const count = value => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value).toLocaleString(getUiLocale()) : '—';
const codepoints = text => [...String(text || '')];
const clamp = value => Math.max(-1, Math.min(1, value));
function errorText(error) { const text = typeof error === 'string' ? error : error?.message; return text && /[\u0600-\u06ff]/.test(text) ? text : tr("تعذّر إكمال الخطوة. حاول مرة أخرى."); }
export function themeStyle(id) { const theme = profileTheme(id); return { '--profile-accent': theme.color, '--profile-soft': theme.accent, '--profile-deep': theme.color, '--profile-gradient': theme.gradient }; }
export function profileShareUrl(id) { return SHARE_ORIGIN + '/#/profile/' + encodeURIComponent(id); }
export function profileEditPatch(draft, { avatarChosen = false, revision }) {
  const { avatarPreset: selectedAvatar, ...fields } = draft;
  return { ...fields, ...(avatarChosen ? { avatarPreset: selectedAvatar } : {}),
    name: draft.name.trim(), bio: draft.bio.trim(), selectedTitle: draft.selectedTitle || null, revision };
}
export function profilePresence(profile, now = Date.now()) {
  if (profile.online) return tr("متصل الآن");
  const last = typeof profile.lastActiveAt === 'number' ? profile.lastActiveAt : Date.parse(profile.lastActiveAt);
  if (!Number.isFinite(last) || last <= 0) return null;
  const minutes = Math.max(0, Math.floor((now - last) / 60000));
  if (minutes < 1) return tr("آخر ظهور قبل قليل");
  if (minutes < 60) return tr("آخر ظهور قبل ") + minutes.toLocaleString(getUiLocale()) + tr(" دقيقة");
  return tr("آخر ظهور ") + new Date(last).toLocaleDateString(getUiLocale(), { day: 'numeric', month: 'long' });
}
function Notice({ children, error = false, onClose }) { return <div className={'profile-notice' + (error ? ' is-error' : '')} role={error ? 'alert' : 'status'}><span>{children}</span>{onClose && <IconButton data-design-id="close" label={tr("إخفاء التنبيه")} icon="close" onClick={onClose} />}</div>; }
function EmptyState({ title, children, action, icon = 'person' }) { return <div className="profile-empty"><span className="profile-empty-art"><Icon name={icon} /></span><h2>{title}</h2><p>{children}</p>{action}</div>; }
function LoadingProfile() { return <div className="profile-loading" role="status" aria-label={tr("جارٍ تحميل الملف الشخصي")}><div className="profile-loading-cover" /><div className="profile-loading-lines"><span /><span /><span /></div></div>; }
export function ProfileAvatar({ profile, className = '' }) {
  return <SharedProfileAvatar user={profile} size={100} className={'profile-avatar ' + className} />;
}
function Cover({ profile, label = true }) {
  const [failed, setFailed] = useState([]);
  const cosmetic = getCosmetic(profile.cosmetics?.coverId, { kind: 'cover' });
  const url = [...cosmeticPosterSources(cosmetic), profile.coverUrl].find(value => value && !failed.includes(value));
  return <div data-design-id="cover" className="profile-cover"><div className="profile-cover-art" /><span className="profile-cover-spark"><Icon name="spark" size={40} /></span>{url && <img src={url} alt="" onError={() => setFailed(previous => [...previous, url].slice(-8))} />}{label && !url && <span className="profile-cover-label">{tr("لك مكان في الميدان")}</span>}</div>;
}
export function Achievements({ profile, owner }) {
  const [expanded, setExpanded] = useState(false);
  const earned = new Set(profile.earnedBadges || EMPTY);
  return <section data-design-id="achievements" className="profile-section" aria-label={tr("الإنجازات")}><header className="profile-section-heading"><div><h2>{owner ? tr("إنجازاتك في الميدان") : tr("إنجازات اللاعب")}</h2><p>{tr("كل جمعة تضيف شيئًا لرحلتك.")}</p></div><span className="profile-count-pill"><Icon name="trophy" size={15} /><bdi dir="ltr">{count(earned.size)} / {count(ACHIEVEMENTS.length)}</bdi></span></header><div className="profile-achievement-grid">{ACHIEVEMENTS.map((rule, index) => {
    const state = profile.achievements?.find(item => item.id === rule.id);
    const unlocked = earned.has(rule.id);
    const current = Number.isFinite(state?.current) ? Math.max(0, state.current) : unlocked ? rule.target : null;
    const progress = current === null ? 0 : Math.min(1, current / rule.target);
    return <article key={rule.id} hidden={!expanded && index >= 3} data-design-id="achievement" className={'profile-achievement' + (unlocked ? '' : ' is-locked')} aria-label={tr(rule.label) + (unlocked ? tr("، مكتمل") : tr("، لم يُفتح بعد"))}><span className="profile-achievement-icon"><Icon name={rule.icon} /></span><h3>{tr(rule.label)}</h3><p>{tr(rule.description)}</p>{unlocked ? <span className="profile-achievement-state"><Icon name="check" />{tr("إنجاز مكتمل")}</span> : <>{current !== null && <><div className="profile-progress" role="progressbar" aria-label={tr(rule.label)} aria-valuemin={0} aria-valuemax={rule.target} aria-valuenow={Math.min(current, rule.target)}><span style={{ width: progress * 100 + '%' }} /></div><span className="profile-progress-text" dir="ltr">{count(Math.min(current, rule.target))} / {count(rule.target)}</span></>}<span className="profile-achievement-state"><Icon name="lock" />{tr("لم يُفتح بعد")}</span></>}</article>;
  })}</div><Button data-design-id="achievements-toggle" full variant="ghost" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? tr("عرض أقل") : tr("عرض الإنجازات كلها ({count})", {count:count(ACHIEVEMENTS.length)})}</Button></section>;
}
export function ProfileStats({ profile }) {
  const stats = profile.stats || {};
  return <section data-design-id="stats" className="profile-section profile-stats" aria-label={tr("إحصاءات اللعب")}><h2>{tr("الرحلة بالأرقام")}</h2>{[['localSessions', tr("جلسات مستضافة"), 'home'], ['onlineMatches', tr("مباريات أونلاين"), 'globe'], ['onlineWins', tr("انتصارات أونلاين"), 'trophy'], ['distinctGames', tr("ألعاب مختلفة"), 'compass']].map(([key, label, icon]) => <div data-design-id="stat" className="profile-stat-row" key={key}><span className="profile-stat-icon"><Icon name={icon} /></span><span className="profile-stat-copy">{label}</span><strong>{count(stats[key])}</strong></div>)}<p className="profile-stat-note">{tr("تُحتسب الجلسات والمباريات المكتملة منذ إطلاق الملفات الشخصية. تشمل الانتصارات الفوز منفردًا أو مع فريقك حسب قواعد اللعبة.")}</p></section>;
}
export function CropDialog({ crop, profiles, revision, ownerId = profiles.mine?.id, onClose, onDone }) {
  const accepted = useAcceptedFeedback(ownerId);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [width, setWidth] = useState(320);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stage = useRef(null);
  const drag = useRef(null);
  const alive = useRef(true);
  const { image, kind } = crop;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
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
    const feedback = accepted.begin();
    setBusy(true); setError('');
    try {
      const updated = await uploadCroppedProfileImage(image, { kind, zoom, offsetX: offset.x, offsetY: offset.y }, dataUrl => profiles.uploadImage(kind, dataUrl, revision), { isCurrent: () => alive.current && feedback.current() });
      if (feedback.current() && alive.current) { if (ownerId && updated?.id === ownerId) feedback.confirm(); onDone(updated); }
    }
    catch (err) { if (feedback.current() && alive.current) { feedback.error(err); setError(errorText(err)); setBusy(false); } }
  };
  return <Modal data-design-screen="profile.crop" title={kind === 'avatar' ? tr("ضبط الصورة الشخصية") : tr("ضبط صورة الغلاف")} className="profile-dialog profile-crop-dialog" onClose={busy ? null : onClose} footer={<div className="profile-edit-footer"><Button data-design-id="cancel" variant="ghost" onClick={onClose} disabled={busy}>{tr("إلغاء")}</Button><Button variant="primary" data-sound="none" data-design-id="save" data-design-required="true" onClick={apply} loading={busy}>{tr("إرسال للمراجعة")}</Button></div>}><p className="profile-crop-hint">{tr("اسحب الصورة داخل الإطار، أو حرّكها بمفاتيح الأسهم. استخدم شريط التكبير لضبط القص.")}</p><div ref={stage} data-design-id="crop" className={'profile-crop-stage' + (kind === 'cover' ? ' is-cover' : '')} tabIndex={busy ? -1 : 0} role="group" aria-label={tr("إطار قص الصورة؛ استخدم الأسهم لتحريكها")} onKeyDown={event => {
    const moves = { ArrowLeft: [.06, 0], ArrowRight: [-.06, 0], ArrowUp: [0, .06], ArrowDown: [0, -.06] }; const move = moves[event.key];
    if (move && !busy) { event.preventDefault(); setOffset(value => ({ x: clamp(value.x + move[0]), y: clamp(value.y + move[1]) })); }
  }} onPointerDown={event => { if (busy) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, offset }; }} onPointerMove={event => {
    if (!drag.current || busy) return;
    setOffset({ x: travelX ? clamp(drag.current.offset.x - (event.clientX - drag.current.x) / travelX) : 0, y: travelY ? clamp(drag.current.offset.y - (event.clientY - drag.current.y) / travelY) : 0 });
  }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}><img src={image.url} alt={tr("معاينة موضع الصورة قبل الحفظ")} draggable={false} style={{ width: image.width * scale, height: image.height * scale, left: -rectangle.x * scale, top: -rectangle.y * scale }} /></div><label data-design-id="zoom" className="profile-zoom">{tr("التكبير")}<input data-design-id="zoom-input" type="range" min="1" max="3" step="0.01" value={zoom} disabled={busy} onChange={event => setZoom(Number(event.target.value))} aria-label={tr("تكبير الصورة")} /><span>{zoom.toFixed(1)}×</span></label>{busy && <p role="status" className="profile-crop-hint">{tr("جارٍ إرسال الصورة للمراجعة…")}</p>}{error && <Notice error>{error}</Notice>}</Modal>;
}
export function ProfileEditor({ profile, profiles, onClose, onSaved }) {
  const accepted = useAcceptedFeedback(profile.id);
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
    const feedback = accepted.begin();
    setBusy(target); setError(''); setNotice('');
    try { const updated = await profiles.removeImage(target, editRevision.current); if (!feedback.current()) return false; if (Number.isInteger(updated?.revision)) editRevision.current = updated.revision; if (updated?.id === profile.id) feedback.confirm(); setNotice(target === 'avatar' ? tr("أُزيلت الصورة الشخصية.") : tr("أُزيلت صورة الغلاف.")); return true; }
    catch (err) { if (feedback.current()) { feedback.error(err); setError(errorText(err)); } return false; }
    finally { if (feedback.current()) setBusy(''); }
  };
  const chooseAvatar = id => { if (saving) return; setAvatarChosen(true); patch({ avatarPreset: id }); };
  const save = async () => {
    if (saving) return;
    const name = draft.name.trim();
    if (codepoints(name).length < 2 || codepoints(name).length > 32) { setError(tr("اكتب اسمًا من حرفين إلى 32 حرفًا.")); return; }
    const feedback = accepted.begin();
    setBusy('save'); setError('');
    try { const updated = await profiles.saveProfile(profileEditPatch(draft, { avatarChosen, revision: editRevision.current })); if (!feedback.current()) return; if (updated?.id === profile.id) feedback.confirm(); onSaved(); }
    catch (err) { if (feedback.current()) { feedback.error(err); setError(errorText(err)); setBusy(''); } }
  };
  return <><Modal data-design-screen="profile.editor" title={tr("ملفك، على طريقتك")} className="profile-dialog profile-editor" onClose={saving ? null : close} footer={<div className="profile-edit-footer"><Button variant="ghost" disabled={saving} data-design-id="cancel" data-design-required="true" onClick={close}>{tr("إلغاء")}</Button><Button variant="primary" loading={busy === 'save'} disabled={saving} data-sound="none" data-design-id="save" data-design-required="true" onClick={save}>{tr("حفظ التغييرات")}</Button></div>}><div style={themeStyle(draft.theme)}><p className="profile-dialog-intro">{tr("عرّف أصحابك عليك، واختر اللمسة التي تشبهك.")}</p><div ref={feedback}>{error && <Notice error>{error}</Notice>}{notice && <Notice>{notice}</Notice>}</div><input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={readFile} />

    <div className="profile-edit-images">
    <section data-design-id="edit-section" className="profile-edit-section"><h3>{tr("الصورة الشخصية")}</h3><div className="profile-image-editor-row"><ProfileAvatar profile={{ ...profile, avatarUrl: avatarChosen ? null : profile.avatarUrl, avatarPreset: draft.avatarPreset }} /><div className="profile-image-actions"><Button variant="secondary" icon={<Icon name="camera" size={17} />} disabled={saving} data-design-id="avatar-upload" onClick={() => pickFile('avatar')}>{profile.avatarUrl ? tr("تغيير الصورة") : tr("رفع صورة")}</Button>{(profile.avatarUrl || profile.imageReviews?.avatar) && <Button variant="ghost" className="is-danger" disabled={saving} data-sound="none" data-design-id="avatar-remove" onClick={() => remove('avatar')}>{tr("إزالة الصورة وطلب المراجعة")}</Button>}</div></div><ImageReviewStatus review={profile.imageReviews?.avatar} kind="avatar" /></section>
    <section data-design-id="edit-section" className="profile-edit-section"><h3>{tr("الغلاف")}</h3><div className="profile-image-editor-row"><div className="profile-edit-cover">{profile.coverUrl ? <img src={profile.coverUrl} alt={tr("الغلاف الحالي")} /> : <div className="profile-cover-art" />}</div><div className="profile-image-actions"><Button variant="secondary" disabled={saving} data-design-id="cover-upload" onClick={() => pickFile('cover')}>{profile.coverUrl ? tr("تغيير الغلاف") : tr("رفع غلاف")}</Button>{(profile.coverUrl || profile.imageReviews?.cover) && <Button variant="ghost" className="is-danger" disabled={saving} data-sound="none" data-design-id="cover-remove" onClick={() => remove('cover')}>{tr("إزالة الغلاف وطلب المراجعة")}</Button>}</div></div><ImageReviewStatus review={profile.imageReviews?.cover} kind="cover" /><p>{tr("تُرسل الصور إلى مراجعة بشرية قبل نشرها. تبقى الصورة المعتمدة الحالية حتى اعتماد البديلة. حفظ الاسم والنبذة من زر «حفظ التغييرات».")}</p>{busy === 'decode' && <p role="status">{tr("جارٍ تجهيز الصورة…")}</p>}</section>
    </div>
    <section data-design-id="edit-section" className="profile-edit-section"><label data-design-id="field" className="profile-field">{tr("الاسم")}<input data-design-id="name-input" aria-label={tr("الاسم")} autoFocus value={draft.name} maxLength={64} autoComplete="nickname" disabled={saving} onChange={event => patch({ name: codepoints(event.target.value).slice(0, 32).join('') })} /><small dir="ltr">{count(codepoints(draft.name).length)} / {count(32)}</small></label><label data-design-id="field" className="profile-field">{tr("نبذة عنك")}<textarea data-design-id="bio-input" aria-label={tr("نبذة عنك")} rows={3} value={draft.bio} maxLength={320} disabled={saving} placeholder={tr("الألعاب التي تحبها، أو كلمة تعرّف عنك…")} onChange={event => patch({ bio: codepoints(event.target.value).slice(0, 160).join('') })} /><small dir="ltr">{count(codepoints(draft.bio).length)} / {count(160)}</small></label></section>
    <section data-design-id="edit-section" className="profile-edit-section"><p>{tr("أو اختر شخصية من الميدان:")}</p><div className="profile-avatar-grid">{AVATAR_PRESETS.map(avatar => <button type="button" data-design-id="avatar-choice" className="profile-avatar-choice" key={avatar.id} aria-label={tr(avatar.label)} aria-pressed={(!profile.avatarUrl || avatarChosen) && draft.avatarPreset === avatar.id} disabled={saving} onClick={() => chooseAvatar(avatar.id)}><span aria-hidden="true">{avatar.emoji}</span>{(!profile.avatarUrl || avatarChosen) && draft.avatarPreset === avatar.id && <Icon name="check" className="profile-avatar-check" />}</button>)}</div></section>
    <section data-design-id="edit-section" className="profile-edit-section"><h3>{tr("ألوان ملفك")}</h3><div className="profile-theme-grid">{PROFILE_THEMES.map(theme => <button type="button" key={theme.id} data-design-id="theme-choice" className="profile-theme-choice" aria-pressed={draft.theme === theme.id} disabled={saving} onClick={() => patch({ theme: theme.id })}><span className="profile-theme-swatch" style={{ background: theme.gradient }}>{draft.theme === theme.id && <Icon name="check" />}</span>{tr(theme.label)}</button>)}</div></section>
    <section data-design-id="edit-section" className="profile-edit-section"><label data-design-id="field" className="profile-field">{tr("لقبك")}<select data-design-id="title-select" aria-label={tr("لقبك")} value={draft.selectedTitle} disabled={saving} onChange={event => patch({ selectedTitle: event.target.value })}><option value="">{tr("بدون لقب")}</option>{TITLES.map(title => <option key={title.id} value={title.id} disabled={!earnedTitles.has(title.id)}>{tr(title.label)}{earnedTitles.has(title.id) ? '' : tr(" — لم يُفتح بعد")}</option>)}</select></label><p>{tr("تفتح الألقاب بإكمال الإنجازات.")}</p></section>
    <section data-design-id="edit-section" className="profile-edit-section"><h3>{tr("شاراتك البارزة · ")}<bdi dir="ltr">{count(draft.featuredBadges.length)} / {count(3)}</bdi></h3><div className="profile-badge-picker">{ACHIEVEMENTS.map(badge => {
      const selected = draft.featuredBadges.includes(badge.id); const earned = earnedBadges.has(badge.id);
      return <button type="button" key={badge.id} data-design-id="badge-choice" className={'profile-badge-choice' + (!earned ? ' is-locked' : '')} aria-pressed={selected} aria-label={tr(badge.label) + (earned ? '' : tr("، لم تُفتح بعد"))} disabled={saving || !earned || (!selected && draft.featuredBadges.length >= 3)} onClick={() => patch({ featuredBadges: selected ? draft.featuredBadges.filter(id => id !== badge.id) : [...draft.featuredBadges, badge.id] })}><Icon name={badge.icon} /><span>{tr(badge.label)}</span><Icon name={earned ? selected ? 'check' : 'plus' : 'lock'} size={14} /></button>;
    })}</div><p>{tr("اختر حتى ثلاث شارات مكتسبة لتظهر بجانب هويتك.")}</p></section></div></Modal>
    {crop && <CropDialog crop={crop} profiles={profiles} ownerId={profile.id} revision={editRevision.current} onClose={() => setCrop(null)} onDone={updated => { if (Number.isInteger(updated?.revision)) editRevision.current = updated.revision; if (crop.kind === 'avatar') setAvatarChosen(false); setCrop(null); setNotice(tr("أُرسلت الصورة للمراجعة. ستظهر للآخرين بعد اعتمادها.")); }} />}
    {discard && <Modal title={tr("تجاهل التغييرات؟")} className="profile-dialog" onClose={() => setDiscard(false)} footer={<div className="profile-edit-footer"><Button data-design-id="cancel" variant="ghost" onClick={() => setDiscard(false)}>{tr("متابعة التعديل")}</Button><Button data-design-id="confirm" variant="danger" onClick={onClose}>{tr("تجاهل التغييرات")}</Button></div>}><p className="profile-dialog-intro">{tr("لن تُحفظ تعديلات الاسم والنبذة والاختيارات. الصور التي حفظتها تبقى كما هي.")}</p></Modal>}
  </>;
}
export function SafetyDialog({ action, profile, social, onClose, onDone }) {
  const [reason, setReason] = useState(''); const [details, setDetails] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const report = action === 'report';
  const submit = async () => {
    setBusy(true); setError('');
    try { if (report) await social.reportUser(profile.id, { reason: [reason, details.trim()].filter(Boolean).join(': ') }); else await social.blockUser(profile.id); onDone(); }
    catch (err) { setError(errorText(err)); setBusy(false); }
  };
  return <Modal data-design-screen="profile.safety" placement="bottom" title={report ? tr("الإبلاغ عن الحساب") : tr("حظر ") + nameOf(profile) + '؟'} onClose={busy ? null : onClose} className="profile-dialog" footer={<div className="profile-edit-footer"><Button data-design-id="cancel" variant="ghost" disabled={busy} onClick={onClose}>{tr("إلغاء")}</Button><Button data-design-id="submit" variant={report ? 'primary' : 'danger'} loading={busy} disabled={busy || social.offline || (report && !reason)} onClick={submit}>{report ? tr("إرسال البلاغ") : tr("حظر")}</Button></div>}><p className="profile-dialog-intro">{report ? tr("لن نعرض بلاغك لهذا الشخص.") : tr("لن يستطيع إرسال طلبات صداقة أو رسائل إليك، وسيُزال من أصدقائك.")}</p>{report && <><label data-design-id="field" className="profile-field">{tr("سبب الإبلاغ")}<select data-design-id="report-reason" aria-label={tr("سبب الإبلاغ")} value={reason} onChange={event => setReason(event.target.value)} disabled={busy}><option value="">{tr("اختر السبب")}</option>{["محتوى غير مناسب", "انتحال شخصية", "إساءة أو تنمر", "رسائل مزعجة", "سبب آخر"].map(item => <option key={item} value={item}>{tr(item)}</option>)}</select></label><label data-design-id="field" className="profile-field">{tr("تفاصيل إضافية (اختياري)")}<textarea data-design-id="report-details" maxLength={800} rows={3} value={details} disabled={busy} onChange={event => setDetails(event.target.value)} /></label></>}{error && <Notice error>{error}</Notice>}</Modal>;
}
export function ProfileIdentityLibrary({ profile, onNavigate = navigate }) {
  const equipped = ['profileSkinId','frameId'].map(key => getCosmetic(profile?.cosmetics?.[key])).filter(Boolean);
  return <section data-design-id="profile-library" className="profile-identity-library" aria-label={tr("بروفايلي وإطار صورتي")}>
    <div className="profile-identity-library-head"><div><h2>{tr("بروفايلك وإطارك")}</h2><p>{tr("بلس يخصّص شكل ملفك وإطار صورتك. صورتك الشخصية ومقتنياتك السابقة تبقى محفوظة.")}</p></div></div>
    {equipped.length > 0 && <div className="profile-equipped-pieces" aria-label={tr("مظهري المجهّز")}>{equipped.map(item => <span key={item.id}>{tr(item.label)}</span>)}</div>}
    <div className="profile-identity-links"><Button data-design-id="plus-store" size="sm" onClick={() => onNavigate('/store?tab=library')}>{tr("مقتنياتي")}</Button><Button data-design-id="profile-store" size="sm" variant="ghost" onClick={() => onNavigate('/store')}>{tr("المظهر والإطارات")}</Button></div>
    <p>{tr("الصور والثيمات الأساسية مجانية دائمًا. تفاصيل كل قطعة توضّح مدة إتاحتها.")}</p>
  </section>;
}
export function ProfileView({ account, profiles, social, profileId, onNavigate = navigate, onBack }) {
  const { t, dir } = useI18n();
  const accepted = useAcceptedFeedback(`${account.user?.id || 'guest'}:${profileId || 'me'}`);
  const key = !profileId || profileId === account.user?.id ? 'me' : profileId;
  const profile = key === 'me' ? profiles.mine : profiles.profiles?.[key];
  const owner = Boolean(account.signedIn && profile && (profile.relationship === 'self' || profile.id === account.user?.id));
  const [detailsTab, setDetailsTab] = useState('achievements');
  const [visitorPreviewId, setVisitorPreviewId] = useState(null);
  const visitorPreview = owner && visitorPreviewId === profile.id;
  const [framePreview, setFramePreview] = useState(null);
  const canTryFrames = owner && profile.id === account.user?.id && !visitorPreview && canPreviewLivingFrames();
  const [editing, setEditing] = useState(false); const [signIn, setSignIn] = useState(false); const [menu, setMenu] = useState(false); const [action, setAction] = useState('');
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(null); const [loadError, setLoadError] = useState(''); const [shareLink, setShareLink] = useState('');
  const notify = (text, error = false) => setNotice({ text, error });
  const load = async () => { setLoadError(''); try { await profiles.loadProfile(key); } catch (err) { setLoadError(errorText(err)); } };
  const loadProfile = profiles.loadProfile;
  useEffect(() => { if (account.ready && account.signedIn && profiles.ready) { let active = true; setLoadError(''); Promise.resolve(loadProfile(key)).catch(err => { if (active) setLoadError(errorText(err)); }); return () => { active = false; }; } }, [account.ready, account.signedIn, profiles.ready, key, loadProfile]);
  const error = Object.hasOwn(profiles.errors || {}, key) ? profiles.errors[key] : loadError;
  const copyCode = async () => { const feedback = accepted.begin(); try { if (!navigator.clipboard?.writeText) throw new Error(tr("يمكنك تحديد الرمز ونسخه يدويًا.")); await navigator.clipboard.writeText(profile.code); if (feedback.current()) { feedback.confirm(); notify(owner ? tr("نُسخ رمزك في ميدان.") : tr("نُسخ رمز الصديق.")); } } catch (err) { if (feedback.current()) { feedback.error(err); notify(errorText(err), true); } } };
  const share = async () => {
    const feedback = accepted.begin();
    const url = profileShareUrl(profile.id);
    try { if (navigator.share) { await navigator.share({ title: nameOf(profile) + tr(" في ميدان"), url }); feedback.confirm(); } else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); if (feedback.current()) { feedback.confirm(); notify(tr("نُسخ رابط الملف الشخصي.")); } } else if (feedback.current()) setShareLink(url); }
    catch (err) { if (feedback.current() && err?.name !== 'AbortError') { feedback.error(err); setShareLink(url); } }
  };
  const friendship = async type => {
    if (busy || social.offline) return;
    setBusy(true);
    try {
      if (type === 'send') await social.sendRequest(profile.id);
      else { if (!profile.requestId) throw new Error(tr("تغيّر الطلب. أعد تحميل الملف وحاول مجددًا.")); if (type === 'accept') await social.acceptRequest(profile.requestId); else await social.cancelRequest(profile.requestId); }
      await profiles.loadProfile(key); notify(type === 'send' ? tr("أُرسل طلب الصداقة.") : type === 'accept' ? tr("أُضيف إلى أصدقائك.") : tr("أُلغي الطلب."));
    } catch (err) { notify(errorText(err), true); } finally { setBusy(false); }
  };
  const presence = profile ? profilePresence(profile) : null;
  const featured = (profile?.featuredBadges || EMPTY).filter(id => profile?.earnedBadges?.includes(id)).slice(0, 3).map(id => ACHIEVEMENTS.find(item => item.id === id)).filter(Boolean);
  const selectedTitle = profile?.earnedTitles?.includes(profile.selectedTitle) ? titleLabel(profile.selectedTitle) : '';
  const codeRow = profile ? <div className="profile-code-row"><button type="button" data-sound="none" data-design-id="code" className="profile-code" onClick={copyCode} aria-label={tr("نسخ رمز الصديق")}><bdi>{profile.code}</bdi><Icon name="copy" size={15} /></button><span className="profile-meta-dot" /><span>{count(profile.friendCount)}{tr(" أصدقاء")}</span>{presence && <><span className="profile-meta-dot" /><span className={'profile-presence' + (profile.online ? ' is-online' : '')}><i />{presence}</span></>}</div> : null;
  const identityActions = profile ? <div className="profile-primary-actions">{visitorPreview ? null : owner ? <button type="button" data-design-id="edit" className="profile-owner-edit" onClick={() => setEditing(true)}><Icon name="edit" size={18} />{tr("تعديل الملف")}</button> : <div data-design-id="contact" className="profile-contact-actions">{profile.relationship === 'friend' ? <Button data-design-id="friend-chat" variant="primary" icon={<Icon name="chat" size={17} />} onClick={() => onNavigate('/friends/' + encodeURIComponent(profile.id))}>{tr("محادثة")}</Button> : profile.relationship === 'pending_incoming' ? <Button data-design-id="friend-accept" variant="primary" loading={busy} disabled={social.offline || busy} onClick={() => friendship('accept')}>{tr("قبول الصداقة")}</Button> : profile.relationship === 'pending_outgoing' ? <><span className="profile-request-status">{tr("بانتظار قبول الصداقة")}</span><Button data-design-id="friend-cancel" variant="secondary" loading={busy} disabled={social.offline || busy} onClick={() => friendship('cancel')}>{tr("إلغاء الطلب")}</Button></> : <Button data-design-id="add-friend" variant="primary" loading={busy} disabled={social.offline || busy} icon={<Icon name="plus" size={17} />} onClick={() => friendship('send')}>{tr("إضافة صديق")}</Button>}<IconButton label={tr("خيارات الحساب")} icon="more" onClick={() => setMenu(true)} /></div>}</div> : null;
  const hasProgression = Number.isInteger(profile?.progression?.level);
  return <main data-design-screen="profile" className="profile-screen" data-profile-skin={profileSkin(profile?.cosmetics) ? 'sahra' : 'base'} dir={dir} style={{...themeStyle(profile?.theme),...profileSkinStyle(profile?.cosmetics)}} aria-label={tr("ملف ميدان الشخصي")}><PresentationStyles sheet={profileCss}/><PresentationStyles sheet={plusCss}/><PresentationStyles sheet={identityCss}/><PresentationStyles sheet={skinCss}/><header data-design-id="header" className="profile-page-head"><div className="profile-page-heading"><IconButton label={tr("العودة")} icon="back" onClick={() => onBack ? onBack() : onNavigate(profileId && !owner ? '/friends' : '/')} /><div><span>{owner || !profileId ? tr("هويتك في الميدان") : tr("أهل الميدان")}</span><h1 data-design-id="title">{owner || !profileId ? tr("ملفي الشخصي") : tr("الملف الشخصي")}</h1></div></div>{(owner || !profileId) && <button type="button" data-design-id="profile-settings" className="studio-profile-settings" aria-label={t('الإعدادات')} onClick={() => onNavigate('/settings')}><Icon name="settings" size={24} /></button>}</header>
    {notice && <Notice error={notice.error} onClose={() => setNotice(null)}>{notice.text}</Notice>}
    {!account.ready ? <LoadingProfile /> : !account.signedIn ? <EmptyState title={tr("لك هوية في الميدان")} action={<Button data-design-id="account-signin" variant="primary" onClick={() => setSignIn(true)}>{tr("تسجيل الدخول")}</Button>}>{tr("سجّل الدخول لتعرض ملفك، وتكتشف إنجازاتك، وتتعرّف على أصحابك.")}</EmptyState> : error ? <EmptyState title={tr("تعذّر عرض الملف")} action={<Button data-design-id="retry" variant="secondary" onClick={load}>{tr("إعادة المحاولة")}</Button>}>{error}</EmptyState> : !profile ? <LoadingProfile /> : <>
      {hasProgression ? <>
        <AccountProgressionProfile key={profile.id + ':' + visitorPreview} profile={profile} profiles={profiles}
          owner={owner && !visitorPreview} featured={featured} title={selectedTitle} onCustomize={() => setEditing(true)}
          cover={profile.coverUrl || profile.cosmetics?.coverId ? <Cover profile={profile} label={false} /> : null} />
        <div className="profile-content">{codeRow}{identityActions}</div>
      </> :       <article className="profile-card"><Cover profile={profile} /><div data-design-id="identity" className="profile-identity"><div className="profile-identity-top"><ProfileAvatar profile={profile} /></div><div data-design-id="name" className="profile-name-row"><h2><PlayerName user={profile} card /></h2>{selectedTitle && <span className="profile-earned-title"><Icon name="crown" size={15} />{tr(selectedTitle)}</span>}</div>{codeRow}{profile.bio ? <p data-design-id="bio" className="profile-bio" dir="auto">{profile.bio}</p> : owner ? <p className="profile-bio is-empty">{tr("أضف نبذة صغيرة… وخَلّ أصحابك يتعرّفون عليك.")}</p> : null}{identityActions}<div data-design-id="badges" className="profile-showcase"><span className="profile-showcase-label">{tr("شارات بارزة")}</span>{featured.length ? featured.map(badge => <span key={badge.id} className="profile-featured-badge" title={tr(badge.description)}><Icon name={badge.icon} />{tr(badge.label)}</span>) : <span className="profile-showcase-empty">{owner ? tr("اختر شاراتك المكتسبة من تعديل الملف.") : tr("لم يختر شارات بارزة بعد.")}</span>}</div></div></article>}
      <div className="profile-content">
        {canTryFrames && <Button variant="secondary" full onClick={() => setFramePreview('plus.signature.frame')}>{tr("جرّب الإطارات الحيّة")}</Button>}
        <nav className="profile-details-nav" aria-label={tr("تفاصيل الملف")}>
          <button type="button" data-design-id="profile-tab-achievements" aria-pressed={detailsTab === 'achievements'} onClick={() => setDetailsTab('achievements')}>{tr("الإنجازات")}</button>
          <button type="button" data-design-id="profile-tab-stats" aria-pressed={detailsTab === 'stats'} onClick={() => setDetailsTab('stats')}>{tr("الإحصاءات")}</button>
        </nav>
        <div className="profile-page-actions">
          <button type="button" data-sound="none" data-design-id="share" className="profile-share-button" onClick={share}><Icon name="share" size={18} />{tr("مشاركة الملف")}</button>
          {owner && <button type="button" data-design-id="profile-visitor-preview" className="profile-share-button" aria-pressed={visitorPreview} onClick={() => setVisitorPreviewId(visitorPreview ? null : profile.id)}>{visitorPreview ? tr("إنهاء المعاينة") : tr("معاينة كزائر")}</button>}
        </div>
        {visitorPreview && <p className="profile-visitor-notice" role="status">{tr("معاينة مظهر الملف دون أدوات الإدارة.")}</p>}
        {owner && !visitorPreview && <Button data-design-id="home" variant="accent" full onClick={() => onNavigate('/')}>{tr("بدء اللعب")}</Button>}
        <div hidden={detailsTab !== 'achievements'}><Achievements profile={profile} owner={owner && !visitorPreview} /></div>
        <div hidden={detailsTab !== 'stats'}><ProfileStats profile={profile} />{!visitorPreview && <MafiaProgressPanel account={account} profileId={profile.id} owner={owner} />}</div>
      </div>
      {owner && !visitorPreview && <ProfileIdentityLibrary profile={profile} onNavigate={onNavigate} />}
      {owner && !visitorPreview && profile.imageReviews && <div className="profile-review-summary"><ImageReviewStatus review={profile.imageReviews.avatar} kind="avatar" /><ImageReviewStatus review={profile.imageReviews.cover} kind="cover" /></div>}
    </>}
    {canTryFrames && framePreview && <Modal title={tr("جرّب الإطارات الحيّة")} className="profile-dialog" onClose={() => setFramePreview(null)}>
      <div className="center" style={{ paddingBlock: '30px' }}><SharedProfileAvatar user={profile} size={156} previewFrameId={framePreview} /></div>
      <label className="profile-field">{tr("الإطار")}<select value={framePreview} onChange={event => setFramePreview(event.target.value)}>
        {PLUS_ITEMS.filter(item => item.motionKind === 'living-frame').map(item => <option key={item.id} value={item.id}>{tr(item.label)}{item.availableFrom > Date.now() ? tr(" · قريبًا") : ''}</option>)}
      </select></label>
      <p className="profile-dialog-intro">{tr("معاينة على صورتك في TestFlight. اختيار الإطار هنا ما بغيّر إطار حسابك.")}</p>
    </Modal>}
    <SignInSheet open={signIn} onClose={() => setSignIn(false)} note={tr("سجّل الدخول لملفك الشخصي وأصدقائك وإنجازاتك في ميدان.")} />
    {account.signedIn && owner && editing && profile && <ProfileEditor profile={profile} profiles={profiles} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); notify(tr("حُفظ ملفك الشخصي.")); }} />}
    {account.signedIn && menu && profile && <Modal title={tr("خيارات ") + nameOf(profile)} className="profile-dialog" onClose={() => setMenu(false)}><div className="profile-menu"><button type="button" className="is-danger" onClick={() => { setMenu(false); setAction('block'); }}><Icon name="shield" />{tr("حظر الحساب")}</button><button type="button" onClick={() => { setMenu(false); setAction('report'); }}>{tr("الإبلاغ عن الحساب")}</button></div></Modal>}
    {account.signedIn && action && profile && <SafetyDialog action={action} profile={profile} social={social} onClose={() => setAction('')} onDone={() => { setAction(''); if (action === 'block') onNavigate('/friends'); else notify(tr("وصل بلاغك. شكرًا لمساعدتنا.")); }} />}
    {shareLink && <Modal title={tr("رابط الملف الشخصي")} className="profile-dialog" onClose={() => setShareLink('')}><p className="profile-dialog-intro">{tr("انسخ الرابط وأرسله لأصحابك.")}</p><label data-design-id="field" className="profile-field">{tr("رابط المشاركة")}<input data-design-id="share-link" dir="ltr" readOnly value={shareLink} onFocus={event => event.target.select()} /></label></Modal>}
  </main>;
}
export function ProfileScreen({ profileId, id }) {
  const account = useAccount(); const profiles = useProfiles(); const social = useSocial();
  const selected = profileId || id || null;
  return <ProfileView key={(account.user?.id || 'guest') + ':' + (selected || 'me')} account={account} profiles={profiles} social={social} profileId={selected} onBack={back} />;
}
