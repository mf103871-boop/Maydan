import { tr } from '../../shared/i18n/core.js';
// اعتماد الصوت في شاشة «عن ميدان»: المكتبات المرخَّصة التي أُخذت منها مؤثرات، وسطور الإسناد
// الإلزامي (CC BY ونحوها)، وما بقي من تأليف ميدان. البيانات مولَّدة من provenance (audio-credits.js).
import React from 'react';
import { AUDIO_CREDITS } from '../../shared/fx/audio-credits.js';
import { SELECTED_AUDIO } from '../../shared/fx/selected-audio.js';
import { integratedPreviewAudio } from '../../shared/fx/integrated-preview-audio.js';

const plural = (n, one, few, many) => (n === 1 ? one : n >= 3 && n <= 10 ? `${n} ${few}` : `${n} ${many}`);

export function AudioCredits({ credits = AUDIO_CREDITS }) {
  const localAudio = integratedPreviewAudio();
  const localAssets = Object.values(localAudio?.pack?.assets || {});
  const localSuite = localAudio?.pack?.musicSuites?.['warmth-long'];
  const localMusicIds = new Set(localSuite?.trackIds || ['music-bossa']);
  const localSeconds = [...localMusicIds].reduce((sum,id)=>sum+(localAudio?.pack?.assets?.[id]?.file?.durationSeconds||0),0);
  if (localAudio) return <div data-design-screen="audio-credits" data-design-id="content" className="stack audio-credits" aria-label={tr("مصادر صوت المعاينة")}>
    <p>{tr("هذه المعاينة تستخدم «دفء وخفّة»: ")}{localMusicIds.size}{tr(" مقاطع ضمن اتجاه Bossa Nova، بمدة إجمالية نحو ")}{Math.round(localSeconds/60)}{tr(" دقيقة للمرور الأول، مع المؤثرات القصيرة ودقات الساعة. ")}{localSuite?tr("الافتتاح مرة واحدة، ثم تتنوع المقاطع بترتيب متغير دون إعادة مباشرة."):tr("المقطوعة تعمل مرة واحدة.")}{tr(" المصادر أدناه مرشحة للمراجعة السمعية وتجربة الجهاز، ولا تعني اعتماد الإنتاج أو موسيقى حصرية لميدان.")}</p>
    {localAssets.length === 0 ? <p role="status">{tr("لم تكتمل تهيئة حزمة صوت المعاينة. تبقى الأصوات متوقفة حتى تحميل الحزمة الصحيحة.")}</p> : <ul className="credits-list">{localAssets.filter(a=>a.kind==='effect'||localMusicIds.has(a.id)).map(a=><li key={a.id}><a data-design-id="source-link" href={a.source.pageUrl} target="_blank" rel="noreferrer noopener">{a.source.title}</a> — {a.source.author}</li>)}</ul>}
    <p><a data-design-id="license-link" href="https://pixabay.com/service/license-summary/" target="_blank" rel="noreferrer noopener">{tr("ملخص ترخيص Pixabay")}</a>{tr(" · دليل المصادر محفوظ؛ شهادات الموسيقى المطلوبة ما زالت قيد الاستكمال.")}</p>
  </div>;
  const sourced = credits.sources.reduce((n, s) => n + s.items, 0);
  const own = credits.inHouse.cues.length + credits.inHouse.tracks.length;
  return (
    <div data-design-screen="audio-credits" data-design-id="content" className="stack audio-credits" aria-label={tr("اعتماد الصوت")}>
      <p className="card-muted">{tr(" المؤثرات الصوتية والموسيقى: ")}{sourced ? tr("{v0} من مكتبات مفتوحة الرخصة، مع القصّ والضبط والإتقان لميدان، و", {v0: plural(sourced, tr("ملف واحد"), tr("ملفات"), tr("ملفًا"))}) : ''}
        {plural(own, tr("ملف واحد"), tr("ملفات"), tr("ملفًا"))} ({plural(credits.inHouse.cues.length, tr("مؤثر"), tr("مؤثرات"), tr("مؤثرًا"))}{tr(" و")}{plural(credits.inHouse.tracks.length, tr("مقطوعة"), tr("مقطوعات"), tr("مقطوعة"))}{tr(") من تأليف ميدان وتصنيعه رقميًا. ")}</p>
      {credits.sources.length > 0 && (
        <ul className="credits-list">
          {credits.sources.map((s) => (
            <li key={s.provider}>
              <a data-design-id="source-link" href={s.url} target="_blank" rel="noreferrer noopener">{s.name}</a>
              <span className="muted"> — {plural(s.items, tr("ملف واحد"), tr("ملفات"), tr("ملفًا"))} · </span>
              <a data-design-id="license-link" href={s.licenseUrl} target="_blank" rel="noreferrer noopener">{s.license}</a>
            </li>
          ))}
        </ul>
      )}
      {credits.attribution.length > 0 && (
        <ul className="credits-list">
          {credits.attribution.map((a) => (
            <li key={a.id}>
              <b>{a.title}</b><span className="muted"> — {a.author} · </span>
              <a data-design-id="license-link" href={a.licenseUrl} target="_blank" rel="noreferrer noopener">{a.license}</a>
              {a.sourceUrl && <> · <a data-design-id="source-link" href={a.sourceUrl} target="_blank" rel="noreferrer noopener">{tr("المصدر")}</a></>}
            </li>
          ))}
        </ul>
      )}
      <details className="card-muted">
        <summary>{tr("موسيقى «خطوات شمس» والعبارات التجريبية")}</summary>
        <p>{tr("ترتيب أصلي مدته ثماني دقائق من نغمات آلات حقيقية مسجّلة، يتغيّر عبر ١٤ جزءًا. بعض المصادر الأصلية بدقة 44.1kHz و16-bit؛ تصدير المزيج بدقة أعلى لا يضيف تفاصيل إلى المصدر.")}</p>
        <ul className="credits-list">
          {SELECTED_AUDIO.sources.instrument_libraries.map((source) => (
            <li key={source.name}>
              <a data-design-id="source-link" href={source.source_url} target="_blank" rel="noreferrer noopener">{source.name}</a>
              <span className="muted"> — {source.creator} · CC0 1.0</span>
            </li>
          ))}
        </ul>
        <p>{tr("العبارات صوت آلي تجريبي باستخدام ")}<a data-design-id="source-link" href="https://huggingface.co/silma-ai/silma-tts" target="_blank" rel="noreferrer noopener">SILMA TTS</a>{tr(" (أوزان Apache-2.0 وكود MIT)، وليست تسجيل مؤدٍ بشري. النموذج موثق للفصحى والإنجليزية؛ النطق المحلي يحتاج استماعك ولم يُعتمد للنشر العام. يمكن إيقاف العبارات من إعدادات الصوت.")}</p>
      </details>
    </div>
  );
}
