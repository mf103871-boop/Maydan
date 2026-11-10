import { SubscriptionTransition } from '../../plus/SubscriptionTransition.jsx';
import { SELECTED_AUDIO } from '../../shared/fx/selected-audio.js';
import { AudioCandidateLab, candidateCallBusy } from '../../shared/fx/AudioCandidateLab.jsx';
import { isPrivateAudioCandidateBuild } from '../../shared/fx/audio-candidate-policy.js';
import { isWarmthPreviewBuild } from '../../shared/fx/warmth-preview-policy.js';
import { useLamma } from '../../social/LammaProvider.jsx';
// الإعدادات: الصوت، الموسيقى، الاهتزاز، تقليل الحركة، مسح البيانات، الإصدار، وبلاغات أسئلة بَديهة.
import React, { useState } from 'react';
import { Screen, TopBar, Button, Card, ConfirmModal, IconButton, Segment } from '../../shared/ui/components.jsx';
import { IconBack, IconVolume, IconMusic, IconVibrate, IconMotion, IconTrash, IconFlag, IconShare, IconInfo, IconUsers, IconSettings } from '../../shared/ui/icons.jsx';
import { clearAllPlatformData, createStorage } from '../../shared/lib/storage.js';
import { AccountCard } from '../../shared/account/AccountCard.jsx';
import { useAccount } from '../../shared/account/context.js';
import { LEGAL_ROUTES, PUBLIC_SITE_ORIGIN, SUPPORT_EMAIL } from '../../shared/account/config.js';
import { isNativeShell } from '../../shared/account/native.js';
import { RewardedPrivacySettings } from '../../shared/account/RewardedOffer.jsx';
import { ACCOUNT_PREFIX } from '../../shared/account/store.js';
import { shareText } from '../../shared/fx/haptics.js';
import { usePlatform } from '../context.js';
import { back, navigate, getDirection, getPreviousPath, useRoute } from '../router.js';
import { ModerationSettingsLink } from '../../moderation/ModerationScreen.jsx';
import settingsStyles from './settings-rebuild.css';

// index: تدرّج دخول الصفوف (45ms لكل صف) عبر --delay
function Toggle({ icon, title, sub, checked, onChange, index = 0 }) {
  return (
    <div data-design-id="setting" className="setting" style={{ '--delay': `${index * 45}ms` }}>
      <span className="icon" aria-hidden="true">{icon}</span>
      <span className="text"><b>{title}</b><small>{sub}</small></span>
      <button type="button" data-design-id="setting-toggle" className="switch" role="switch" aria-checked={checked} aria-label={title} onClick={() => onChange(!checked)} />
    </div>
  );
}

function SettingsGroup({ id, title, icon, description, children }) {
  return <section data-design-id={id} data-design-required={id === 'settings-account' || id === 'settings-privacy' ? 'true' : undefined} className="settings-group" aria-labelledby={id}><header className="settings-group-heading"><span aria-hidden="true">{icon}</span><div><h2 id={id} tabIndex={-1}>{title}</h2>{description && <p>{description}</p>}</div></header><div className="stack">{children}</div></section>;
}

