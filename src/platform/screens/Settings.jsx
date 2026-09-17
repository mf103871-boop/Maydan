// الإعدادات: الصوت، الاهتزاز، تقليل الحركة، مسح البيانات، الإصدار، وبلاغات أسئلة بَديهة.
import React, { useState } from 'react';
import { Screen, TopBar, IconButton, Button, Card, ConfirmModal } from '../../shared/ui/components.jsx';
import { IconBack, IconVolume, IconVibrate, IconMotion, IconTrash, IconFlag, IconShare } from '../../shared/ui/icons.jsx';
import { clearAllPlatformData, createStorage } from '../../shared/lib/storage.js';
import { AccountCard } from '../../shared/account/AccountCard.jsx';
import { LEGAL_ROUTES, PUBLIC_SITE_ORIGIN } from '../../shared/account/config.js';
import { isNativeShell } from '../../shared/account/native.js';
import { ACCOUNT_PREFIX } from '../../shared/account/store.js';
import { shareText } from '../../shared/fx/haptics.js';
import { usePlatform } from '../context.js';
import { back, getDirection } from '../router.js';

// index: تدرّج دخول الصفوف (45ms لكل صف) عبر --delay
function Toggle({ icon, title, sub, checked, onChange, index = 0 }) {
  return (
    <div className="setting" style={{ '--delay': `${index * 45}ms` }}>
      <span className="icon" aria-hidden="true">{icon}</span>
      <span className="text"><b>{title}</b><small>{sub}</small></span>
      <button type="button" className="switch" role="switch" aria-checked={checked} aria-label={title} onClick={() => onChange(!checked)} />
    </div>
  );
}

export function Settings() {
  const { settings, setSettings, sound, haptics, toast, version } = usePlatform();
  const native = isNativeShell();
  const [confirmClear, setConfirmClear] = useState(false);
  const reports = createStorage('badeeha').get('question-reports-v1', []) || [];
  const share = async () => {
    const text = reports.slice(0, 100).map((r, i) => [`${i + 1}. [${r.category} — ${r.points}] ${r.reason}`, `السؤال: ${r.question}`, `الإجابة: ${r.answer}`, `المعرّف: ${r.qid}`].join('\n')).join('\n\n');
    const result = await shareText('بلاغات أسئلة بَديهة', text);
    if (result === 'cancelled') return; // ألغى المستخدم ورقة المشاركة: لا رسالة نجاح
    toast(result === 'copied' ? 'تم نسخ البلاغات' : result === 'failed' ? 'تعذرت المشاركة على هذا الجهاز' : 'تمت المشاركة');
  };
  return (
    <Screen dir={getDirection()} className="stack" aria-label="الإعدادات">
      <TopBar title="الإعدادات" start={<IconButton label="رجوع" onClick={back}><IconBack /></IconButton>} />
      <div className="stack">
        <Toggle index={0} icon={<IconVolume />} title="الصوت" sub="مؤثرات اللعب ومقاطع الأسئلة" checked={settings.soundOn} onChange={(v) => { setSettings({ soundOn: v }); if (v) sound.play('pop'); }} />
        <div className="setting setting-volume">
          <label htmlFor="sound-volume"><b>مستوى الصوت</b><output htmlFor="sound-volume">{Math.round(sound.volume * 100)}٪</output></label>
          <input id="sound-volume" type="range" min="0" max="100" step="5" value={Math.round(sound.volume * 100)} disabled={!settings.soundOn}
            aria-valuetext={`${Math.round(sound.volume * 100)} بالمئة`}
            onChange={(event) => setSettings({ soundVolume: Number(event.target.value) / 100 })}
            onPointerUp={() => sound.play('pop')} onKeyUp={(event) => { if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') sound.play('pop'); }} />
          <Button size="sm" disabled={!settings.soundOn || sound.volume === 0} onClick={() => sound.play('correct')}>تجربة الصوت</Button>
        </div>
        <Toggle index={1} icon={<IconVibrate />} title="الاهتزاز" sub="عند الإجابات والمؤقت (حيث يتوفر)" checked={settings.hapticsOn} onChange={(v) => { setSettings({ hapticsOn: v }); if (v) haptics.vibrate('light'); }} />
        <Toggle index={2} icon={<IconMotion />} title="تقليل الحركة" sub="يعطّل الجسيمات والانتقالات مع بقاء الوظائف" checked={settings.reducedMotion} onChange={(v) => setSettings({ reducedMotion: v })} />
      </div>
      <AccountCard />
      <Card className="stack">
        <div className="row"><IconFlag style={{ color: 'var(--accent)' }} /><span className="card-title">الإبلاغ عن سؤال</span></div>
        <p className="card-muted">تُحفظ البلاغات التي ترسلها من داخل بَديهة على هذا الجهاز. عدد البلاغات الحالية: <b style={{ color: 'var(--text)' }}>{reports.length}</b>.</p>
        <Button variant="secondary" icon={<IconShare />} disabled={!reports.length} onClick={share}>مشاركة البلاغات</Button>
      </Card>
      <Card className="stack">
        <span className="card-title">مسح البيانات</span>
        <p className="card-muted">يحذف دفتر اللاعبين، والإعدادات، وسجلات الألعاب، ومفاتيح العودة للغرف من هذا الجهاز. يبقى حسابك واشتراكك.</p>
        <Button variant="danger" icon={<IconTrash />} onClick={() => setConfirmClear(true)}>مسح كل البيانات</Button>
      </Card>
      <p className="muted center legal-links" style={{ fontSize: 13 }}>
        {!native && <><a href="/pricing/">التسعير</a> · </>}
        <a href={native ? `${PUBLIC_SITE_ORIGIN}/refunds/` : '/refunds/'}>سياسة الاسترداد</a> · <a href={LEGAL_ROUTES.terms}>شروط الاستخدام</a> · <a href={LEGAL_ROUTES.privacy}>سياسة الخصوصية</a>
      </p>
      <p className="muted center" style={{ fontSize: 13 }}>ميدان: ألعاب جمعتنا · الإصدار {version}</p>
      {confirmClear && (
        <ConfirmModal title="مسح كل البيانات؟" danger message="لا يمكن التراجع. ستُحذف أسماء اللاعبين والنتائج والمباريات المحفوظة ومفاتيح العودة للغرف من هذا الجهاز. يبقى حسابك واشتراكك." confirmLabel="نعم، امسح" cancelLabel="إلغاء"
          onConfirm={() => { clearAllPlatformData({ keep: [ACCOUNT_PREFIX] }); setConfirmClear(false); toast('تم مسح البيانات'); setTimeout(() => location.reload(), 500); }} onCancel={() => setConfirmClear(false)} />
      )}
    </Screen>
  );
}
