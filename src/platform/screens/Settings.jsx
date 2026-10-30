import { SubscriptionTransition } from '../../plus/SubscriptionTransition.jsx';
import { SELECTED_AUDIO } from '../../shared/fx/selected-audio.js';
import { AudioCandidateLab, candidateCallBusy } from '../../shared/fx/AudioCandidateLab.jsx';
import { isPrivateAudioCandidateBuild } from '../../shared/fx/audio-candidate-policy.js';
import { useLamma } from '../../social/LammaProvider.jsx';
// الإعدادات: الصوت، الموسيقى، الاهتزاز، تقليل الحركة، مسح البيانات، الإصدار، وبلاغات أسئلة بَديهة.
import React, { useState } from 'react';
import { Screen, TopBar, Button, Card, ConfirmModal } from '../../shared/ui/components.jsx';
import { IconVolume, IconMusic, IconVibrate, IconMotion, IconTrash, IconFlag, IconShare, IconInfo, IconUsers } from '../../shared/ui/icons.jsx';
import { clearAllPlatformData, createStorage } from '../../shared/lib/storage.js';
import { AccountCard } from '../../shared/account/AccountCard.jsx';
import { LEGAL_ROUTES, PUBLIC_SITE_ORIGIN } from '../../shared/account/config.js';
import { isNativeShell } from '../../shared/account/native.js';
import { ACCOUNT_PREFIX } from '../../shared/account/store.js';
import { shareText } from '../../shared/fx/haptics.js';
import { usePlatform } from '../context.js';
import { navigate, getDirection } from '../router.js';
import { ModerationSettingsLink } from '../../moderation/ModerationScreen.jsx';

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

function SettingsGroup({ id, title, children }) {
  return <section data-design-id={id} data-design-required={id === 'settings-account' || id === 'settings-privacy' ? 'true' : undefined} className="settings-group" aria-labelledby={id}><h2 id={id}>{title}</h2><div className="stack">{children}</div></section>;
}