const sections = [
  { key: 'audio', label: 'الصوت والاهتزاز', icon: <IconVolume /> },
  { key: 'display', label: 'العرض والراحة', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4m-5 0h10"/></svg> },
  { key: 'account', label: 'الحساب والخصوصية', icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M12 2 21 6v5c0 5-4 9-9 11-5-2-9-6-9-11V6z"/></svg> },
  { key: 'help', label: 'المساعدة', icon: <IconInfo /> },
];

export function Settings() {
  const { settings, setSettings, sound, haptics, toast, version } = usePlatform();
  const account = useAccount();
  const route = useRoute();
  const section = sections.find(entry => entry.key === route.params.section);
  const native = isNativeShell();
  const lamma = useLamma();
  const [audioCandidates, setAudioCandidates] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const reports = createStorage('badeeha').get('question-reports-v1', []) || [];
  const returnToSettings = () => {
    if (getPreviousPath() === '/settings') back();
    else navigate('/settings', { replace: true });
  };
  const share = async () => {
    const text = reports.slice(0, 100).map((r, i) => [`${i + 1}. [${r.category} — ${r.points}] ${r.reason}`, `السؤال: ${r.question}`, `الإجابة: ${r.answer}`, `المعرّف: ${r.qid}`].join('\n')).join('\n\n');
    const result = await shareText('بلاغات أسئلة بَديهة', text);
    if (result === 'cancelled') return; // ألغى المستخدم ورقة المشاركة: لا رسالة نجاح
    toast(result === 'copied' ? 'تم نسخ البلاغات' : result === 'failed' ? 'تعذرت المشاركة على هذا الجهاز' : 'تمت المشاركة');
  };
  return (
    <Screen key={section?.key || 'index'} data-design-screen="settings" dir={getDirection()} className="stack settings-screen" aria-label={section?.label || 'الإعدادات'}>
      <style>{settingsStyles}</style>
      <TopBar data-design-id="topbar" title={section?.label || 'الإعدادات'} start={<IconButton data-design-id="back" label="رجوع" onClick={section ? returnToSettings : back}><IconBack /></IconButton>} end={<span className="settings-top-icon" aria-hidden="true">{section?.icon || <IconSettings />}</span>} />
      {!section && <>
        <nav className="settings-index" aria-label="مجموعات الإعدادات">
          {sections.map(({ key, label, icon }) => <button key={key} type="button" data-settings-section={key} data-design-id={key === 'account' ? 'settings-account' : 'settings-section-jump'} data-design-required={key === 'account' ? 'true' : undefined} onClick={() => navigate('/settings?section=' + key)}>{icon}<span>{label}</span><IconBack className="settings-row-arrow" /></button>)}
        </nav>
        <div className="settings-account-status"><IconUsers /><span><b>حالة الحساب</b><small>{!account.ready ? 'جارٍ التحقق من حالة الحساب…' : account.signedIn ? account.me?.moderation?.suspended ? 'حسابك معلّق.' : 'أنت مسجّل الدخول إلى ميدان.' : 'أنت تلعب كضيف.'}</small></span></div>
        <Button data-design-id="manage-roster" variant="secondary" icon={<IconUsers />} onClick={() => navigate('/players')}>دفتر اللاعبين · اللعب مع العائلة</Button>
        <Button data-design-id="home" className="settings-return" variant="accent" full onClick={() => navigate('/')}>العودة إلى ميدان</Button>
      </>}
      {section?.key === 'account' && <SettingsGroup id="settings-account" title="حسابك وميدان بلس" icon={<IconUsers />}><SubscriptionTransition /><AccountCard /><Button data-design-id="plus-store" onClick={() => navigate('/store')}>تخصيص مظهري ومتجر بلس</Button></SettingsGroup>}
      {section?.key === 'audio' && <SettingsGroup id="settings-audio" title="الصوت والموسيقى" icon={<IconVolume />}>
        <Toggle index={0} icon={<IconVolume />} title="الصوت" sub="المؤثرات ومقاطع الأسئلة والموسيقى معًا" checked={settings.soundOn} onChange={(v) => { setSettings({ soundOn: v }); if (v) sound.play('pop'); }} />
        {isPrivateAudioCandidateBuild() && !isWarmthPreviewBuild() && <Button data-sound="none" size="sm" disabled={candidateCallBusy(lamma)} onClick={() => setAudioCandidates(true)}>معاينة أصوات التحديث</Button>}
        <div className="setting setting-volume">
          <label htmlFor="sound-volume"><b>مستوى الصوت</b><output htmlFor="sound-volume">{Math.round(sound.volume * 100)}٪</output></label>
          <input data-design-id="sound-volume" id="sound-volume" type="range" min="0" max="100" step="5" value={Math.round(sound.volume * 100)} disabled={!settings.soundOn}
            aria-valuetext={`${Math.round(sound.volume * 100)} بالمئة`}
            onChange={(event) => setSettings({ soundVolume: Number(event.target.value) / 100 })}
            onPointerUp={() => sound.play('pop')} onKeyUp={(event) => { if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') sound.play('pop'); }} />
          <Button data-design-id="sound-test" size="sm" disabled={!settings.soundOn || sound.volume === 0} onClick={() => sound.play('correct')}>تجربة الصوت</Button>
        </div>
        {SELECTED_AUDIO.voicesProductionApproved && <Toggle index={1} icon={<IconVolume />} title="تعليقات الإجابات" sub="تصمت أثناء المكالمات والتسجيل ومقاطع الأسئلة" checked={settings.voiceOn} onChange={(v) => setSettings({ voiceOn: v })} />}
        <Toggle index={2} icon={<IconMusic />} title="الموسيقى" sub="خلفيات مرتبطة باللعبة، وتنخفض أثناء الكلام" checked={settings.musicOn} onChange={(v) => {
          const shouldRetry = isWarmthPreviewBuild() && v === true && sound.music.enabled === false
            && sound.music.getStatus()?.state === 'failed';
          setSettings({ musicOn: v });
          if (shouldRetry) sound.music.retry();
        }} />
        <Toggle index={3} icon={<IconMusic />} title="وضع التصوير والبث" sub="يكتم الموسيقى أثناء التصوير أو البث" checked={!!settings.creatorMode} onChange={v => setSettings({ creatorMode: v })} />
        <div className="setting setting-volume">
          <label htmlFor="music-volume"><b>مستوى الموسيقى</b><output htmlFor="music-volume">{Math.round(sound.music.volume * 100)}٪</output></label>
          <input data-design-id="music-volume" id="music-volume" type="range" min="0" max="100" step="5" value={Math.round(sound.music.volume * 100)} disabled={!settings.soundOn || !settings.musicOn}
            aria-valuetext={`${Math.round(sound.music.volume * 100)} بالمئة`}
            onChange={(event) => setSettings({ musicVolume: Number(event.target.value) / 100 })}
            onPointerUp={() => sound.play('pop')} onKeyUp={(event) => { if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') sound.play('pop'); }} />
        </div>
        <Toggle index={0} icon={<IconVibrate />} title="الاهتزاز" sub="عند الإجابات والمؤقت (حيث يتوفر)" checked={settings.hapticsOn} onChange={(v) => { setSettings({ hapticsOn: v }); if (v) haptics.vibrate('light'); }} />
        <p className="settings-autosave">تُحفظ هذه الخيارات تلقائيًا على هذا الجهاز.</p>
      </SettingsGroup>}
      {section?.key === 'display' && <SettingsGroup id="settings-experience" title="العرض وتجربة اللعب" icon={<IconMotion />}>
        <Toggle index={1} icon={<IconMotion />} title="تقليل الحركة" sub="يعطّل الجسيمات والانتقالات مع بقاء الوظائف" checked={settings.reducedMotion} onChange={(v) => setSettings({ reducedMotion: v })} />
        <Card className="settings-text-preview stack"><b>حجم النص</b><Segment accent label="حجم النص" options={[{ value: false, label: 'عادي' }, { value: true, label: 'كبير' }]} value={!!settings.largeText} onChange={v => setSettings({ largeText: v })} /><p style={{ fontSize: settings.largeText ? 17 : 14 }}>معاينة: هذا مثال على حجم النص داخل التطبيق.</p></Card>
        <Toggle index={3} icon={<IconMotion />} title="تباين أعلى" sub="يقوّي حدود العناصر والنصوص الثانوية" checked={!!settings.highContrast} onChange={(v) => setSettings({ highContrast: v })} />
        <Toggle index={4} icon={<IconMotion />} title="زينة أخف" sub="يوقف حركة الزينة المستمرة ويخفف الظلال؛ تبقى مؤشرات اللعب" checked={settings.visualQuality === 'calm'} onChange={(v) => setSettings({ visualQuality: v ? 'calm' : 'auto' })} />
        <p className="settings-autosave">تُحفظ هذه الخيارات تلقائيًا على هذا الجهاز.</p>
      </SettingsGroup>}
      {section?.key === 'account' && <SettingsGroup id="settings-privacy" title="الخصوصية والأمان" icon={<IconInfo />}>
        {typeof __MAYDAN_REWARDED_PREVIEW__ !== 'undefined' && __MAYDAN_REWARDED_PREVIEW__ && native && <RewardedPrivacySettings />}
        <Card className="settings-legal-card legal-links">
          <a data-design-id="privacy-link" href={LEGAL_ROUTES.privacy}>سياسة الخصوصية</a>
          <a data-design-id="terms-link" href={LEGAL_ROUTES.terms}>شروط الاستخدام</a>
          <a data-design-id="refunds-link" href={native ? `${PUBLIC_SITE_ORIGIN}/refunds/` : 'refunds/'}>سياسة الاسترداد</a>
          {!native && <a data-design-id="pricing-link" href="pricing/">التسعير</a>}
        </Card>
        <ModerationSettingsLink />
      </SettingsGroup>}
      {section?.key === 'help' && <SettingsGroup id="settings-support" title="المساعدة وعن ميدان" icon={<IconFlag />}>
      <nav className="settings-index help-index" aria-label="مساعدة ميدان">
        <button type="button" data-design-id="about" onClick={() => navigate('/about')}><IconInfo /><span>عن ميدان</span><IconBack className="settings-row-arrow" /></button>
        <button type="button" data-design-id="credits-open" onClick={() => navigate('/about?view=credits')}><IconMusic /><span>المصادر والتراخيص</span><IconBack className="settings-row-arrow" /></button>
        <a data-design-id="support-link" href={`mailto:${SUPPORT_EMAIL}`}><IconFlag /><span>تواصل مع الدعم</span><IconBack className="settings-row-arrow" /></a>
      </nav>
      <Card className="stack">
        <div className="row"><IconFlag style={{ color: 'var(--accent)' }} /><span className="card-title">الإبلاغ عن سؤال</span></div>
        <p className="card-muted">تُحفظ البلاغات التي ترسلها من داخل بَديهة على هذا الجهاز. عدد البلاغات الحالية: <b style={{ color: 'var(--text)' }}>{reports.length}</b>.</p>
        <Button data-design-id="share-reports" variant="secondary" icon={<IconShare />} disabled={!reports.length} onClick={share}>مشاركة البلاغات</Button>
      </Card>
      </SettingsGroup>}
      {section?.key === 'account' && <SettingsGroup id="settings-local" title="بيانات هذا الجهاز" icon={<IconTrash />} description="مسح بيانات الجهاز منفصل عن حذف حسابك.">
      <Card className="stack">
        <span className="card-title">مسح البيانات</span>
        <p className="card-muted">يحذف دفتر اللاعبين، والإعدادات، وسجلات الألعاب، ومفاتيح العودة للغرف من هذا الجهاز. يبقى حسابك واشتراكك.</p>
        <Button data-design-id="clear-data" variant="danger" icon={<IconTrash />} onClick={() => setConfirmClear(true)}>مسح كل البيانات</Button>
      </Card>
      </SettingsGroup>}
      {section && <Button data-design-id="settings-index-return" className="settings-return" variant="accent" full onClick={returnToSettings}>العودة إلى الإعدادات</Button>}
      <p className="muted center" style={{ fontSize: 13 }}>ميدان: ألعاب جمعتنا · الإصدار {version}</p>
      {/* The compile-time guard lets public builds drop the lab and its private catalog. */}
      {typeof __MAYDAN_AUDIO_PREVIEW__ !== 'undefined' && __MAYDAN_AUDIO_PREVIEW__ === true && audioCandidates && isPrivateAudioCandidateBuild() && !isWarmthPreviewBuild() && <AudioCandidateLab onClose={() => setAudioCandidates(false)} />}
      {confirmClear && (
        <ConfirmModal title="مسح بيانات هذا الجهاز؟" className="settings-clear-confirmation" danger message="لا يمكن التراجع. ستُحذف أسماء اللاعبين والنتائج والمباريات المحفوظة ومفاتيح العودة للغرف من هذا الجهاز. يبقى حسابك واشتراكك." confirmLabel="نعم، امسح" cancelLabel="إلغاء"
          onConfirm={() => { clearAllPlatformData({ keep: [ACCOUNT_PREFIX] }); setConfirmClear(false); toast('تم مسح البيانات'); setTimeout(() => location.reload(), 500); }} onCancel={() => setConfirmClear(false)} />
      )}
    </Screen>
  );
}
