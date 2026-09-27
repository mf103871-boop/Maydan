// اعتماد الصوت في شاشة «عن ميدان»: المكتبات المرخَّصة التي أُخذت منها مؤثرات، وسطور الإسناد
// الإلزامي (CC BY ونحوها)، وما بقي من تأليف ميدان. البيانات مولَّدة من provenance (audio-credits.js).
import React from 'react';
import { AUDIO_CREDITS } from '../../shared/fx/audio-credits.js';

const plural = (n, one, few, many) => (n === 1 ? one : n >= 3 && n <= 10 ? `${n} ${few}` : `${n} ${many}`);

export function AudioCredits({ credits = AUDIO_CREDITS }) {
  const sourced = credits.sources.reduce((n, s) => n + s.items, 0);
  const own = credits.inHouse.cues.length + credits.inHouse.tracks.length;
  return (
    <div className="stack audio-credits" aria-label="اعتماد الصوت">
      <p className="card-muted">
        المؤثرات الصوتية والموسيقى: {sourced ? `${plural(sourced, 'ملف واحد', 'ملفات', 'ملفًا')} من مكتبات مفتوحة الرخصة، مع القصّ والضبط والإتقان لميدان، و` : ''}
        {plural(own, 'ملف واحد', 'ملفات', 'ملفًا')} ({plural(credits.inHouse.cues.length, 'مؤثر', 'مؤثرات', 'مؤثرًا')} و{plural(credits.inHouse.tracks.length, 'مقطوعة', 'مقطوعات', 'مقطوعة')}) من تأليف ميدان وتصنيعه رقميًا.
      </p>
      {credits.sources.length > 0 && (
        <ul className="credits-list">
          {credits.sources.map((s) => (
            <li key={s.provider}>
              <a href={s.url} target="_blank" rel="noreferrer noopener">{s.name}</a>
              <span className="muted"> — {plural(s.items, 'ملف واحد', 'ملفات', 'ملفًا')} · </span>
              <a href={s.licenseUrl} target="_blank" rel="noreferrer noopener">{s.license}</a>
            </li>
          ))}
        </ul>
      )}
      {credits.attribution.length > 0 && (
        <ul className="credits-list">
          {credits.attribution.map((a) => (
            <li key={a.id}>
              <b>{a.title}</b><span className="muted"> — {a.author} · </span>
              <a href={a.licenseUrl} target="_blank" rel="noreferrer noopener">{a.license}</a>
              {a.sourceUrl && <> · <a href={a.sourceUrl} target="_blank" rel="noreferrer noopener">المصدر</a></>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