export function Settings() {
  const { settings, setSettings, sound, haptics, toast, version } = usePlatform();
  const native = isNativeShell();
  const lamma = useLamma();
  const [audioCandidates, setAudioCandidates] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const reports = createStorage('badeeha').get('question-reports-v1', []) || [];
  const share = async () => {
    const text = reports.slice(0, 100).map((r, i) => [`${i + 1}. [${r.category} — ${r.points}] ${r.reason}`, `السؤال: ${r.question}`, `الإجابة: ${r.answer}`, `المعرّف: ${r.qid}`].join('\n')).join('\n\n');
    const result = await shareText('بلاغات أسئلة بَديهة', text);
    if (result === 'cancelled') return; // ألغى المستخدم ورقة المشاركة: لا رسالة نجاح
    toast(result === 'copied' ? 'تم نسخ البلاغات' : result === 'failed' ? 'تعذرت المشاركة على هذا الجهاز' : 'تمت المشاركة');
  };
  return (
    <Screen data-design-screen="settings" dir={getDirection()} className="stack settings-screen" aria-label="الإعدادات">
      <TopBar data-design-id="topbar" title="الإعدادات" eyebrow="ميدان على راحتك" />
      <SettingsGroup id="settings-account" title="حسابك وميدان بلس"><SubscriptionTransition /><AccountCard /><Button data-design-id="plus-store" onClick={() => navigate('/store')}>تخصيص مظهري ومتجر بلس</Button></SettingsGroup>
      <SettingsGroup id="settings-audio" title="الصوت والموسيقى">
        <Toggle index={0} icon={<IconVolume />} title="الصوت" sub="المؤثرات ومقاطع الأسئلة والموسيقى معًا" checked={settings.soundOn} onChange={(v) => { setSettings({ soundOn: v }); if (v) sound.play('pop'); }} />
        {isPrivateAudioCandidateBuild() && <Button data-sound="none" size="sm" disabled={candidateCallBusy(lamma)} onClick={() => setAudioCandidates(true)}>معاينة أصوات التحديث</Button>}
        <div className="setting setting-volume">
          <label htmlFor="sound-volume"><b>مستوى الصوت</b><output htmlFor="sound-volume">{Math.round(sound.volume * 100)}٪</output></label>
          <input data-design-id="sound-volume" id="sound-volume" type="range" min="0" max="100" step="5" value={Math.round(sound.volume * 100)} disabled={!settings.soundOn}
            aria-valuetext={`${Math.round(sound.volume * 100)} بالمئة`}
            onChange={(event) => setSettings({ soundVolume: Number(event.target.value) / 100 })}
            onPointerUp={() => sound.play('pop')} onKeyUp={(event) => { if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') sound.play('pop'); }} />
          <Button data-design-id="sound-test" size="sm" disabled={!settings.soundOn || sound.volume === 0} onClick={() => sound.play('correct')}>تجربة الصوت</Button>
        </div>
        {SELECTED_AUDIO.voicesProductionApproved && <Toggle index={1} icon={<IconVolume />} title="تعليقات الإجابات" sub="تصمت أثناء المكالمات والتسجيل ومقاطع الأسئلة" checked={settings.voiceOn} onChange={(v) => setSettings({ voiceOn: v })} />}
        <Toggle index={2} icon={<IconMusic />} title="الموسيقى" sub="خلفيات مرتبطة باللعبة، وتنخفض أثناء الكلام" checked={settings.musicOn} onChange={(v) => setSettings({ musicOn: v })} />
        <Toggle index={3} icon={<IconMusic />} title="وضع التصوير والبث" sub="يكتم الموسيقى أثناء التصوير أو البث" checked={!!settings.creatorMode} onChange={v => setSettings({ creatorMode: v })} />
        <div className="setting setting-volume">
          <label htmlFor="music-volume"><b>مستوى الموسيقى</b><output htmlFor="music-volume">{Math.round(sound.music.volume * 100)}٪</output></label>
          <input data-design-id="music-volume" id="music-volume" type="range" min="0" max="100" step="5" value={Math.round(sound.music.volume * 100)} disabled={!settings.soundOn || !settings.musicOn}
            aria-valuetext={`${Math.round(sound.music.volume * 100)} بالمئة`}
            onChange={(event) => setSettings({ musicVolume: Number(event.target.value) / 100 })}
            onPointerUp={() => sound.play('pop')} onKeyUp={(event) => { if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') sound.play('pop'); }} />
        </div>
      </SettingsGroup>
      <SettingsGroup id="settings-experience" title="تجربة اللعب">
        <Button data-design-id="manage-roster" variant="secondary" icon={<IconUsers />} onClick={() => navigate('/players')}>دفتر اللاعبين · اللعب مع العائلة</Button>
        <Toggle index={0} icon={<IconVibrate />} title="الاهتزاز" sub="عند الإجابات والمؤقت (حيث يتوفر)" checked={settings.hapticsOn} onChange={(v) => { setSettings({ hapticsOn: v }); if (v) haptics.vibrate('light'); }} />
        <Toggle index={1} icon={<IconMotion />} title="تقليل الحركة" sub="يعطّل الجسيمات والانتقالات مع بقاء الوظائف" checked={settings.reducedMotion} onChange={(v) => setSettings({ reducedMotion: v })} />
      </SettingsGroup>
      <SettingsGroup id="settings-privacy" title="الخصوصية والأمان">
        <Card className="settings-legal-card legal-links">
          <a data-design-id="privacy-link" href={LEGAL_ROUTES.privacy}>سياسة الخصوصية</a>
          <a data-design-id="terms-link" href={LEGAL_ROUTES.terms}>شروط الاستخدام</a>
          <a data-design-id="refunds-link" href={native ? `${PUBLIC_SITE_ORIGIN}/refunds/` : 'refunds/'}>سياسة الاسترداد</a>
          {!native && <a data-design-id="pricing-link" href="pricing/">التسعير</a>}
        </Card>
        <ModerationSettingsLink />
      </SettingsGroup>
      <SettingsGroup id="settings-support" title="المساعدة وعن ميدان">
      <Card className="stack">
        <div className="row"><IconFlag style={{ color: 'var(--accent)' }} /><span className="card-title">الإبلاغ عن سؤال</span></div>
        <p className="card-muted">تُحفظ البلاغات التي ترسلها من داخل بَديهة على هذا الجهاز. عدد البلاغات الحالية: <b style={{ color: 'var(--text)' }}>{reports.length}</b>.</p>
        <Button data-design-id="share-reports" variant="secondary" icon={<IconShare />} disabled={!reports.length} onClick={share}>مشاركة البلاغات</Button>
      </Card>
      <Button data-design-id="about" variant="secondary" icon={<IconInfo />} onClick={() => navigate('/about')}>عن ميدان</Button>
      </SettingsGroup>
      <SettingsGroup id="settings-local" title="بيانات هذا الجهاز">
      <Card className="stack">
        <span className="card-title">مسح البيانات</span>
        <p className="card-muted">يحذف دفتر اللاعبين، والإعدادات، وسجلات الألعاب، ومفاتيح العودة للغرف من هذا الجهاز. يبقى حسابك واشتراكك.</p>
        <Button data-design-id="clear-data" variant="danger" icon={<IconTrash />} onClick={() => setConfirmClear(true)}>مسح كل البيانات</Button>
      </Card>
      </SettingsGroup>
      <p className="muted center" style={{ fontSize: 13 }}>ميدان: ألعاب جمعتنا · الإصدار {version}</p>
      {audioCandidates && isPrivateAudioCandidateBuild() && <AudioCandidateLab onClose={() => setAudioCandidates(false)} />}
      {confirmClear && (
        <ConfirmModal title="مسح كل البيانات؟" danger message="لا يمكن التراجع. ستُحذف أسماء اللاعبين والنتائج والمباريات المحفوظة ومفاتيح العودة للغرف من هذا الجهاز. يبقى حسابك واشتراكك." confirmLabel="نعم، امسح" cancelLabel="إلغاء"
          onConfirm={() => { clearAllPlatformData({ keep: [ACCOUNT_PREFIX] }); setConfirmClear(false); toast('تم مسح البيانات'); setTimeout(() => location.reload(), 500); }} onCancel={() => setConfirmClear(false)} />
      )}
    </Screen>
  );
}
